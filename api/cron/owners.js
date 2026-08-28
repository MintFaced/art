import { readFile, writeFile } from '../_lib/repo.js';
import { mintsSince, readToken, buildRecord } from '../_lib/discover.js';
import { send } from '../_lib/email.js';
import { deriveCollectors, registerFile } from '../_lib/collectors.js';

/* Daily ownership reconciliation.
 *
 * Re-reads who holds every tokenised work and brings the catalogue back into
 * line with the chain. It is allowed to act on its own only where the change is
 * safe in one direction ... something coming OFF sale, or a record simply being
 * counted correctly. Anything that would put a work back ON sale, touch the
 * vault or an escrowed listing, or retire a priced and offered work, is flagged
 * for Ryan and left exactly as it was.
 *
 * The three guards below are not incidental. Each one is a mistake this
 * reconciliation actually made before it was written down:
 *
 *   escrow      a token held by the Foundation market or the PixelArcade
 *               contract is listed, not sold. 144 works once read as sold
 *               because nobody checked who the new "owner" was.
 *   editions    an edition record stands for hundreds of tokens. Judging one by
 *               its representative token claimed a single wallet owned an
 *               edition of 927.
 *   ledger      data/state.json overrides the catalogue at render time, so a
 *               stale entry can put a sold work back on sale after this cron
 *               has correctly retired it.
 *
 * Ownership comes from Etherscan's Transfer logs, swept per contract: one pass
 * gives both the current holder of every 1/1 and the full membership of every
 * edition, which per-token ownerOf calls could not do inside a function's life.
 */

const ETHERSCAN = 'https://api.etherscan.io/v2/api';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BS = 'https://eth.blockscout.com/api/v2';

// mintface.eth, ryanj.eth, mintfaced.eth. mintestate is deliberately NOT here:
// it is the vault, and vault records are never touched automatically.
const ARTIST = new Set([
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7',
  '0x7110733ab02b2a18a947e3912bf54136fbced169',
]);
const VAULT = '0x6e420b64bb329be84a6627c68a7bdff825139773';
// the same three wallets as ARTIST, but named: a new record says who holds it
const ARTIST_NAME = {
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180': 'mintface.eth',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7': 'ryanj.eth',
  '0x7110733ab02b2a18a947e3912bf54136fbced169': 'mintfaced.eth',
};
// held, not sold. Guard one.
const ESCROW = {
  '0xcda72070e455bb31c7690a170224ce43623d0b6f': 'Foundation escrow',
  '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5': 'PixelArcade contract',
};
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ERC-1155 moves are TransferSingle and TransferBatch, and the token id is in
// the data rather than in a topic, so it cannot be filtered server-side
const T1155_ONE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const T1155_MANY = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const dataWords = (d0) => {
  const d = String(d0 || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= d.length; i += 64) out.push('0x' + d.slice(i, i + 64));
  return out;
};
function tokenIdsFrom(l) {
  const w = dataWords(l.data);
  if (l.topics && l.topics[0] === T1155_ONE) return w.length >= 2 ? [BigInt(w[0]).toString()] : [];
  if (w.length < 4) return [];
  const at = Number(BigInt(w[0])) / 32;
  const n = Number(BigInt(w[at] || '0x0'));
  const out = [];
  for (let i = 0; i < n; i++) out.push(BigInt(w[at + 1 + i] || '0x0').toString());
  return out;
}
async function sweep1155(addr, topic, from, to, key) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: topic, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' }, key);
  await sleep(200);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep1155(addr, topic, from, mid, key)).concat(await sweep1155(addr, topic, mid + 1, to, key));
  }
  return Array.isArray(r) ? r : [];
}
/* The holder list, read from the indexer rather than reconstructed from logs.
   Balances are what an edition is, and asking for them directly is both
   shorter and harder to get subtly wrong than replaying every transfer. */
async function holdersOf(contract, ids) {
  const total = new Map();
  for (const id of ids) {
    let next = {};
    for (let page = 0; page < 40; page++) {
      const qs = new URLSearchParams(next).toString();
      let j = null;
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`${BS}/tokens/${contract}/instances/${encodeURIComponent(id)}/holders${qs ? '?' + qs : ''}`, { headers: { accept: 'application/json' } });
          if (r.ok) { j = await r.json(); break; }
          if (r.status === 404) break;
        } catch (e) { /* retry */ }
        await sleep(500 * (i + 1));
      }
      if (!j || !j.items) break;
      for (const h of j.items) {
        const a = String(h.address?.hash || '').toLowerCase();
        const q = Number(h.value || 0);
        if (!a || q <= 0 || BURN.has(a)) continue;
        const prev = total.get(a) || { address: h.address.hash, ens: h.address?.ens_domain_name || null, qty: 0 };
        prev.qty += q;
        total.set(a, prev);
      }
      if (!j.next_page_params) break;
      next = j.next_page_params;
      await sleep(120);
    }
    await sleep(100);
  }
  if (!total.size) return null;
  return [...total.values()].map(holderRow);
}

/* An excluded address is recorded as a holder with its real standing rather
   than quietly dropped: the vault holding four copies is a fact about the
   edition, and a register that hid it would not add up. */
function holderRow(h) {
  const a = String(h.address).toLowerCase();
  const status = ARTIST.has(a) ? 'artist_held' : (a === VAULT ? 'vaulted' : (ESCROW[a] ? 'listed' : 'acquired'));
  return { address: h.address, ens: h.ens || ARTIST_NAME[a] || null, display_name: null, qty: h.qty, acquired: null, status };
}

/* Who holds an ERC-721 edition now.
 *
 * An edition on a 721 contract is one artwork minted as many separate tokens,
 * each with one owner, so there are no balances to ask for: the holders
 * endpoint the 1155 pass uses answers an empty list for these, which is exactly
 * how they came to be skipped. The owner of each token is read instead and the
 * copies are added up per wallet, which gives the same shape of answer.
 */
async function ownersOf721(contract, ids) {
  const total = new Map();
  for (const id of ids) {
    let owner = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${BS}/tokens/${contract}/instances/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
        if (r.ok) { owner = (await r.json()).owner || null; break; }
        if (r.status === 404) break;
      } catch (e) { /* retry */ }
      await sleep(500 * (i + 1));
    }
    const a = String((owner && owner.hash) || '').toLowerCase();
    if (!a || BURN.has(a)) continue;
    const prev = total.get(a) || { address: owner.hash, ens: owner.ens_domain_name || null, qty: 0 };
    prev.qty += 1;
    total.set(a, prev);
    await sleep(100);
  }
  if (!total.size) return null;
  return [...total.values()].map(holderRow);
}


async function es(params, key) {
  const url = `${ETHERSCAN}?${new URLSearchParams({ chainid: '1', apikey: key, ...params })}`;
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

// getLogs caps at 1000 rows, so a busy range is halved until it fits
async function sweep(addr, from, to, key) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: TRANSFER, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' }, key);
  await sleep(220);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep(addr, from, mid, key)).concat(await sweep(addr, mid + 1, to, key));
  }
  return Array.isArray(r) ? r : [];
}

// Sweeping from block zero halves a 25-million-block range over and over for
// every contract. Etherscan will say exactly where each one was deployed, five
// at a time, which is one cheap call for a very large saving.
async function deployBlocks(addrs, key) {
  const out = new Map();
  for (let i = 0; i < addrs.length; i += 5) {
    const batch = addrs.slice(i, i + 5);
    const r = await es({ module: 'contract', action: 'getcontractcreation', contractaddresses: batch.join(',') }, key);
    if (Array.isArray(r)) {
      for (const c of r) {
        const n = Number(c.blockNumber);
        if (c.contractAddress && n > 0) out.set(c.contractAddress.toLowerCase(), n);
      }
    }
    await sleep(230);
  }
  return out;
}

async function head() {
  const r = await fetch('https://ethereum-rpc.publicnode.com', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const n = parseInt((await r.json()).result, 16);
  // a bad head silently truncates the sweep and every recent sale is missed
  if (!n || n < 25000000) throw new Error(`implausible head block: ${n}`);
  return n + 50;
}

// checksummed address + ENS in one call, so attribution needs no keccak here
async function who(addr) {
  try {
    const r = await fetch(`${BS}/addresses/${addr}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return { address: addr, ens: null };
    const j = await r.json();
    return { address: j.hash || addr, ens: j.ens_domain_name || null };
  } catch (e) { return { address: addr, ens: null }; }
}

const priced = (w) => {
  const p = w.pricing_nzd || {};
  const e = w.pricing_eth || {};
  return [p.digital, p.painting, p.both, e.digital].some((v) => typeof v === 'number' && v > 0);
};
const offered = (w) => {
  const o = w.offers;
  return Boolean(o && (o.digital === true || o.painting === true || o.both === true));
};

/* Nothing in this run is written until the very end, which is right ... a
   half-applied ownership sweep is worse than none. The cost is that anything
   which throws or runs out of clock loses the whole night, cursor and run log
   included, and leaves behind exactly what a night with no transfers leaves
   behind: nothing. So the failure is caught here, recorded, and emailed. A
   sweep that stopped must not be able to look like a quiet Tuesday. */
export async function GET(request) {
  const started = Date.now();
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  try {
    return await handle(request, started, dry);
  } catch (err) {
    const why = String(err && err.message ? err.message : err).slice(0, 300);
    console.error('owners: run failed', why);
    if (!dry) {
      const rf = await readFile('data/owners-runs.json').catch(() => ({ sha: null, text: null }));
      let runs = [];
      if (rf.text) { try { runs = JSON.parse(rf.text).runs || []; } catch (e) { /* start again */ } }
      await writeFile('data/owners-runs.json',
        JSON.stringify({ _note: 'One line per sweep. A run that changes nothing while the chain is busy is the signal that something has stopped seeing.',
          runs: [{ at: new Date(started).toISOString(), ok: false, ms: Date.now() - started, error: why }, ...runs].slice(0, 30) }, null, 1) + '\n',
        `Owners run failed: ${why.slice(0, 60)}`, rf.sha || undefined).catch(() => {});
      await send({ to: process.env.EMAIL_TO_ARTIST, subject: 'Ownership: the nightly sweep failed',
        text: `The ownership sweep stopped with:\n\n  ${why}\n\nNothing was written, so the register is yesterday's and the cursor has not moved. The next run will cover both nights.\n\nThe last thirty runs are at https://mintface.art/data/owners-runs.json\n\nMintFace` }).catch(() => {});
    }
    return new Response(JSON.stringify({ ok: false, error: why }, null, 1),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

/* Of the function's three hundred seconds, the full sweep may start only
   inside the first ninety and the edition pass only inside the first two
   hundred and ten. Everything this run exists to do happens after both, and a
   run that is killed before it writes is a run that never happened as far as
   anything downstream can tell. */
const FULL_SWEEP_BY = Number(process.env.OWNERS_FULL_SWEEP_MS || 90000);
/* Read in two places now, one of them above where it used to be declared. This
   file has been stopped dead twice by a const used before its line, and both
   times it read as a chain problem. It lives out here where nothing can be
   earlier than it. */
const EDITION_DEADLINE = Number(process.env.OWNERS_EDITION_MS || 210000);

async function handle(request, started, dry) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return new Response('ETHERSCAN_API_KEY is not set', { status: 503 });

  const index = JSON.parse((await readFile('data/index.json')).text);
  const slugs = (index.collections || []).map((c) => c.slug).filter((s) => s !== 'the-vault');

  const files = new Map();
  for (const slug of slugs) {
    try {
      const f = await readFile(`data/c/${slug}.json`);
      if (f.text) files.set(slug, { sha: f.sha, data: JSON.parse(f.text) });
    } catch (e) { /* a collection that will not load is left alone */ }
  }

  // one sweep per contract, reused by both the 1/1s and the editions
  /* The 1/1 sweep below reads ownerOf, which only an ERC-721 answers. Editions
     are held as balances by many wallets at once and need their own pass, so
     they are collected separately here rather than being silently dropped ...
     which is what used to happen. Eight contracts and 208 tokens, Geodetic
     Moments and XLIFE among them, were invisible to this run every night. */
  const contracts = new Set();
  const editions = new Map();          // contract -> Set(token id)
  for (const { data } of files.values()) {
    // children are works too: Roads or Rivers lives there and was never read
    for (const w of [...(data.works || []), ...(data.children || []).flatMap((c) => c.works || [])]) {
      const d = w.digital || {};
      if (d.chain !== 'ethereum' || !d.contract) continue;
      const a = d.contract.toLowerCase();
      if (d.standard === 'ERC-721') { contracts.add(a); continue; }
      if (d.standard === 'ERC-1155') {
        if (!editions.has(a)) editions.set(a, new Set());
        for (const id of (w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id])) editions.get(a).add(String(id));
      }
    }
  }
  const HEAD = await head();
  const deployed = await deployBlocks([...contracts], key);
  const list = [...contracts].sort();          // stable order, so the rotation is predictable

  /* Sweeping every contract from birth every night does not fit in a function,
     and does not need to. Ownership only changes when a token moves, so the
     daily pass reads just the blocks since the last run: a day is about seven
     thousand blocks and almost always a handful of logs.

     Edition counts are the exception ... they are a property of the whole
     edition, not of one transfer ... so one contract per night is swept in full
     and its editions recounted. Twenty-one contracts means every edition is
     recounted at least once a fortnight, while a sale still shows up the next
     morning. */
  const cur = await readFile('data/owners-cursor.json').catch(() => ({ sha: null, text: null }));
  let cursor = null;
  try { cursor = cur.text ? JSON.parse(cur.text) : null; } catch { cursor = null; }
  // no cursor yet: look back two days rather than to the beginning of the chain
  const since = cursor && cursor.last_block > 0 ? cursor.last_block : HEAD - 14400;
  /* One contract a night gets swept from its deployment block rather than from
     the cursor, as a slow reconciliation against drift. Two things about that
     were wrong, and together they stopped this run dead for three nights.

     The rotation was a counter in the cursor file, and the cursor file is
     written at the *end* of a successful run. So a contract the sweep cannot
     finish is a contract the sweep retries every single night, forever, never
     advancing past it. It is derived from the day now. Nothing can wedge it,
     because nothing has to write it down.

     And the multi-artist contracts were in the rotation at all. Their whole log
     is other people's work ... Foundation's shared contract is millions of
     transfers, of which a few dozen are ours ... so sweeping one from its
     deployment block is both impossible inside a function's lifetime and
     pointless, since the incremental sweep already catches everything of ours
     that moves. data/source/tao.json has known which contracts these are since
     the TAO engine was written; this run simply never asked. */
  let sharedContracts = new Set();
  try {
    const cfgFile = JSON.parse((await readFile('data/source/tao.json')).text);
    sharedContracts = new Set(Object.keys(cfgFile.per_token_contracts || {})
      .filter((k) => k.startsWith('0x')).map((k) => k.toLowerCase()));
  } catch (e) { /* without it the deadline below is the only guard, which is enough */ }
  const rotatable = list.filter((c) => !sharedContracts.has(c));
  const rotation = rotatable.length ? Math.floor(Date.now() / 86400000) % rotatable.length : 0;
  const fullContract = rotatable.length ? rotatable[rotation] : null;

  const applied = [];
  const flagged = [];
  const owner = new Map();   // "contract|tokenId" -> { to, ts, tx }  (only what moved)
  const full = new Map();    // the same, for the one contract swept in full
  const swept = new Set();
  // how busy the chain was in this window, which is the only thing that tells
  // a quiet night apart from a sweep that has stopped looking
  let chainEvents = 0;
  const parse = (logs, into) => {
    chainEvents += logs.length;
    logs.sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
    for (const l of logs) {
      if (!l.topics || l.topics.length < 4) continue;
      into.set(`${l.address.toLowerCase()}|${BigInt(l.topics[3]).toString()}`, {
        to: ('0x' + l.topics[2].slice(-40)).toLowerCase(),
        ts: new Date(parseInt(l.timeStamp, 16) * 1000).toISOString(),
        tx: l.transactionHash,
      });
    }
  };
  /* The incremental sweep is the mechanism and always runs: a night of blocks
     across seventeen contracts is seconds. The full sweep is a luxury, and it
     only gets whatever time is left. */
  for (const c of list) {
    const from = Math.max(deployed.get(c) || 0, since);
    if (from <= HEAD) parse(await sweep(c, from, HEAD, key), owner);
    swept.add(c);
  }
  let fullSwept = false;
  if (fullContract && Date.now() - started < FULL_SWEEP_BY) {
    parse(await sweep(fullContract, deployed.get(fullContract) || 0, HEAD, key), full);
    fullSwept = true;
  } else if (fullContract) {
    flagged.push({ id: 'full-sweep', slug: fullContract.slice(0, 10),
      why: 'the nightly full sweep was skipped: the incremental pass had already used the budget',
      action: 'nothing is stale that the incremental sweep would have caught; it comes round again tomorrow' });
  }

  const touched = new Set();
  const changedWorks = new Set();   // which collectors need their page rewritten

  for (const [slug, entry] of files) {
    for (const w of entry.data.works || []) {
      const d = w.digital || {};
      const c = String(d.contract || '').toLowerCase();
      if (d.chain !== 'ethereum' || d.standard !== 'ERC-721' || !c || !swept.has(c)) continue;
      const isEdition = (w.edition || {}).type && w.edition.type !== '1/1';

      // ---- guard two: an edition is judged by all of its tokens or not at all,
      // so only the contract swept in full tonight is eligible to be recounted
      if (isEdition) {
        const ids = (w.token_ids || []).map(String);
        if (!ids.length) continue;

        /* ---- who holds an ERC-721 edition ----
         *
         * The counts below were the whole of what this branch did, and counts
         * are not what a collector page reads: it reads `holders`, the rows
         * saying which wallets hold copies. Nothing in this file ever wrote
         * those for a 721 edition. The 1155 pass writes them, and a 721 edition
         * is not in its list, so Seize And Share, Roads & Rivers and Geodetic
         * Memory ... eighty-three works and two and a half thousand holder
         * rows ... were maintained by a script run by hand and by nothing else.
         * A collector who bought one on the secondary market never appeared on
         * their own page, while TAO, which reads the chain directly and not
         * this file, had them the same night. The two disagreed for months.
         *
         * So: when a copy moves, the work's holders are read again. Only works
         * that moved, on the same deadline as the editions pass, and the full
         * sweep still reconciles the counts below against the whole log.
         */
        const movedNow = new Map();
        for (const id of ids) {
          const hit = owner.get(`${c}|${id}`) || (c === fullContract ? full.get(`${c}|${id}`) : null);
          if (hit) movedNow.set(id, hit);
        }
        if (movedNow.size && Date.now() - started < EDITION_DEADLINE) {
          const fresh = await ownersOf721(c, ids);
          if (!fresh) {
            flagged.push({ id: w.id, slug, why: 'a copy moved but the indexer would not say who holds this edition now',
              action: 'holders are a day stale; it is read again tomorrow' });
          } else {
            /* A row says when as well as who. The date a holder already had is
               theirs and is kept ... buying a second copy does not restart how
               long they have held the first ... and a wallet arriving tonight
               is dated by the transfer that brought it. Without this the whole
               list would come back undated and every one of these collectors
               would sort last under "most recent". */
            const was = w.holders || [];
            const when = new Map();
            for (const h of movedNow.values()) when.set(h.to, h.ts);
            const rows = fresh.map((h) => {
              const a = h.address.toLowerCase();
              const had = was.find((x) => String(x.address).toLowerCase() === a);
              return { ...h,
                ens: h.ens || (had && had.ens) || null,
                display_name: (had && had.display_name) || null,
                acquired: (had && had.acquired) || when.get(a) || null };
            });
            if (!dry) {
              w.holders = rows;
              w.edition = { ...(w.edition || {}), type: 'edition', minted: ids.length,
                holders: rows.length,
                artist_held: rows.filter((h) => ARTIST.has(h.address.toLowerCase())).reduce((n, h) => n + h.qty, 0),
                vaulted: rows.filter((h) => h.address.toLowerCase() === VAULT).reduce((n, h) => n + h.qty, 0) };
            }
            applied.push(`edition ${w.id}: ${was.length} -> ${rows.length} holders`);
            touched.add(slug); changedWorks.add(w.id);
          }
        }

        if (c !== fullContract) continue;
        const seen = ids.map((t) => full.get(`${c}|${t}`)).filter(Boolean).map((o) => o.to);
        if (seen.length < ids.length * 0.9) continue;      // too little of the edition resolved to judge it
        const burned = seen.filter((o) => BURN.has(o)).length;
        const artist = seen.filter((o) => ARTIST.has(o)).length;
        const vaulted = seen.filter((o) => o === VAULT).length;
        const next = { type: 'edition', minted: ids.length };
        if ('live' in w.edition) next.live = seen.length - burned;
        if ('burned' in w.edition || burned) next.burned = burned;
        next.holders = new Set(seen.filter((o) => !BURN.has(o))).size;
        next.artist_held = artist;
        next.vaulted = vaulted;
        if (JSON.stringify(next) !== JSON.stringify(w.edition)) {
          const was = w.edition.artist_held;      // captured before the swap, or the log reads 5->5
          if (!dry) w.edition = next;
          applied.push(`counts ${w.id}: artist_held ${was}->${next.artist_held}`);
          touched.add(slug); changedWorks.add(w.id);
        }
        // an edition with nothing left and nothing asked for it may retire itself
        if (w.status === 'available' && artist === 0) {
          if (priced(w) || offered(w)) {
            flagged.push({ id: w.id, slug, why: 'priced and offered, but no artist-held copies remain', action: 'would be sold_out' });
          } else {
            if (!dry) { w.status = 'sold_out'; w.held_by = null; }
            applied.push(`sold_out ${w.id} (edition exhausted, unpriced)`);
            touched.add(slug); changedWorks.add(w.id);
          }
        }
        continue;
      }

      // ---- 1/1s. Nothing moved means nothing changed, so silence is the answer.
      const hit = owner.get(`${c}|${d.token_id}`) || (c === fullContract ? full.get(`${c}|${d.token_id}`) : null);
      if (!hit) continue;
      const now = hit.to;

      // ---- guard one: escrow and the vault are never touched automatically
      if (ESCROW[now]) {
        if (w.status === 'acquired') flagged.push({ id: w.id, slug, why: `${ESCROW[now]} holds it, but the catalogue says collected`, action: 'needs a look' });
        continue;
      }
      if (now === VAULT || w.status === 'vaulted') {
        if (w.status !== 'vaulted' || now !== VAULT) {
          flagged.push({ id: w.id, slug, why: 'vault record and chain disagree', action: 'never changed automatically' });
        }
        continue;
      }

      const artistHeld = ARTIST.has(now);
      const rec = String((w.collector || {}).address || '').toLowerCase();

      if (['available', 'reserved'].includes(w.status) && BURN.has(now)) {
        // retiring a burned work is safe in direction, but the policy authorises
        // only one retirement ... an exhausted, unpriced edition ... so it waits
        flagged.push({ id: w.id, slug, why: 'burned on chain, still listed as available', action: 'would be marked burned' });
        continue;
      }

      if (['available', 'reserved'].includes(w.status) && !artistHeld && !BURN.has(now)) {
        // a work has left the wallet for a real buyer: safe, one-directional
        const id = await who(now);
        if (!dry) {
          w.status = 'acquired';
          w.held_by = null;
          w.reserve = null;
          w.collector = { address: id.address, ens: id.ens, display_name: null, note: null, acquired: hit.ts };
          if (w.offers) w.offers = { ...w.offers, digital: false, painting: false, both: false };
        }
        applied.push(`collected ${w.id} -> ${id.ens || id.address}`);
        touched.add(slug); changedWorks.add(w.id);
        continue;
      }

      if (w.status === 'acquired' && artistHeld) {
        // back in the artist's hands. Putting it on sale is Ryan's call, never this cron's.
        flagged.push({ id: w.id, slug, why: 'returned to an artist wallet', action: 'would go back on sale' });
        continue;
      }
      if (w.status === 'acquired' && rec && rec !== now && !BURN.has(now)) {
        const id = await who(now);
        if (!dry) w.collector = { ...w.collector, address: id.address, ens: id.ens, acquired: hit.ts };
        applied.push(`resold ${w.id} -> ${id.ens || id.address}`);
        touched.add(slug); changedWorks.add(w.id);
      }
    }
  }

  // ---- guard three: the ledger overrides the catalogue, so a stale entry undoes all of the above
  let ledgerCleared = 0;
  const st = await readFile('data/state.json').catch(() => ({ sha: null, text: null }));
  if (st.text) {
    const state = JSON.parse(st.text);
    const status = new Map();
    for (const { data } of files.values()) for (const w of data.works || []) status.set(w.id, w.status);
    const stale = Object.entries(state.works || {})
      .filter(([id, v]) => v.status === 'available' && status.has(id) && status.get(id) !== 'available');
    for (const [id] of stale) { delete state.works[id]; ledgerCleared++; applied.push(`ledger cleared ${id} (kept a sold work on sale)`); }
    if (stale.length && !dry) {
      state.updated = new Date().toISOString();
      await writeFile('data/state.json', JSON.stringify(state, null, 2) + '\n', `Ledger: cleared ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}`, st.sha);
    }
  }

  /* ---------- editions ----------
     An edition is held as a balance by many wallets, so there is no ownerOf to
     ask. Instead the transfer log says which tokens moved, and only those have
     their holder list re-read ... which keeps a nightly run to the handful of
     editions that actually changed hands rather than all 208.

     The same policy applies as everywhere else in this file: a holder who
     appears is added, a holder whose balance is gone is removed, and nothing
     is ever put back on sale. Excluded addresses are recorded as holders with
     their real standing rather than as collectors. */
  /* This pass reads holder lists one token at a time from an indexer that
     pages, which is the slowest thing in the file and the only part whose cost
     depends on how much moved. It runs before anything is written, so left
     unbounded it can spend the whole three hundred seconds and take the cursor,
     the register and the run log down with it ... which is what happened the
     first night it ran. It now stops at the deadline and says what it did not
     reach; those editions are a day stale, and the run still lands. */
  let editionsChecked = 0, holderRows = 0, editionsSkipped = 0;
  for (const [addr, ids] of editions) {
    if (Date.now() - started > EDITION_DEADLINE) { editionsSkipped++; continue; }
    let logs = [];
    for (const topic of [T1155_ONE, T1155_MANY]) {
      try { logs = logs.concat(await sweep1155(addr, topic, since, HEAD, key)); }
      catch (e) { flagged.push({ id: addr, slug: addr.slice(0, 10), why: `edition sweep failed: ${String(e.message || e).slice(0, 80)}`, action: 'holders may be a day stale' }); }
    }
    chainEvents += logs.length;
    const moved = new Set();
    for (const l of logs) {
      for (const id of tokenIdsFrom(l)) if (ids.has(id)) moved.add(id);
    }
    if (!moved.size) continue;
    editionsChecked += moved.size;

    for (const [slug, entry] of files) {
      const works = [...(entry.data.works || []), ...(entry.data.children || []).flatMap((c) => c.works || [])];
      for (const w of works) {
        const d = w.digital || {};
        if (!d.contract || d.contract.toLowerCase() !== addr) continue;
        const mine = (w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id]).map(String);
        if (!mine.some((id) => moved.has(id))) continue;
        const fresh = await holdersOf(addr, mine);
        if (!fresh) continue;
        const before = (w.holders || []).length;
        if (!dry) {
          w.holders = fresh;
          w.edition = { ...(w.edition || {}), holders: fresh.filter((h) => h.status === 'acquired').length,
            minted: fresh.reduce((n, h) => n + h.qty, 0) || (w.edition || {}).minted };
        }
        holderRows += fresh.length;
        applied.push(`edition ${w.id}: ${before} -> ${fresh.length} holders`);
        touched.add(slug); changedWorks.add(w.id);
      }
    }
  }

  /* ---------- births ----------
     Everything above asks who holds a token we already know about. That can
     never notice a token that did not exist yesterday, which is how Patrimora
     182 to 185 minted, sold, and stayed off the site entirely.

     A mint is a Transfer whose sender is nobody. Reading those is exact for
     any id scheme and does not need the contract to expose a supply ... which
     matters, because Genesis sits on Foundation's shared contract and its
     supply is a hundred and fourteen thousand other people's work. */
  const born = [];
  let mintCursorChanged = false;
  const openMintFile = await readFile('data/source/open-mint.json').catch(() => ({ sha: null, text: null }));
  const openMint = openMintFile.text ? JSON.parse(openMintFile.text) : null;
  if (openMint) {
    for (const [contract, conf] of Object.entries(openMint.contracts || {})) {
      const entry = files.get(conf.collection);
      if (!entry) continue;
      const known = new Set((entry.data.works || []).map((w) => String((w.digital || {}).token_id)));
      const from = openMint.cursor?.[contract] ? openMint.cursor[contract] + 1 : since;
      let fresh = [];
      try {
        const mints = await mintsSince({ contract, fromBlock: from, toBlock: HEAD, es: (p) => es(p, key) });
        fresh = mints.filter((m) => !known.has(m.tokenId));
      } catch (e) {
        flagged.push({ id: conf.collection, slug: conf.collection, why: `could not read new mints: ${String(e.message || e).slice(0, 90)}`, action: 'run scripts/discover-mints.mjs' });
        continue;
      }
      // a burst of mints is added over several nights rather than in one run
      const take = fresh.slice(0, 25);
      if (fresh.length > take.length) {
        flagged.push({ id: conf.collection, slug: conf.collection,
          why: `${fresh.length} new tokens, ${take.length} added tonight`, action: 'the rest follow tomorrow' });
      }
      for (const m of take) {
        const { owner, md } = await readToken({ contract, tokenId: m.tokenId, standard: conf.standard, rpc: 'https://ethereum-rpc.publicnode.com' });
        const rec = buildRecord({
          collection: conf.collection, contract: entry.data.contracts?.[0]?.address || contract,
          standard: conf.standard, tokenId: m.tokenId, titlePattern: conf.title, mint: m,
          owner: owner || m.to, md, artist: ARTIST_NAME, vault: VAULT, escrow: new Set(Object.keys(ESCROW)),
        });
        if (rec.collector && rec.collector.address) {
          const id = await who(rec.collector.address);
          rec.collector.address = id.address;
          rec.collector.ens = id.ens;
        }
        entry.data.works = [...(entry.data.works || []), rec];
        born.push(rec.id);
        touched.add(conf.collection);
        changedWorks.add(rec.id);
      }
      if (take.length) {
        const tally = {};
        for (const w of entry.data.works) if (w.status) tally[w.status] = (tally[w.status] || 0) + 1;
        const uniq = entry.data.works.filter((w) => !((w.edition || {}).type && w.edition.type !== '1/1')).length;
        entry.data.counts = { ...entry.data.counts, works: entry.data.works.length, ...tally,
          ...(entry.data.counts && entry.data.counts.unique_works != null ? { unique_works: uniq } : {}) };
      }
      if (openMint.cursor) { openMint.cursor[contract] = HEAD; mintCursorChanged = true; }
    }
  }

  if (!dry) {
    for (const slug of touched) {
      const entry = files.get(slug);
      await writeFile(`data/c/${slug}.json`, JSON.stringify(entry.data, null, 1) + '\n', `Owners: ${slug}`, entry.sha);
    }
    if (mintCursorChanged) {
      await writeFile('data/source/open-mint.json', JSON.stringify(openMint, null, 1) + '\n',
        `Open mint cursor: block ${HEAD}`, openMintFile.sha || undefined);
    }
    /* A new work with no entry in the index is a page that answers 404 and a
       count that is short. Both are written from the records here, because
       nothing else will until the next full rebuild. */
    if (born.length) {
      const ix = await readFile('data/index.json');
      const data = JSON.parse(ix.text);
      data.work_index = data.work_index || {};
      for (const slug of touched) {
        const entry = files.get(slug);
        for (const w of entry.data.works || []) if (w.id) data.work_index[w.id] = slug;
        const c = (data.collections || []).find((x) => x.slug === slug);
        if (c && entry.data.counts) c.counts = { ...c.counts, ...entry.data.counts };
      }
      await writeFile('data/index.json', JSON.stringify(data, null, 1) + '\n',
        `Index: ${born.length} new work${born.length === 1 ? '' : 's'}`, ix.sha);
    }
  }

  /* Collectors are derived from what was just written, using the same module
     scripts/build-collectors.mjs uses ... one sweep feeds both sites.

     The index and the slug map are small and always rewritten. The 400-odd
     per-collector files are not: writing them all would be 400 commits a night,
     so only the people whose works actually moved are rewritten. */
  let collectorsWritten = 0;
  if (!dry && (touched.size || ledgerCleared)) {
    try {
      const titleOf = new Map((index.collections || []).map((c) => [c.slug, c.title]));
      let priv = new Set();
      try {
        const pf = await readFile('data/source/collectors-private.json');
        priv = new Set(((JSON.parse(pf.text).wallets) || []).map((w) => String(w).toLowerCase()));
      } catch (e) { /* no list yet, nobody is private */ }

      /* TAO is computed by its own run half an hour after this one, and the
         index carries it. Rebuilding without it would strip every collector's
         figure until that run caught up, so it is read and passed through
         rather than recomputed here. */
      let tao = null;
      try { tao = JSON.parse((await readFile('data/tao.json')).text); } catch (e) { /* never built */ }
      // and the nudge counts, for the same reason: derived here means dropped
      // here unless they are handed in
      let nudges = null;
      try { nudges = JSON.parse((await readFile('data/nudge-weighings.json')).text); } catch (e) { /* none yet */ }
      const d = deriveCollectors([...files.values()].map((f) => f.data), titleOf, priv, tao, nudges);
      const put = async (path, body, msg) => {
        const cur = await readFile(path).catch(() => ({ sha: null }));
        await writeFile(path, JSON.stringify(body, null, 1) + '\n', msg, cur.sha || undefined);
      };
      await put('data/collectors.json', d.index, `Collectors: ${d.index.counts.collectors}`);
      /* The leaderboard. Derived on every rebuild since the day it was written
         and, until now, written by nothing but a hand-run script ... so the
         table the register renders was two days old while the figures behind
         it were being recomputed nightly. */
      /* Through registerFile rather than put: the register is written one row
         per line, so the nightly diff shows the rows that moved rather than
         forty-four thousand lines of reformatted numbers. */
      {
        const cur = await readFile('data/collectors-register.json').catch(() => ({ sha: null }));
        await writeFile('data/collectors-register.json', registerFile(d.register),
          `Register: ${d.register.rows.length} ranked`, cur.sha || undefined);
      }
      await put('data/collector-slugs.json', d.slugMap, 'Collectors: slug map');
      for (const p of d.all) {
        if (!p.has_page || !p.works.some((w) => changedWorks.has(w.id))) continue;
        await put(`data/collectors/${p.slug}.json`, d.page(p), `Collectors: ${p.slug}`);
        collectorsWritten++;
      }
    } catch (e) {
      flagged.push({ id: 'collectors', slug: 'collectors', why: `rebuild failed: ${String(e.message || e).slice(0, 120)}`, action: 'the collectors site is serving yesterday' });
    }
  }

  if (!dry) {
    await writeFile('data/owners-cursor.json',
      JSON.stringify({ last_block: HEAD, rotation, full_swept: fullSwept ? fullContract : null,
        updated: new Date().toISOString() }, null, 1) + '\n',
      `Owners cursor: block ${HEAD}`, cur.sha || undefined);
  }

  for (const id of born) applied.push(`born ${id}`);
  if (editionsSkipped) {
    flagged.push({ id: 'editions', slug: 'editions',
      why: `${editionsSkipped} edition contract${editionsSkipped === 1 ? '' : 's'} were not reached before the run's deadline`,
      action: 'their holders are a day stale; the next run picks them up from the same cursor' });
  }
  const summary = `owners: ${applied.length} applied, ${flagged.length} flagged, ${ledgerCleared} ledger cleared, ${born.length} newly minted, ${editionsChecked} editions re-read, `
    + `blocks ${since}-${HEAD}, full sweep ${fullSwept ? 'of ' + fullContract : 'skipped'}, ${collectorsWritten} collector pages`;
  console.log(summary);

  /* ---------- the run log, and the thing that pages us ----------
     A sweep that changes nothing looks identical to a sweep that failed to
     look. The only way to tell them apart is whether the chain was quiet too,
     so both are recorded: what changed, and how many transfers went past. A
     run of quiet days while the chain was busy is the signal that something
     has stopped seeing, and it emails rather than waiting to be noticed. */
  const QUIET_DAYS = Number(process.env.OWNERS_QUIET_DAYS || 3);
  let runLog = { runs: [] };
  const rf = await readFile('data/owners-runs.json').catch(() => ({ sha: null, text: null }));
  if (rf.text) { try { runLog = JSON.parse(rf.text); } catch (e) { /* start again */ } }
  const entry = {
    at: new Date().toISOString(), since, head: HEAD,
    applied: applied.length, flagged: flagged.length, born: born.length,
    editions: editionsChecked, editions_skipped: editionsSkipped,
    chain_events: chainEvents, ms: Date.now() - started, ok: true,
  };
  const recent = [entry, ...(runLog.runs || [])].slice(0, 30);
  const quiet = [];
  for (const r of recent.slice(0, QUIET_DAYS)) {
    if (r.applied === 0 && r.born === 0 && (r.chain_events || 0) > 0) quiet.push(r.at.slice(0, 10));
  }
  const stalled = quiet.length >= QUIET_DAYS;
  if (stalled) {
    flagged.push({ id: 'sweep', slug: 'sweep',
      why: `${quiet.length} runs in a row changed nothing while ${recent[0].chain_events} transfers went past`,
      action: 'the sweep may have stopped seeing something ... check its scope' });
  }
  if (!dry) {
    await writeFile('data/owners-runs.json',
      JSON.stringify({ _note: 'One line per sweep. A run that changes nothing while the chain is busy is the signal that something has stopped seeing.', runs: recent }, null, 1) + '\n',
      `Owners run: ${entry.applied} applied, ${entry.chain_events} transfers seen`, rf.sha || undefined);
  }

  if (flagged.length && !dry) {
    const text = `The daily ownership run found ${flagged.length} thing${flagged.length === 1 ? '' : 's'} it will not change on its own.\n\n`
      + flagged.map((f) => `${f.id}  (${f.slug})\n  ${f.why}\n  ${f.action}`).join('\n\n')
      + `\n\nNothing above has been altered. ${applied.length} safe change${applied.length === 1 ? '' : 's'} were applied.\n\nMintFace`;
    await send({ to: process.env.EMAIL_TO_ARTIST, subject: `Ownership: ${flagged.length} to look at`, text }).catch(() => {});
  }

  return new Response(JSON.stringify({ summary, applied, flagged, dry, since, head: HEAD, full_sweep: fullContract }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
