#!/usr/bin/env node
/* Does the register account for everyone the chain says holds art?
 *
 * The register is derived from data/c, and data/c is written by the sweep. So
 * checking one against the other proves nothing: a collector the sweep never
 * saw is missing from both, consistently. The only test that can fail is
 * against the chain's own Transfer logs, replayed independently.
 *
 * The equation, which must hold exactly:
 *
 *   distinct addresses holding a tracked token   (from Transfer logs)
 * - the exclusion list                           (artist, vault, escrow, burn)
 * = register entries
 *
 * A difference that is not exactly the exclusions is a collector nobody has
 * counted. Until it balances we are finding missing collectors by
 * embarrassment.
 *
 *   node scripts/check-register-balance.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KEY = process.env.ETHERSCAN_API_KEY;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/tao.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T1155_ONE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const T1155_MANY = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const addrOf = (t) => ('0x' + t.slice(-40)).toLowerCase();
const words = (d0) => {
  const d = d0.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= d.length; i += 64) out.push('0x' + d.slice(i, i + 64));
  return out;
};

async function es(params) {
  const url = `https://api.etherscan.io/v2/api?${new URLSearchParams({ chainid: '1', apikey: KEY, ...params })}`;
  for (let i = 0; i < 5; i++) {
    try {
      const j = await (await fetch(url)).json();
      if (j.status === '1') return j.result;
      if (j.message === 'No records found' || /no records/i.test(String(j.result))) return [];
      if (/rate limit|max calls/i.test(String(j.result))) { await sleep(1300); continue; }
      if (/window is too large|result window|more than 1000/i.test(String(j.result))) return '__SPLIT__';
      return [];
    } catch (e) { await sleep(700 * (i + 1)); }
  }
  return [];
}
async function sweep(addr, topic, from, to) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: topic, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' });
  await sleep(200);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep(addr, topic, from, mid)).concat(await sweep(addr, topic, mid + 1, to));
  }
  return Array.isArray(r) ? r : [];
}

/* ---------- every token the catalogue tracks, and who holds it per the chain ---------- */
const tracked = new Map();            // contract -> { std, ids:Set }
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (col.slug === 'the-vault') continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    const d = w.digital || {};
    if (d.chain !== 'ethereum' || !d.contract) continue;
    const a = d.contract.toLowerCase();
    if (!tracked.has(a)) tracked.set(a, { std: d.standard, ids: new Set() });
    for (const id of (w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id])) tracked.get(a).ids.add(String(id));
  }
}

const bal = new Map();                // contract|token -> Map(addr -> qty)
const put = (c, t, from, to, q) => {
  const k = `${c}|${t}`;
  if (!bal.has(k)) bal.set(k, new Map());
  const m = bal.get(k);
  if (from) m.set(from, (m.get(from) || 0) - q);
  if (to) m.set(to, (m.get(to) || 0) + q);
};

// the cached event history first, since most contracts already have one
const cached = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tao/e', f), 'utf8'));
  cached.add(d.contract);
  for (const [token, from, to, qty] of d.events) put(d.contract, token, from, to, Number(qty) || 1);
}

// and the contracts TAO deliberately leaves out, which the register still counts
const missing = [...tracked.keys()].filter((a) => !cached.has(a));
if (missing.length) {
  if (!KEY) { console.error('ETHERSCAN_API_KEY is needed to read the contracts TAO does not cache'); process.exit(1); }
  const head = await (async () => {
    const r = await fetch('https://ethereum-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
    return parseInt((await r.json()).result, 16);
  })();
  for (const a of missing) {
    const t = tracked.get(a);
    process.stderr.write(`  reading ${a} (${t.ids.size} tokens, not in the TAO cache) ... `);
    let n = 0;
    for (const topic of (t.std === 'ERC-1155' ? [T1155_ONE, T1155_MANY] : [T721])) {
      for (const l of await sweep(a, topic, 1, head)) {
        if (topic === T721) {
          if (!l.topics || l.topics.length < 4) continue;
          const id = BigInt(l.topics[3]).toString();
          if (!t.ids.has(id)) continue;
          put(a, id, addrOf(l.topics[1]), addrOf(l.topics[2]), 1); n++;
        } else if (topic === T1155_ONE) {
          const w = words(l.data);
          if (w.length < 2) continue;
          const id = BigInt(w[0]).toString();
          if (!t.ids.has(id)) continue;
          put(a, id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[1]))); n++;
        } else {
          const w = words(l.data);
          if (w.length < 4) continue;
          const idsAt = Number(BigInt(w[0])) / 32, valsAt = Number(BigInt(w[1])) / 32;
          const c = Number(BigInt(w[idsAt] || '0x0'));
          for (let i = 0; i < c; i++) {
            const id = BigInt(w[idsAt + 1 + i] || '0x0').toString();
            if (!t.ids.has(id)) continue;
            put(a, id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[valsAt + 1 + i] || '0x0'))); n++;
          }
        }
      }
    }
    process.stderr.write(`${n} events\n`);
  }
}

/* ---------- the two sides ---------- */
const onChain = new Set();
for (const m of bal.values()) for (const [a, q] of m) if (q > 0) onChain.add(a);

const excluded = new Set(Object.keys(CFG.exclusions).filter((k) => k.startsWith('0x')));
// the register's own exclusion list, which is the one that decides
const src = fs.readFileSync(path.join(ROOT, 'api/_lib/collectors.js'), 'utf8');
for (const m of src.matchAll(/'(0x[0-9a-f]{40})'/g)) excluded.add(m[1]);

/* The register is every collector, which is data/collectors-register.json.
   data/collectors.json carries only the ones with a page ... comparing against
   that would report 2,873 missing people who are not missing at all, just
   below the threshold for a page of their own. */
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/collectors-register.json'), 'utf8'));
const at = reg.fields.indexOf('address');
const registered = new Set(reg.rows.map((r) => String(r[at]).toLowerCase()));

const shouldBe = [...onChain].filter((a) => !excluded.has(a));
const missingFromRegister = shouldBe.filter((a) => !registered.has(a));
const inRegisterOnly = [...registered].filter((a) => !onChain.has(a));
const exclusionsSeen = [...onChain].filter((a) => excluded.has(a));

console.log('\nREGISTER BALANCE\n' + '='.repeat(64));
console.log(`  ${String(onChain.size).padStart(6)}  addresses holding a tracked token, per Transfer logs`);
console.log(`- ${String(exclusionsSeen.length).padStart(6)}  on the exclusion list (artist, vault, escrow, burn)`);
console.log(`  ${'-'.repeat(6)}`);
console.log(`  ${String(onChain.size - exclusionsSeen.length).padStart(6)}  should be in the register`);
console.log(`  ${String(registered.size).padStart(6)}  are in the register`);
const diff = (onChain.size - exclusionsSeen.length) - registered.size;
console.log(`\n  difference: ${diff === 0 ? 'none ... it balances' : diff}`);
if (missingFromRegister.length) {
  console.log(`\n  ${missingFromRegister.length} hold art and are NOT in the register:`);
  for (const a of missingFromRegister.slice(0, 25)) console.log(`     ${a}`);
  if (missingFromRegister.length > 25) console.log(`     ... and ${missingFromRegister.length - 25} more`);
}
if (inRegisterOnly.length) {
  console.log(`\n  ${inRegisterOnly.length} in the register hold nothing per the logs:`);
  for (const a of inRegisterOnly.slice(0, 15)) console.log(`     ${a}`);
  if (inRegisterOnly.length > 15) console.log(`     ... and ${inRegisterOnly.length - 15} more`);
}
console.log(`\n  exclusions actually seen holding: ${exclusionsSeen.length} of ${excluded.size} listed`);
process.exit(missingFromRegister.length || inRegisterOnly.length ? 1 : 0);
