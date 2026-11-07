/* //STRIPS on-chain, as the site speaks to it.
 *
 * A mint spec is what a visitor chose; the design is what the layout makes of
 * it, packed; the voucher is the site saying that design came from the Maker.
 * The voucher can't mint on its own and it can't set a price: the contract
 * checks both. The browser sends choices and never bands, so a design can't
 * reach the chain without passing through here.
 */
import { createPublicClient, encodeFunctionData, fallback, http, isAddress, keccak256, parseAbi, getAddress } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import config from '../../data/strips.json' with { type: 'json' };
import { layStrips, fitOf, RED_LINE, STRIPS, GAMMA } from './strip-render.js';
import { LENGTH, WIDTH } from './commission-spec.js';
import { packStrips, decodeDesign } from '../../strips-design.js';

export const PRICE_WEI = 9_000_000_000_000_000n;
export const PUBLIC_CAP = 621;
export const STANDARD_RED_LINE = 16;
export const COLOURS = { min: 3, max: 12 };
export const VOUCHER_MINUTES = 30;
/* A multi-sig gathers its signatures by hand. A voucher only says a design came
   from the Maker, so a long one gives nothing away. */
export const CONTRACT_VOUCHER_MINUTES = 24 * 60;

/* What each amount is worth against the others. */
const AMOUNTS = { less: 1, even: 2, more: 4 };
const ORIENT = ['portrait', 'landscape'];
const HEX = /^#[0-9A-F]{6}$/;

export const networkName = () => (process.env.STRIPS_NETWORK === 'sepolia' ? 'sepolia' : 'mainnet');
/* A rehearsal can share a store with mainnet and touch none of its keys. */
export const storeKey = (name) => `strips:${networkName() === 'mainnet' ? '' : `${networkName()}:`}${name}`;
/* STRIPS_DEPLOYMENT overrides the file: a local chain in the tests, and a
   Sepolia run before anything's worth committing. */
export const deployment = () => (process.env.STRIPS_DEPLOYMENT ? JSON.parse(process.env.STRIPS_DEPLOYMENT) : config.networks[networkName()]);
export const deployed = () => Boolean(deployment().extension);
const CHAINS = { mainnet, sepolia };

const MINT_ABI = parseAbi([
  'struct Voucher { address to; bytes32 designHash; uint256 nonce; uint256 deadline; }',
  'function mint(bytes design, Voucher v, bytes sig) payable returns (uint256)',
  'function mintFree(bytes design, Voucher v, bytes sig, uint256 taoTotal, uint256 freeMints, bytes32[] proof) returns (uint256)',
]);

export const ABI = parseAbi([
  'function designUsed(bytes32) view returns (bool)',
  'function mintOpen() view returns (bool)',
  'function publicMinted() view returns (uint256)',
  'function streetMinted() view returns (uint256)',
  'function lastId() view returns (uint256)',
  'function rendererFrozen() view returns (bool)',
  'function seedOf(uint256) view returns (uint256)',
  'function redeemedAt(uint256) view returns (uint256)',
  'function designOf(uint256) view returns (bytes)',
  'function taoOf(uint256) view returns (uint256)',
  'function photosOf(uint256) view returns (string[])',
  'function tokenOf(uint256) view returns ((address design, uint40 mintedAt, uint40 heldSince, uint8 viewIndex))',
  'function streetOf(uint256) view returns ((uint16 no, string site))',
  'function arTargetOf(uint256) view returns ((string uri, uint16 widthCm, uint16 heightCm))',
  'function claimDeadline() view returns (uint64)',
  'function claimSnapshot() view returns (uint256)',
  'function claimed(uint256, address) view returns (uint256)',
  'function unclaimedReserve() view returns (uint256)',
  'function totalClaimed() view returns (uint256)',
  'function snapshotCount() view returns (uint256)',
  'function snapshot(uint256) view returns ((bytes32 root, uint64 takenAt, uint64 publishedAt, uint64 claimUntil, uint64 freeMints, string arweaveUri, string label))',
  'function ownerOf(uint256) view returns (address)',
]);

let client;
export function chain() {
  if (client) return client;
  const name = networkName();
  const urls = process.env.STRIPS_RPC ? [process.env.STRIPS_RPC] : name === 'sepolia'
    ? [process.env.SEPOLIA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com'].filter(Boolean)
    : [process.env.ETH_RPC, 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'].filter(Boolean);
  /* a local test chain has no multicall contract; everywhere else reads go in batches */
  client = createPublicClient({ chain: CHAINS[name], batch: { multicall: !process.env.STRIPS_RPC }, transport: fallback(urls.map((u) => http(u, { timeout: 8000 }))) });
  return client;
}

const onExtension = (functionName, args = []) => chain().readContract({ address: deployment().extension, abi: ABI, functionName, args });
const onLedger = (functionName, args = []) => chain().readContract({ address: deployment().ledger, abi: ABI, functionName, args });
export const read = { extension: onExtension, ledger: onLedger };

/** A checked mint spec, or {error}. */
export function checkMintSpec(input = {}) {
  const stepped = (v, { min, max, step }) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max && n % step === 0 ? n : null; };
  const length_cm = stepped(input.length_cm, LENGTH);
  const width_cm = stepped(input.width_cm, WIDTH);
  if (!length_cm) return { error: `length_cm is ${LENGTH.min} to ${LENGTH.max} in steps of ${LENGTH.step}` };
  if (!width_cm) return { error: `width_cm is ${WIDTH.min} to ${WIDTH.max} in steps of ${WIDTH.step}` };
  if (!ORIENT.includes(input.orientation)) return { error: 'orientation is portrait or landscape' };

  const given = Array.isArray(input.colours) ? input.colours : [];
  if (given.length < COLOURS.min || given.length > COLOURS.max) return { error: `${COLOURS.min} to ${COLOURS.max} colours` };
  const colours = [];
  for (const c of given) {
    const hex = String(c && c.hex).toUpperCase();
    if (!HEX.test(hex)) return { error: 'a colour is a hex like #AABBCC' };
    if (hex === RED_LINE.toUpperCase()) return { error: 'the red line is its own colour' };
    const w = AMOUNTS[(c && c.amount) || 'even'];
    if (!w) return { error: 'an amount is less, even or more' };
    if (colours.some((x) => x.hex === hex)) return { error: 'each colour once' };
    colours.push({ hex, w });
  }

  const gamma = input.gamma == null ? GAMMA.calm : Number(input.gamma);
  if (!(gamma >= GAMMA.calm && gamma <= GAMMA.punchy)) return { error: 'gamma is out of range' };
  const fit = fitOf(width_cm * 10, input.count == null ? STRIPS : Number(input.count));
  const red_line = input.red_line == null ? STANDARD_RED_LINE : Number(input.red_line);
  if (!Number.isInteger(red_line) || red_line < 1 || red_line > fit.count) return { error: `red_line is 1 to ${fit.count}` };

  return { spec: { length_cm, width_cm, orientation: input.orientation, colours, gamma, count: fit.count, red_line } };
}

/** The design a checked spec makes: packed, hashed. The same spec, the same bytes. */
export function designOf(spec) {
  const strips = layStrips(spec.colours, spec.width_cm * 10, { gamma: spec.gamma, count: spec.count, redLine: spec.red_line, keepOrder: true });
  const design = packStrips(strips, spec, RED_LINE);
  return { design, hash: keccak256(design), strips: strips.length };
}

const VOUCHER_TYPES = {
  Voucher: [
    { name: 'to', type: 'address' },
    { name: 'designHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export const voucherConfigured = () => /^0x[0-9a-fA-F]{64}$/.test(process.env.STRIPS_VOUCHER_KEY || '');

/** Signs that this design came from the Maker, for this wallet, for a while. */
export async function signVoucher({ to, hash, now = Math.floor(Date.now() / 1000), minutes = VOUCHER_MINUTES }) {
  const account = privateKeyToAccount(process.env.STRIPS_VOUCHER_KEY);
  const message = {
    to: getAddress(to),
    designHash: hash,
    nonce: BigInt(`0x${randomBytes(16).toString('hex')}`),
    deadline: BigInt(now + minutes * 60),
  };
  const d = deployment();
  const signature = await account.signTypedData({
    domain: { name: '//STRIPS', version: '1', chainId: d.chain_id, verifyingContract: d.extension },
    types: VOUCHER_TYPES,
    primaryType: 'Voucher',
    message,
  });
  return { voucher: { to: message.to, designHash: hash, nonce: message.nonce.toString(), deadline: message.deadline.toString() }, signature };
}

/** Everything /api/strips/mint/prepare does, kept apart from the route. */
export async function prepareMint(input, { taken = (hash) => onExtension('designUsed', [hash]), now } = {}) {
  if (!isAddress(String(input.to || ''))) return { status: 400, error: 'connect a wallet first' };
  const { spec, error } = checkMintSpec(input);
  if (error) return { status: 400, error };
  if (!deployed()) return { status: 503, error: 'not minting yet' };
  if (!voucherConfigured()) return { status: 503, error: 'not minting yet' };
  const { design, hash } = designOf(spec);
  if (await taken(hash)) return { status: 409, error: 'that design has been minted', taken: true };
  const code = await chain().getCode({ address: getAddress(input.to) }).catch(() => null);
  const { voucher, signature } = await signVoucher({ to: input.to, hash, now, minutes: code && code !== '0x' ? CONTRACT_VOUCHER_MINUTES : VOUCHER_MINUTES });
  const v = { ...voucher, nonce: BigInt(voucher.nonce), deadline: BigInt(voucher.deadline) };
  const free = input.free || null;
  const data = free
    ? encodeFunctionData({ abi: MINT_ABI, functionName: 'mintFree', args: [design, v, signature, BigInt(free.tao_total), BigInt(free.free_mints), free.proof] })
    : encodeFunctionData({ abi: MINT_ABI, functionName: 'mint', args: [design, v, signature] });
  return { status: 200, design, hash, voucher, signature, tx: { to: deployment().extension, data, value: free ? '0x0' : `0x${PRICE_WEI.toString(16)}` } };
}

export { decodeDesign };
