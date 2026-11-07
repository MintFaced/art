#!/usr/bin/env node
/* The check a snapshot table has to pass before it can be published.
 *
 *   node scripts/strips/audit-snapshot.mjs <strips-snapshot-N.json> --rpc <url> [--data dir] [--repo dir] [--accept file]
 *
 * After the first claim a table can't be put right, so this reads the table's own
 * rows and fields, not the build's working:
 *
 *   every row, against a fresh build from the same data, with the delegations and
 *     signers read again at the table's block through this provider
 *   every row's TAO, and every holder's, against a separate sum outside the engine
 *   the table's own fields: id, rule, block, hash, time, commit and exclusions
 *   what the events say is held, and each edition's supply, against the chain at
 *     the table's block
 *
 * What it can't do. It reads the same event cache the build did, so an event
 * missing from that cache only shows up here as a holding or a supply that
 * disagrees with the chain, and an edition whose contract won't state its supply
 * is listed as unchecked rather than checked. It says nothing about whether the
 * rule itself is right. Run it straight after the build: an ordinary node only
 * keeps about half an hour of state.
 *
 * Any disagreement fails it. One that has been looked at and is known to be
 * harmless, such as a sale after the TAO run, goes in an --accept file as
 * [{ wallet, contract, token, reason }], and the reason is published with the
 * result. There's no other way past it.
 *
 * A pass writes strips-snapshot-N-audit.json beside the table. It's deployed with
 * the table, and the console won't publish a table without it. A failure removes
 * any earlier pass.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { rootOf } from '../../api/_lib/strips-snapshot.js';
import { buildTable, clientFor, excludedKeys, holdings, reader, readData, RULE } from './snapshot-build.mjs';

const AGGREGATE = parseAbi(['struct Call { address target; bool allowFailure; bytes callData; }', 'struct Result { bool success; bytes returnData; }', 'function aggregate3(Call[] calls) payable returns (Result[])']);
const NFT = parseAbi(['function ownerOf(uint256) view returns (address)', 'function balanceOf(address, uint256) view returns (uint256)', 'function totalSupply(uint256) view returns (uint256)']);
const ZERO = /^0x0{40}$/;

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const lower = (a) => String(a).toLowerCase();

/** Who the events say holds what: plain sums, with no TAO in them. */
function balances(d) {
  const out = new Map();
  for (const e of d.events) {
    const k = `${e.contract}|${e.token}`;
    if (!d.tokens.has(k)) continue;
    if (!out.has(k)) out.set(k, new Map());
    const m = out.get(k);
    m.set(lower(e.from), (m.get(lower(e.from)) || 0) - e.qty);
    m.set(lower(e.to), (m.get(lower(e.to)) || 0) + e.qty);
  }
  return out;
}

/** Each wallet's TAO on what it holds, token by token, without the engine. */
function taoByHand(d, at, carries) {
  const unique = d.cfg.rates.unique_per_day;
  const copy = d.cfg.rates.edition_copy_per_day;
  const excluded = new Set(Object.keys(d.cfg.exclusions).filter((k) => k.startsWith('0x')));
  const byToken = new Map();
  for (const e of d.events) {
    const k = `${e.contract}|${e.token}`;
    if (!d.tokens.has(k)) continue;
    if (!byToken.has(k)) byToken.set(k, []);
    byToken.get(k).push(e);
  }
  const out = new Map();
  for (const [k, list] of byToken) {
    const perDay = (qty) => (d.tokens.get(k).unique ? unique : copy * qty);
    const lots = new Map();
    const accrue = (lot, ts) => { if (ts > lot.since) { lot.earned += ((ts - lot.since) / 86400) * perDay(lot.qty); lot.since = ts; } };
    for (const e of list) {
      const from = lower(e.from);
      const to = lower(e.to);
      const lot = lots.get(from);
      let left = 0;
      if (lot && !excluded.has(from)) {
        accrue(lot, e.ts);
        const moved = Math.min(e.qty, lot.qty);
        left = lot.earned * (moved / lot.qty);
        lot.earned -= left;
        lot.qty -= moved;
        if (lot.qty <= 0) lots.delete(from);
      }
      if (excluded.has(to)) continue;
      const there = lots.get(to);
      if (there) { accrue(there, e.ts); there.qty += e.qty; } else lots.set(to, { qty: e.qty, earned: 0, since: e.ts });
      if (left && carries && e.sale !== true && carries(from, to)) lots.get(to).earned += left;
    }
    for (const [wallet, lot] of lots) { accrue(lot, at); out.set(wallet, (out.get(wallet) || 0) + lot.earned); }
  }
  return out;
}

/** The fields a table carries about itself. */
async function fieldProblems(table, path, d, at, client, repo) {
  const out = [];
  const named = /^strips-snapshot-(\d+)\.json$/.exec(basename(path));
  if (!named || Number(named[1]) !== table.id) out.push(`the file is ${basename(path)} and the table says snapshot ${table.id}`);
  if (table.rule !== RULE) out.push('the table\'s rule isn\'t the rule');
  if (table.taken_at !== at) out.push(`taken_at is ${table.taken_at}, and the TAO run was ${at}`);
  if (table.tao_generated !== d.tao.generated) out.push('tao_generated isn\'t this data\'s');
  if (table.register_generated !== d.register.generated) out.push('register_generated isn\'t this data\'s');
  const block = await client.getBlock({ blockNumber: BigInt(table.block) });
  if (block.hash !== table.block_hash) out.push(`block ${table.block} is ${block.hash}, not ${table.block_hash}`);
  try { execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', String(table.main_commit), 'origin/main'], { stdio: 'ignore' }); } catch { out.push(`${table.main_commit} isn't on origin/main`); }
  return out;
}

/** The table's rows and exclusions against a fresh build. */
function buildProblems(table, fresh, d) {
  const out = [];
  if (fresh.root !== table.root) out.push(`a fresh build gives ${fresh.root}`);
  const was = new Map(table.rows.map((r) => [lower(r.wallet), JSON.stringify(r)]));
  const now = new Map(fresh.rows.map((r) => [lower(r.wallet), JSON.stringify(r)]));
  const differ = [...new Set([...was.keys(), ...now.keys()])].filter((w) => was.get(w) !== now.get(w));
  if (differ.length) out.push(`${differ.length} rows differ from a fresh build: ${differ.slice(0, 3).join(', ')}`);
  if (table.rows.length !== was.size) out.push('a wallet has two rows');
  if (JSON.stringify(table.exclusions.keys) !== JSON.stringify(excludedKeys(d.cfg))) out.push('the excluded keys aren\'t the configured ones');
  if (JSON.stringify(table.exclusions.wallets) !== JSON.stringify(fresh.struck)) out.push('the struck wallets aren\'t a fresh build\'s');
  return out;
}

/** Every row's TAO, and every holder's, against the sum by hand. */
function taoProblems(table, hand) {
  const out = [];
  const rows = new Map(table.rows.map((r) => [lower(r.wallet), r]));
  const off = table.rows.filter((r) => r.tao_total > 0 && Math.abs(Math.floor(hand.get(lower(r.wallet)) || 0) - r.tao_total) > 1);
  if (off.length) out.push(`${off.length} rows' TAO doesn't match by hand: ${off.slice(0, 3).map((r) => r.wallet).join(', ')}`);
  const struck = new Set([...table.exclusions.wallets.map((x) => lower(x.wallet)), ...Object.keys(table.exclusions.keys).map(lower)]);
  const missing = [...hand].filter(([w, tao]) => Math.floor(tao) > 0 && !struck.has(w) && !(rows.get(w) && rows.get(w).tao_total > 0)).map(([w]) => w);
  if (missing.length) out.push(`${missing.length} holders have no row: ${missing.slice(0, 3).join(', ')}`);
  return out;
}

/** What the chain says, at the table's block, about what the events say. */
async function chainCheck(d, data, client, blockNumber) {
  const standard = new Map(readdirSync(join(data, 'tao/e')).filter((n) => n.endsWith('.json')).map((n) => { const f = JSON.parse(readFileSync(join(data, 'tao/e', n), 'utf8')); return [f.contract, f.standard]; }));
  const known = balances(d);
  const checks = [];
  for (const [k, held] of known) {
    const [contract, token] = k.split('|');
    const many = standard.get(contract) === 'ERC-1155';
    for (const [wallet, qty] of held) if (qty > 0 && !ZERO.test(wallet)) checks.push({ contract, token, wallet, qty, many });
    if (many) checks.push({ contract, token, supply: [...held].reduce((n, [w, q]) => (q > 0 && !ZERO.test(w) ? n + q : n), 0) });
  }
  /* a work the events have never seen move, which is where a lost mint would be */
  for (const k of d.tokens.keys()) {
    const [contract, token] = k.split('|');
    if (!known.has(k) && standard.get(contract) === 'ERC-721') checks.push({ contract, token, wallet: 'nobody', many: false });
  }
  const data3 = (c) => (c.supply !== undefined ? encodeFunctionData({ abi: NFT, functionName: 'totalSupply', args: [BigInt(c.token)] })
    : c.many ? encodeFunctionData({ abi: NFT, functionName: 'balanceOf', args: [c.wallet, BigInt(c.token)] })
      : encodeFunctionData({ abi: NFT, functionName: 'ownerOf', args: [BigInt(c.token)] }));
  const calls = checks.map((c) => ({ target: c.contract, allowFailure: true, callData: data3(c) }));
  const replies = [];
  for (let i = 0; i < calls.length; i += 400) replies.push(...await client.readContract({ address: mainnet.contracts.multicall3.address, abi: AGGREGATE, functionName: 'aggregate3', args: [calls.slice(i, i + 400)], blockNumber }));
  const wrong = [];
  const unchecked = [];
  checks.forEach((c, n) => {
    const r = replies[n];
    const silent = !r.success || r.returnData === '0x';
    if (c.supply !== undefined) {
      if (silent) { unchecked.push(`${c.contract}#${c.token}`); return; }
      const said = String(decodeFunctionResult({ abi: NFT, functionName: 'totalSupply', data: r.returnData }));
      if (said !== String(c.supply)) wrong.push({ contract: c.contract, token: c.token, wallet: 'supply', events: c.supply, chain: said });
      return;
    }
    const said = silent ? 'nothing'
      : c.many ? String(decodeFunctionResult({ abi: NFT, functionName: 'balanceOf', data: r.returnData }))
        : lower(decodeFunctionResult({ abi: NFT, functionName: 'ownerOf', data: r.returnData }));
    const want = c.wallet === 'nobody' ? 'nothing' : c.many ? String(c.qty) : c.wallet;
    if (said !== want) wrong.push({ contract: c.contract, token: c.token, wallet: c.wallet, events: c.many ? c.qty : c.wallet, chain: said });
  });
  return { checked: checks.length, wrong, unchecked };
}

/** Disagreements somebody has looked at, each with its reason. */
function accepted(path) {
  if (!path) return [];
  const list = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(list)) throw new Error('--accept is a list');
  for (const a of list) if (!a.wallet || !a.contract || a.token == null || !String(a.reason || '').trim()) throw new Error('every accepted disagreement needs a wallet, a contract, a token and a reason');
  return list;
}

async function main() {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) throw new Error('give it a table');
  const stamp = resolve(path).replace(/\.json$/, '-audit.json');
  rmSync(stamp, { force: true });
  const table = JSON.parse(readFileSync(path, 'utf8'));
  const repo = resolve(arg('repo', new URL('../..', import.meta.url).pathname));
  const data = resolve(arg('data', `${repo}/data`));
  const rpc = arg('rpc', process.env.STRIPS_RPC_A || process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com');
  const allowed = accepted(arg('accept'));
  const d = readData(data);
  const client = clientFor(rpc);
  const blockNumber = BigInt(table.block);
  const problems = [];

  /* the table against itself */
  if (rootOf(table.rows) !== table.root) problems.push('the rows don\'t rebuild to the root');
  const free = table.rows.reduce((n, r) => n + r.free_mints, 0);
  if (free !== table.free_mints) problems.push(`the free mints add up to ${free}, not ${table.free_mints}`);

  const { at, ever } = holdings(d);
  problems.push(...await fieldProblems(table, path, d, at, client, repo));

  /* the rows against a fresh build, and against the sum by hand */
  const fresh = await buildTable(d, ever, reader(rpc, blockNumber));
  problems.push(...buildProblems(table, fresh, d));
  const hand = taoByHand(d, at, fresh.carries);
  problems.push(...taoProblems(table, hand));

  /* the chain */
  const { checked, wrong, unchecked } = await chainCheck(d, data, client, blockNumber);
  const ok = (c) => allowed.find((a) => lower(a.wallet) === c.wallet && lower(a.contract) === c.contract && String(a.token) === c.token);
  const open = wrong.filter((c) => !ok(c));
  if (open.length) problems.push(`${open.length} of what the events say doesn't match the chain: ${open.slice(0, 3).map((c) => `${c.wallet} ${c.contract}#${c.token}, events ${c.events}, chain ${c.chain}`).join('; ')}`);

  const result = {
    id: table.id, root: table.root, block: table.block, free_mints: table.free_mints, rows_checked: table.rows.length, tao_checked_by_hand: hand.size,
    chain_checked: checked, chain_match: checked - wrong.length, chain_disagrees: wrong, accepted: wrong.filter(ok).map((c) => ({ ...c, reason: ok(c).reason })), supply_unchecked: unchecked,
  };
  console.log(JSON.stringify({ ...result, chain_disagrees: wrong.length, supply_unchecked: unchecked.length }, null, 1));
  if (problems.length) throw new Error(problems.join('\n'));
  writeFileSync(stamp, `${JSON.stringify({ ...result, ok: true, audited_at: new Date().toISOString() })}\n`);
  console.log(`Passed. ${basename(stamp)} goes up with the table.`);
}

main().catch((e) => { console.error(`AUDIT FAILED. ${e.shortMessage || e.message}`); process.exit(1); });
