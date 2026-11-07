/* What scripts/strips/snapshot.mjs does, kept apart from the command so the tests
 * can reach it.
 *
 * The rule, as Ryan set it on 6 Nov 2026: current holders only, on what each
 * still holds. TAO is worked out NFT by NFT from the whole event history, so
 * selling 1 of 5 costs the TAO on that one and the 4 keep theirs. Days banked on
 * anything sold or given away don't count here, and a wallet holding nothing
 * isn't in the table, whatever data/tao.json says it has banked. Sold or given
 * makes no difference to this number: either way the holding has gone.
 *
 * A move to a new wallet starts from zero too, unless the two wallets are one
 * COMBO: then it's the same collector, and the days move with the NFT.
 *
 * A wrong root is worse than no root, so nothing here catches and carries on.
 * An unreadable provider, a stale register or a disagreement stops the run.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { computeTao, copiesOf } from '../../api/_lib/tao.js';
import { allowances, freeMintsOf, rootOf, struckOut } from '../../api/_lib/strips-snapshot.js';
import { V1, V2, RIGHTS_ALL, RIGHTS_MINTFACE } from '../../api/_lib/delegate.js';

export const MAX_TAO_AGE_HOURS = 26;

/* Out of the free mints without leaving the TAO board, which is what being in
   the TAO exclusions would do. By address, because a name can change hands. */
export const ALSO_EXCLUDED = { '0x40d2f4399d23f9afb82d0a6b73055f13208614f9': 'excluded by the artist' };

export const excludedKeys = (cfg) => ({ ...Object.fromEntries(Object.entries(cfg.exclusions).filter(([k]) => k.startsWith('0x'))), ...ALSO_EXCLUDED });

export const RULE = 'Current holders only. TAO is counted NFT by NFT on what each wallet holds now. A sale costs the TAO on that NFT and no other. A move to another wallet starts from zero unless the two wallets are one COMBO. Exclusions apply after delegation resolves.';

/* what the table is built from, relative to the repo */
const FILES = ['data/collectors-register.json', 'data/tao.json', 'data/tao/sales.json', 'data/tao/runs.json', 'data/source/tao.json'];
const FOLDERS = ['data/tao/e', 'data/c'];

const json = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));
const jsons = (dir, path) => readdirSync(join(dir, path)).filter((n) => n.endsWith('.json')).sort();

/** Refuses unless `data` is byte for byte what's on origin/main right now. */
export function assertCurrent({ repo, data }) {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  git('fetch', '--quiet', 'origin', 'main');
  const commit = git('rev-parse', 'origin/main').trim();
  const remote = new Map(git('ls-tree', '-r', 'origin/main', '--', ...FILES, ...FOLDERS).trim().split('\n').filter(Boolean)
    .map((line) => { const [meta, path] = line.split('\t'); return [path, meta.split(' ')[2]]; }));
  const blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const local = (path) => join(data, path.replace(/^data\//, ''));
  const behind = [];
  for (const path of FILES) if (!remote.has(path)) throw new Error(`${path} isn't on origin/main`);
  for (const [path, sha] of remote) {
    if (!existsSync(local(path)) || blob(readFileSync(local(path))) !== sha) behind.push(path);
  }
  for (const folder of FOLDERS) {
    for (const name of jsons(data, folder.replace(/^data\//, ''))) if (!remote.has(`${folder}/${name}`)) behind.push(`${folder}/${name}`);
  }
  if (behind.length) throw new Error(`not current with origin/main (${commit.slice(0, 8)}): ${behind.slice(0, 5).join(', ')}${behind.length > 5 ? ` and ${behind.length - 5} more` : ''}. Pull, then run this again.`);
  return commit;
}

/** Everything off the disk, the way scripts/tao/build.mjs reads it. */
export function readData(data) {
  const cfg = json(data, 'source/tao.json');
  const skip = new Set(cfg.scope.exclude_collections);
  const tokens = new Map();
  for (const name of jsons(data, 'c')) {
    const col = json(data, `c/${name}`);
    if (skip.has(col.slug)) continue;
    for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
      const d = w.digital || {};
      if (!cfg.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
      const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
      for (const id of w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id]) tokens.set(`${d.contract.toLowerCase()}|${id}`, { unique, work: w.id, collection: col.slug });
    }
  }
  const sales = json(data, 'tao/sales.json');
  const events = [];
  for (const name of jsons(data, 'tao/e')) {
    const f = json(data, `tao/e/${name}`);
    for (const [token, from, to, qty, ts, block, tx] of f.events) {
      if (copiesOf(qty)) events.push({ contract: f.contract, token, from, to, qty: copiesOf(qty), ts, block, tx, sale: Boolean(sales.tx[tx] && sales.tx[tx].sale) });
    }
  }
  events.sort((a, b) => a.ts - b.ts || a.block - b.block);
  return { cfg, tokens, events, tao: json(data, 'tao.json'), runs: json(data, 'tao/runs.json'), register: json(data, 'collectors-register.json') };
}

/** The last TAO run has to have worked, and to be last night's. */
export function assertFresh({ tao, runs }, now = Date.now() / 1000) {
  const last = (runs.runs || [])[0];
  if (!last || last.ok !== true) throw new Error(`the last TAO run didn't finish: ${last ? last.error || last.at : 'there isn\'t one'}`);
  const hours = (now - Date.parse(tao.generated) / 1000) / 3600;
  if (!(hours <= MAX_TAO_AGE_HOURS)) throw new Error(`data/tao.json is ${Math.round(hours)} hours old. Wait for tonight's run.`);
}

/**
 * Each wallet and the TAO on what it holds now, as of the last TAO run. A run
 * without `carries` has to reproduce data/tao.json, or the history isn't what
 * the site read. `ever` is everyone who has held anything: a wallet can have
 * moved everything to its COMBO and hold nothing now.
 */
export function holdings({ cfg, tokens, events, tao }, carries = null) {
  const at = Math.floor(Date.parse(tao.generated) / 1000);
  const { wallets } = computeTao(events, tokens, cfg, at);
  const earning = wallets.filter((w) => w.tao_total > 0);
  const off = earning.filter((w) => Math.abs(((tao.wallets[w.address] || {}).tao ?? -2) - w.tao_total) > 1);
  if (off.length || earning.length !== Object.keys(tao.wallets).length) throw new Error(`the history doesn't reproduce data/tao.json: ${off.length} wallets differ, ${earning.length} earning against ${Object.keys(tao.wallets).length}`);
  const current = carries ? computeTao(events, tokens, cfg, at, { carries }).wallets : wallets;
  const rows = current.filter((w) => w.copies_held > 0 && w.tao_held > 0).map((w) => ({ wallet: w.address, tao_total: w.tao_held }));
  return { at, rows: rows.sort((a, b) => (a.wallet < b.wallet ? -1 : 1)), ever: wallets.map((w) => w.address).sort() };
}

/** Each wallet's hot wallets. `read` answers with both registries. */
export async function delegatesOf(wallets, read) {
  const { v2, v1 } = await read.delegations(wallets);
  const out = new Map();
  wallets.forEach((wallet, n) => {
    const scoped = v2[n].filter((d) => d.type_ === 1 && [RIGHTS_ALL, RIGHTS_MINTFACE].includes(d.rights)).map((d) => d.to);
    const hots = [...new Set([...scoped, ...v1[n]].map((a) => a.toLowerCase()))].filter((a) => a !== wallet);
    if (hots.length) out.set(wallet, hots);
  });
  return out;
}

/** Two wallets are one COMBO if one speaks through the other, or both speak
    through the same hot wallet. Read at the snapshot's block: the registries
    keep no dates, so a link stands for the whole history. */
export const oneCombo = (hots) => (a, b) => {
  const x = hots.get(a) || [];
  const y = hots.get(b) || [];
  return x.includes(b) || y.includes(a) || x.some((h) => y.includes(h));
};

/** A vault to the hot wallet it counts on. */
export function combosOf(rows, hots) {
  const tao = new Map(rows.map((r) => [r.wallet, r.tao_total]));
  const out = new Map();
  for (const { wallet } of rows) {
    if (!hots.has(wallet)) continue;
    const ranked = [...hots.get(wallet)].sort((a, b) => (tao.get(b) || 0) - (tao.get(a) || 0) || (a < b ? -1 : 1));
    out.set(wallet, ranked[0]);
  }
  /* one hop: a wallet that is itself somebody's vault doesn't collect for others */
  for (const [vault, hot] of out) if (out.has(hot)) out.delete(vault);
  return out;
}

/** Every excluded address, plus every wallet one of them signs for. */
export async function exclusionKeys(wallets, cfg, read) {
  const named = new Map(Object.entries(excludedKeys(cfg)));
  const keys = new Map(named);
  for (const [wallet, signers] of await read.signers(wallets)) {
    const key = signers.find((s) => named.has(s));
    if (key) keys.set(wallet, `${named.get(key)} signs for it`);
  }
  return keys;
}

/** One provider's answer. Two of these have to agree before anything is written. */
export async function buildTable(d, ever, read) {
  const hots = await delegatesOf(ever, read);
  /* Signers are read for everyone who has ever held, because the exclusions have
     to be known before the carry runs. An excluded wallet's days don't move: it
     could otherwise link to a friend, hand the work over, and hold nothing. */
  const keys = await exclusionKeys([...new Set([...ever, ...[...hots.values()].flat()])].sort(), d.cfg, read);
  const barred = (w) => keys.has(w) || (hots.get(w) || []).some((h) => keys.has(h));
  const linked = oneCombo(hots);
  const carries = (a, b) => !barred(a) && !barred(b) && linked(a, b);
  const { rows } = holdings(d, carries);
  const combo = combosOf(rows, hots);
  const table = allowances(rows, combo, keys);
  const tao = new Map(rows.map((r) => [r.wallet, r.tao_total]));
  const struck = [...struckOut(rows, combo, keys)].map(([wallet, why]) => ({ wallet, tao_total: tao.get(wallet) || 0, free_mints_lost: freeMintsOf(tao.get(wallet) || 0), why }))
    .sort((a, b) => b.tao_total - a.tao_total || (a.wallet < b.wallet ? -1 : 1));
  return { rows: table, root: rootOf(table), combos: combo.size, struck, carries };
}

/** Every claimant holds something on the register too, read by a separate sweep. */
export function assertHolders(table, register) {
  const at = (name) => register.fields.indexOf(name);
  const holders = new Set(register.rows.filter((r) => Number(r[at('works')]) > 0).map((r) => String(r[at('address')]).toLowerCase()));
  const missing = table.filter((r) => r.free_mints > 0 && r.tao_total > 0 && !holders.has(r.wallet.toLowerCase()));
  if (missing.length) throw new Error(`${missing.length} claimants aren't holders on the register: ${missing.slice(0, 3).map((r) => r.wallet).join(', ')}`);
}

const AGGREGATE = parseAbi(['struct Call { address target; bool allowFailure; bytes callData; }', 'struct Result { bool success; bytes returnData; }', 'function aggregate3(Call[] calls) payable returns (Result[])']);
const DELEGATIONS = parseAbi(['struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }', 'function getOutgoingDelegations(address from) view returns (Delegation[])']);
const DELEGATES_V1 = parseAbi(['function getDelegatesForAll(address vault) view returns (address[])']);
const SIGNERS = parseAbi(['function getOwners() view returns (address[])', 'function owner() view returns (address)']);

export const clientFor = (url) => createPublicClient({ chain: mainnet, transport: http(url, { timeout: 30_000, retryCount: 4, retryDelay: 400 }) });

/**
 * Reads at one block through one provider, and no other. This talks to
 * Multicall3 itself rather than through viem's multicall, whose allowFailure
 * reports a dead provider as a list of failed calls: that's how a clean-looking
 * run with no delegations in it happens. Here a transport error always throws,
 * and only a contract answering "no" is an answer.
 */
export function reader(url, blockNumber) {
  const client = clientFor(url);
  const address = mainnet.contracts.multicall3.address;
  const each = async (calls, size) => {
    const out = [];
    for (let i = 0; i < calls.length; i += size) {
      out.push(...await client.readContract({ address, abi: AGGREGATE, functionName: 'aggregate3', args: [calls.slice(i, i + size)], blockNumber }));
    }
    return out;
  };
  const call = (target, abi, functionName, args, allowFailure) => ({ target, allowFailure, callData: encodeFunctionData({ abi, functionName, args }) });
  const reply = (abi, functionName, r) => decodeFunctionResult({ abi, functionName, data: r.returnData });
  return {
    async delegations(wallets) {
      const [v2, v1] = await Promise.all([
        each(wallets.map((w) => call(V2, DELEGATIONS, 'getOutgoingDelegations', [w], false)), 100),
        each(wallets.map((w) => call(V1, DELEGATES_V1, 'getDelegatesForAll', [w], false)), 100),
      ]);
      return { v2: v2.map((r) => reply(DELEGATIONS, 'getOutgoingDelegations', r)), v1: v1.map((r) => reply(DELEGATES_V1, 'getDelegatesForAll', r)) };
    },
    /* a wallet that isn't a Safe answers nothing, or reverts. Both mean no signers */
    async signers(wallets) {
      const [owners, single] = await Promise.all([
        each(wallets.map((w) => call(w, SIGNERS, 'getOwners', [], true)), 200),
        each(wallets.map((w) => call(w, SIGNERS, 'owner', [], true)), 200),
      ]);
      const read = (r, name) => { if (!r.success || r.returnData === '0x') return []; try { return [reply(SIGNERS, name, r)].flat(); } catch { return []; } };
      return new Map(wallets.map((w, n) => [w, [...read(owners[n], 'getOwners'), ...read(single[n], 'owner')].map((a) => a.toLowerCase())]));
    },
  };
}
