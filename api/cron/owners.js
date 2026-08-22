import { readFile, writeFile } from '../_lib/repo.js';
import { send } from '../_lib/email.js';

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
// held, not sold. Guard one.
const ESCROW = {
  '0xcda72070e455bb31c7690a170224ce43623d0b6f': 'Foundation escrow',
  '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5': 'PixelArcade contract',
};
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return new Response('ETHERSCAN_API_KEY is not set', { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
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
  const contracts = new Set();
  for (const { data } of files.values()) {
    for (const w of data.works || []) {
      const d = w.digital || {};
      if (d.chain === 'ethereum' && d.standard === 'ERC-721' && d.contract) contracts.add(d.contract.toLowerCase());
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
  const rotation = cursor && Number.isInteger(cursor.rotation) ? cursor.rotation % list.length : 0;
  const fullContract = list[rotation];

  const owner = new Map();   // "contract|tokenId" -> { to, ts, tx }  (only what moved)
  const full = new Map();    // the same, for the one contract swept in full
  const swept = new Set();
  const parse = (logs, into) => {
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
  for (const c of list) {
    const from = Math.max(deployed.get(c) || 0, since);
    if (from <= HEAD) parse(await sweep(c, from, HEAD, key), owner);
    swept.add(c);
  }
  parse(await sweep(fullContract, deployed.get(fullContract) || 0, HEAD, key), full);

  const applied = [];
  const flagged = [];
  const touched = new Set();

  for (const [slug, entry] of files) {
    for (const w of entry.data.works || []) {
      const d = w.digital || {};
      const c = String(d.contract || '').toLowerCase();
      if (d.chain !== 'ethereum' || d.standard !== 'ERC-721' || !c || !swept.has(c)) continue;
      const isEdition = (w.edition || {}).type && w.edition.type !== '1/1';

      // ---- guard two: an edition is judged by all of its tokens or not at all,
      // so only the contract swept in full tonight is eligible to be recounted
      if (isEdition) {
        if (c !== fullContract) continue;
        const ids = w.token_ids || [];
        if (!ids.length) continue;
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
          touched.add(slug);
        }
        // an edition with nothing left and nothing asked for it may retire itself
        if (w.status === 'available' && artist === 0) {
          if (priced(w) || offered(w)) {
            flagged.push({ id: w.id, slug, why: 'priced and offered, but no artist-held copies remain', action: 'would be sold_out' });
          } else {
            if (!dry) { w.status = 'sold_out'; w.held_by = null; }
            applied.push(`sold_out ${w.id} (edition exhausted, unpriced)`);
            touched.add(slug);
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
        touched.add(slug);
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
        touched.add(slug);
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

  if (!dry) {
    for (const slug of touched) {
      const entry = files.get(slug);
      await writeFile(`data/c/${slug}.json`, JSON.stringify(entry.data, null, 1) + '\n', `Owners: ${slug}`, entry.sha);
    }
  }

  if (!dry) {
    await writeFile('data/owners-cursor.json',
      JSON.stringify({ last_block: HEAD, rotation: (rotation + 1) % list.length, updated: new Date().toISOString() }, null, 1) + '\n',
      `Owners cursor: block ${HEAD}`, cur.sha || undefined);
  }

  const summary = `owners: ${applied.length} applied, ${flagged.length} flagged, ${ledgerCleared} ledger cleared, `
    + `blocks ${since}-${HEAD}, full sweep of ${fullContract}`;
  console.log(summary);

  if (flagged.length && !dry) {
    const text = `The daily ownership run found ${flagged.length} thing${flagged.length === 1 ? '' : 's'} it will not change on its own.\n\n`
      + flagged.map((f) => `${f.id}  (${f.slug})\n  ${f.why}\n  ${f.action}`).join('\n\n')
      + `\n\nNothing above has been altered. ${applied.length} safe change${applied.length === 1 ? '' : 's'} were applied.\n\nMintFace`;
    await send({ to: process.env.EMAIL_TO_ARTIST, subject: `Ownership: ${flagged.length} to look at`, text }).catch(() => {});
  }

  return new Response(JSON.stringify({ summary, applied, flagged, dry, since, head: HEAD, full_sweep: fullContract }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
