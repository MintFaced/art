#!/usr/bin/env node
/* Build a TAO snapshot from the register: who holds what, who gets free mints,
 * the Merkle root to publish, and the table to put on Arweave.
 *
 *   node scripts/strips/snapshot.mjs --id 1 --label "Snapshot 1" [--out dir]
 *
 * COMBOs are read from delegate.xyz the way the site reads them (v2 ALL or the
 * `mintface` rights, and v1 ALL) so a vault's TAO counts once, on its hot
 * wallet. A vault that names two hot wallets counts on the one holding the most
 * TAO, ties to the lowest address, so the table comes out the same whoever runs
 * it. 6529's registry joins in if COMBO_DOORS ever opens it on the site.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, fallback, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { allowances, rootOf, freeMintsOf } from '../../api/_lib/strips-snapshot.js';
import { V1, V2, RIGHTS_ALL, RIGHTS_MINTFACE } from '../../api/_lib/delegate.js';

const arg = (name, fallbackValue) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallbackValue; };
const ID = Number(arg('id', 1));
const LABEL = arg('label', `Snapshot ${ID}`);
const OUT = arg('out', new URL('../../data/', import.meta.url).pathname);
const REGISTER = arg('register', new URL('../../data/collectors-register.json', import.meta.url).pathname);
const SKIP_COMBOS = process.argv.includes('--no-combos');

const register = JSON.parse(readFileSync(REGISTER, 'utf8'));
const at = (name) => register.fields.indexOf(name);
const ADDRESS = at('address') >= 0 ? at('address') : 0;
const TAO = at('tao_total') >= 0 ? at('tao_total') : at('tao');
if (TAO < 0) throw new Error(`no TAO column in ${register.fields}`);
const rows = register.rows.map((r) => ({ wallet: String(r[ADDRESS]).toLowerCase(), tao_total: Math.floor(Number(r[TAO]) || 0) })).filter((r) => r.tao_total > 0);

const OUTGOING = parseAbi(['struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }', 'function getOutgoingDelegations(address from) view returns (Delegation[])']);
const OUTGOING_V1 = parseAbi(['function getDelegatesForAll(address vault) view returns (address[])']);
const client = createPublicClient({ chain: mainnet, batch: { multicall: { batchSize: 2048 } }, transport: fallback([process.env.ETH_RPC, 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'].filter(Boolean).map((u) => http(u, { timeout: 20000 }))) });
const TYPE_ALL = 1;

async function combos() {
  const tao = new Map(rows.map((r) => [r.wallet, r.tao_total]));
  const out = new Map();
  for (let i = 0; i < rows.length; i += 300) {
    const part = rows.slice(i, i + 300);
    const [found, older] = await Promise.all([
      Promise.all(part.map((r) => client.readContract({ address: V2, abi: OUTGOING, functionName: 'getOutgoingDelegations', args: [r.wallet] }).catch(() => []))),
      Promise.all(part.map((r) => client.readContract({ address: V1, abi: OUTGOING_V1, functionName: 'getDelegatesForAll', args: [r.wallet] }).catch(() => []))),
    ]);
    part.forEach((r, n) => {
      const v2 = found[n].filter((d) => d.type_ === TYPE_ALL && [RIGHTS_ALL, RIGHTS_MINTFACE].includes(d.rights)).map((d) => d.to);
      const hots = [...new Set([...v2, ...older[n]].map((a) => a.toLowerCase()))].filter((a) => a !== r.wallet);
      if (!hots.length) return;
      hots.sort((a, b) => (tao.get(b) || 0) - (tao.get(a) || 0) || (a < b ? -1 : 1));
      out.set(r.wallet, hots[0]);
    });
  }
  /* one hop: a wallet that is itself somebody's vault doesn't collect for others */
  for (const [vault, hot] of out) if (out.has(hot)) out.delete(vault);
  return out;
}

const combo = SKIP_COMBOS ? new Map() : await combos();
const table = allowances(rows, combo);
const root = rootOf(table);
const taken_at = Math.floor(Date.now() / 1000);
const free = table.reduce((s, r) => s + r.free_mints, 0);

mkdirSync(OUT, { recursive: true });
const file = { id: ID, label: LABEL, taken_at, register_generated: register.generated, root, rows: table };
writeFileSync(`${OUT}/strips-snapshot-${ID}.json`, `${JSON.stringify(file)}\n`);
writeFileSync(`${OUT}/strips-snapshot-${ID}.csv`, `wallet,tao_total,free_mints\n${table.map((r) => `${r.wallet},${r.tao_total},${r.free_mints}`).join('\n')}\n`);
console.log(JSON.stringify({ id: ID, label: LABEL, root, taken_at, register_generated: register.generated, wallets: table.length, combos: combo.size, free_mints: free, one: table.filter((r) => r.free_mints === 1).length, two: table.filter((r) => r.free_mints === 2).length }, null, 1));
if (freeMintsOf(99_999) !== 0 || freeMintsOf(100_000) !== 1 || freeMintsOf(419_999) !== 1 || freeMintsOf(420_000) !== 2) throw new Error('the tiers have moved');
