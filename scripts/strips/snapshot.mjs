#!/usr/bin/env node
/* Build a TAO snapshot: who gets free mints, the Merkle root to publish, and the
 * tables to deploy and put on Arweave.
 *
 *   node scripts/strips/snapshot.mjs --id 1 --rpc-a <url> --rpc-b <url>
 *        [--label "Snapshot 1"] [--data dir] [--out dir] [--repo dir] [--replace]
 *
 * It exits 0 only with a root two different providers agree on, at the same
 * block, from a register that's current with origin/main. Anything else writes
 * nothing and exits 1. There's no flag that skips a check.
 *
 * COMBOs are read from delegate.xyz the way the site reads them (v2 ALL or the
 * `mintface` rights, and v1 ALL) so a vault's TAO counts once, on its hot
 * wallet. A vault that names two hot wallets counts on the one holding the most
 * TAO, ties to the lowest address, so the table comes out the same whoever runs
 * it. 6529's registry joins in if COMBO_DOORS ever opens it on the site.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freeMintsOf } from '../../api/_lib/strips-snapshot.js';
import { assertCurrent, assertFresh, assertHolders, buildTable, clientFor, excludedKeys, holdings, reader, readData, RULE } from './snapshot-build.mjs';

const SAFE_DEPTH = 16n; // far enough back that both providers have the same block

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const FLAGS = ['--id', '--rpc-a', '--rpc-b', '--label', '--data', '--out', '--repo', '--replace'];
const unknown = process.argv.slice(2).filter((a) => a.startsWith('--') && !FLAGS.includes(a));
if (unknown.length) { console.error(`snapshot: no such flag: ${unknown.join(' ')}. The block is chosen here, not passed in.`); process.exit(1); }

async function main() {
  if (freeMintsOf(99_999) !== 0 || freeMintsOf(100_000) !== 1 || freeMintsOf(419_999) !== 1 || freeMintsOf(420_000) !== 2) throw new Error('the tiers have moved');
  const id = Number(arg('id', 0));
  if (!Number.isInteger(id) || id < 1) throw new Error('--id is the snapshot number');
  const label = arg('label', `Snapshot ${id}`);
  const repo = resolve(arg('repo', new URL('../..', import.meta.url).pathname));
  const data = resolve(arg('data', `${repo}/data`));
  const out = resolve(arg('out', `${repo}/data`));
  const rpcA = arg('rpc-a', process.env.STRIPS_RPC_A || process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com');
  const rpcB = arg('rpc-b', process.env.STRIPS_RPC_B || 'https://eth.drpc.org');
  if (new URL(rpcA).host === new URL(rpcB).host) throw new Error('--rpc-a and --rpc-b are the same provider. The point is two.');

  const main_commit = assertCurrent({ repo, data });
  const d = readData(data);
  assertFresh(d);
  const { at: taken_at, ever } = holdings(d);

  const a = clientFor(rpcA);
  const b = clientFor(rpcB);
  const blockNumber = (await a.getBlockNumber({ cacheTime: 0 })) - SAFE_DEPTH;
  const [blockA, blockB] = await Promise.all([a.getBlock({ blockNumber }), b.getBlock({ blockNumber })]);
  if (blockA.hash !== blockB.hash) throw new Error(`the providers disagree about block ${blockNumber}: ${blockA.hash}, ${blockB.hash}`);

  const [one, two] = await Promise.all([buildTable(d, ever, reader(rpcA, blockNumber)), buildTable(d, ever, reader(rpcB, blockNumber))]);
  if (one.root !== two.root || JSON.stringify(one) !== JSON.stringify(two)) throw new Error(`the providers built different tables: ${one.root}, ${two.root}`);
  assertHolders(one.rows, d.register);

  const free_mints = one.rows.reduce((n, r) => n + r.free_mints, 0);
  const path = `${out}/strips-snapshot-${id}`;
  if (existsSync(`${path}.json`) && !process.argv.includes('--replace')) {
    const was = JSON.parse(readFileSync(`${path}.json`, 'utf8')).root;
    if (was !== one.root) throw new Error(`${path}.json already holds ${was}, not ${one.root}. If that's published, this one mustn't replace it. --replace if it isn't.`);
  }

  const exclusions = { keys: excludedKeys(d.cfg), wallets: one.struck };
  const file = {
    id, label, rule: RULE, taken_at, block: Number(blockNumber), block_hash: blockA.hash, main_commit,
    tao_generated: d.tao.generated, register_generated: d.register.generated, root: one.root, free_mints, rows: one.rows, exclusions,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(`${path}.json`, `${JSON.stringify(file)}\n`);
  writeFileSync(`${path}.csv`, `wallet,tao_total,free_mints\n${one.rows.map((r) => `${r.wallet},${r.tao_total},${r.free_mints}`).join('\n')}\n`);
  writeFileSync(`${path}-exclusions.csv`, `wallet,tao_total,free_mints_lost,why\n${one.struck.map((r) => `${r.wallet},${r.tao_total},${r.free_mints_lost},"${r.why}"`).join('\n')}\n`);
  console.log(JSON.stringify({
    id, label, root: one.root, taken_at, block: Number(blockNumber), main_commit, tao_generated: d.tao.generated, register_generated: d.register.generated,
    wallets: one.rows.length, combos: one.combos, free_mints, one: one.rows.filter((r) => r.free_mints === 1).length, two: one.rows.filter((r) => r.free_mints === 2).length,
    excluded: one.struck.length, free_mints_excluded: one.struck.reduce((n, r) => n + r.free_mints_lost, 0),
  }, null, 1));
}

main().catch((e) => { console.error(`NO SNAPSHOT. ${e.shortMessage || e.message}`); process.exit(1); });
