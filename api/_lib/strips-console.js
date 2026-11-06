/* What /mintwork/strips reads and what it asks Ryan's wallet to sign.
 *
 * Nothing here holds a key. A console action comes back as a transaction, and
 * the wallet in the browser sends it or doesn't.
 *
 * A street work's design is the painted panel, not the formula. A draft comes
 * from the site's palette, Ryan corrects it by hand against the After
 * photograph, and only a design he has signed off can be minted. The records
 * stay in the store, not the public repo, until the mint makes them public.
 */
import { encodeFunctionData, getAddress, isAddress, parseAbi, parseAbiItem } from 'viem';
import palettesFile from '../../data/strip-palettes.json' with { type: 'json' };
import sitesFile from '../../data/strip-sites.json' with { type: 'json' };
import { pipe, storeConfigured } from './kv.js';
import { layout, RED_LINE } from './strip-render.js';
import { chain, deployed, deployment, networkName, read } from './strips.js';
import { packStrips } from '../../strips-design.js';

export const FREEZE_AFTER = 50;
export const FREEZE_CHECKS = ['mintface', 'opensea', 'etherscan', 'wallet'];
const LOW_NATIVE_WEI = 20_000_000_000_000_000n; // 0.02 ETH, about 200 fulfilments at today's gas

const ADMIN = parseAbi([
  'function mintStreet(bytes design, uint16 no, string site) returns (uint256)',
  'function mintTwin(bytes design, address to) returns (uint256)',
  'function addPhoto(uint256 id, string uri)',
  'function setArTarget(uint256 id, string uri, uint16 widthCm, uint16 heightCm)',
  'function addCreatorStory(uint256 id, string text)',
  'function redeem(uint256 id, string photoUri)',
  'function retrySeed(uint256 id) returns (uint256)',
  'function setMintOpen(bool open)',
  'function freezeRenderer()',
  'function publishSnapshot(bytes32 root, uint64 takenAt, string arweaveUri, string label) returns (uint256)',
]);
const VRF = parseAbi([
  'function vrf() view returns (bytes32 keyHash, uint256 subId, uint16 confirmations, uint32 callbackGas, bool native)',
  'function s_vrfCoordinator() view returns (address)',
  'function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)',
]);
const STREET_MINTED = parseAbiItem('event StreetMinted(uint256 indexed id, uint16 indexed no, string site)');

const K = { design: (no) => `strips:street:${no}`, checks: 'strips:checks' };
const first = (replies) => (replies && replies[0] && 'result' in Object(replies[0]) ? replies[0].result : replies && replies[0]);
const getJson = async (key) => { const v = first(await pipe([['GET', key]])); return v ? JSON.parse(String(v)) : null; };
const setJson = (key, value) => pipe([['SET', key, JSON.stringify(value)]]);

/** The size a site's record says, as the numbers a design needs. */
export function sizeOfSite(site) {
  const text = String(site.size || '');
  const parts = [...text.matchAll(/([\d.]+)\s*(m\b|mm\b)?/g)].map((m) => ({ n: Number(m[1]), unit: m[2] || null }));
  const metric = parts.filter((p) => p.unit === 'm' || p.unit === 'mm' || p.n >= 100);
  if (metric.length < 2) return null;
  const [a, b] = metric.slice(-2);
  const mm = (p) => (p.unit === 'm' ? p.n * 1000 : p.n);
  const x = mm(a), y = mm(b);
  /* a window taller than it is wide stands its strips up */
  const portrait = y > x;
  return { length_cm: Math.round(Math.max(x, y) / 10), width_cm: Math.round(Math.min(x, y) / 10), across_mm: Math.min(x, y), orientation: portrait ? 'portrait' : 'landscape' };
}

export function draftFor(no) {
  const site = sitesFile.sites.find((s) => s.no === no);
  if (!site) return { error: 'no such site' };
  const palette = palettesFile.palettes.find((p) => p.work === site.work_id);
  const size = sizeOfSite(site);
  if (!palette) return { error: 'that site has no palette yet' };
  if (!size) return { error: 'that site has no size yet' };
  const { across_mm: acrossMm, ...shape } = size;
  return { ...shape, strips: layout(palette.colours.filter((c) => c.hex.toUpperCase() !== RED_LINE), acrossMm).strips, signed: false, site: `${site.address}` };
}

/** A design typed in by hand has to pack, or it isn't a design. */
function checkDesign(d) {
  if (!d || !Array.isArray(d.strips) || !d.strips.length) return 'strips are a list of {hex, mm}';
  if (!Number.isInteger(d.length_cm) || !Number.isInteger(d.width_cm) || d.length_cm < 1 || d.width_cm < 1) return 'length_cm and width_cm are whole numbers';
  if (d.strips.filter((s) => String(s.hex).toUpperCase() === RED_LINE).length !== 1) return 'one red line, exactly';
  if (d.strips.some((s) => !/^#[0-9a-f]{6}$/i.test(String(s.hex)) || !(Number(s.mm) > 0))) return 'every strip has a hex and a height';
  const colours = new Set(d.strips.map((s) => s.hex.toUpperCase()).filter((h) => h !== RED_LINE));
  if (colours.size < 3 || colours.size > 12) return '3 to 12 colours';
  try { packStrips(d.strips, d, RED_LINE); } catch { return 'that design won\'t pack: the heights are too far apart to be relative units'; }
  return null;
}

const packedOf = (d) => packStrips(d.strips, d, RED_LINE);

export async function saveDesign(no, design) {
  const problem = checkDesign(design);
  if (problem) return { error: problem };
  const site = sitesFile.sites.find((s) => s.no === no);
  if (!site) return { error: 'no such site' };
  await setJson(K.design(no), { ...design, site: design.site || site.address, signed: false });
  return { saved: true };
}

export async function signDesign(no) {
  const d = await getJson(K.design(no));
  if (!d) return { error: 'nothing to sign' };
  await setJson(K.design(no), { ...d, signed: true });
  return { signed: true };
}

async function streetTokens() {
  const d = deployment();
  const logs = await chain().getLogs({ address: d.extension, event: STREET_MINTED, fromBlock: BigInt(d.first_block || 0), toBlock: 'latest' }).catch(() => []);
  return new Map(logs.map((l) => [Number(l.args.no), Number(l.args.id)]));
}

async function vrfHealth() {
  const d = deployment();
  const [cfg, coordinator] = await Promise.all([
    chain().readContract({ address: d.extension, abi: VRF, functionName: 'vrf' }),
    chain().readContract({ address: d.extension, abi: VRF, functionName: 's_vrfCoordinator' }),
  ]);
  const sub = await chain().readContract({ address: coordinator, abi: VRF, functionName: 'getSubscription', args: [cfg[1]] });
  return { native_wei: sub[1].toString(), link_juels: sub[0].toString(), requests: Number(sub[2]), low: sub[1] < LOW_NATIVE_WEI && sub[0] === 0n };
}

export async function consoleView() {
  const checks = storeConfigured() ? (await getJson(K.checks)) || {} : {};
  const records = storeConfigured() ? await Promise.all(sitesFile.sites.map((s) => getJson(K.design(s.no)))) : sitesFile.sites.map(() => null);
  const live = deployed();
  const street = live ? await streetTokens() : new Map();
  const sites = sitesFile.sites.map((s, i) => ({
    no: s.no, address: s.address, status: s.status, token_id: street.get(s.no) || null,
    design: records[i] ? (records[i].signed ? 'signed' : 'draft') : 'none',
    record: records[i],
    installed_photo: Boolean(s.specimens && s.specimens.after && !s.specimens.after_is_mockup),
  }));
  const out = { deployed: live, network: networkName(), chain_id: deployment().chain_id, sites, checks, freeze: { need: FREEZE_AFTER, keys: FREEZE_CHECKS, minted: 0, frozen: false, ready: false } };
  if (!live) return out;
  const [publicMinted, streetMinted, lastId, frozen, open, vrf] = await Promise.all([
    read.extension('publicMinted'), read.extension('streetMinted'), read.extension('lastId'), read.extension('rendererFrozen'), read.extension('mintOpen'), vrfHealth().catch(() => null),
  ]);
  const minted = Number(publicMinted) + Number(streetMinted);
  const ids = Array.from({ length: Number(lastId) }, (_, i) => i + 1);
  const seeds = await Promise.all(ids.map((id) => read.extension('seedOf', [BigInt(id)]).catch(() => 1n)));
  const tuning = ids.filter((_, i) => seeds[i] === 0n).slice(-20);
  return {
    ...out, open, public_minted: Number(publicMinted), street_minted: Number(streetMinted), vrf, tuning,
    freeze: { ...out.freeze, minted, frozen, ready: !frozen && minted >= FREEZE_AFTER && FREEZE_CHECKS.every((k) => checks[k]) },
  };
}

export async function setCheck(key, value) {
  if (!FREEZE_CHECKS.includes(key)) return { error: 'no such check' };
  const checks = (await getJson(K.checks)) || {};
  await setJson(K.checks, { ...checks, [key]: Boolean(value) });
  return { saved: true };
}

/** A console action as a transaction, or {error}. */
export async function txFor(op, b = {}) {
  if (!deployed()) return { error: 'not deployed' };
  const d = deployment();
  const ext = (functionName, args) => ({ to: d.extension, data: encodeFunctionData({ abi: ADMIN, functionName, args }) });
  const id = BigInt(Number(b.id) || 0);
  const uri = String(b.uri || '');
  const needUri = () => (/^(ar:\/\/|https:\/\/arweave\.net\/)/.test(uri) ? null : 'an Arweave URI, ar://...');
  switch (op) {
    case 'street': {
      const no = Number(b.no);
      const rec = await getJson(K.design(no));
      if (!rec) return { error: 'that site has no design yet' };
      if (!rec.signed) return { error: 'sign the design off first: the painted panel is the truth' };
      return ext('mintStreet', [packedOf(rec), no, rec.site]);
    }
    case 'twin': {
      if (!isAddress(String(b.to || ''))) return { error: 'the twin needs the buyer\'s wallet' };
      if (!/^0x[0-9a-f]+$/i.test(String(b.design || ''))) return { error: 'no design' };
      return ext('mintTwin', [b.design, getAddress(b.to)]);
    }
    case 'photo': return needUri() ? { error: needUri() } : ext('addPhoto', [id, uri]);
    case 'target': return needUri() ? { error: needUri() } : ext('setArTarget', [id, uri, Number(b.width_cm) || 0, Number(b.height_cm) || 0]);
    case 'redeem': return needUri() ? { error: needUri() } : ext('redeem', [id, uri]);
    case 'story': return String(b.text || '').trim() ? ext('addCreatorStory', [id, String(b.text).trim()]) : { error: 'no story' };
    case 'retry': return ext('retrySeed', [id]);
    case 'open': return ext('setMintOpen', [Boolean(b.open)]);
    case 'snapshot': {
      if (!/^0x[0-9a-f]{64}$/i.test(String(b.root || ''))) return { error: 'the root is 32 bytes of hex' };
      if (needUri()) return { error: needUri() };
      return { to: d.ledger, data: encodeFunctionData({ abi: ADMIN, functionName: 'publishSnapshot', args: [b.root, BigInt(Number(b.taken_at) || 0), uri, String(b.label || 'Snapshot')] }) };
    }
    case 'freeze': {
      const v = await consoleView();
      if (!v.freeze.ready) return { error: `the freeze waits for ${FREEZE_AFTER} mints and all ${FREEZE_CHECKS.length} checks` };
      return ext('freezeRenderer', []);
    }
    default: return { error: 'no such action' };
  }
}
