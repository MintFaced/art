import { verifyMessage } from 'viem';
import { findWork, useRequestOrigin, siteOrigin } from './_lib/data.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import {
  notesStore, noteMessage, noteId, today, standing, checkText, checkVisibility,
  arrange, holdersOf, heldSince,
} from './_lib/notes.js';

/* The notes layer.
 *
 * A wallet signs a sentence saying what it is writing and where. Nothing is
 * held between requests, so there is no session to steal and no cookie to
 * expire: the signature is the whole authorisation, and it is fresh or it is
 * refused. That is the rig the nudges already use.
 *
 * Who may write is decided here and now, never remembered. Whoever holds the
 * work may write on it, which is checked against the chain rather than against
 * last night's sweep, so someone who bought an hour ago can write an hour ago.
 * Above 69,000 TAO a collector may write anywhere. Selling below the line
 * closes that door for new notes and leaves the ones already written standing.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
});
const lower = (a) => String(a || '').toLowerCase();
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const ACTIONS = ['write', 'edit', 'delete', 'hide', 'show'];

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

async function config(origin) {
  const cfg = await at(origin, 'data/source/notes.json');
  cfg.artist = Object.fromEntries(Object.entries(cfg.artist || {}).filter(([k]) => k.startsWith('0x')));
  return cfg;
}

/* Does this wallet hold this work, right now, according to the chain?
   The catalogue is swept nightly and is the fallback: a work on Bitcoin has no
   Ethereum call to make, and an RPC having a bad minute should not tell a
   collector they do not own their own painting. */
async function holdsNow(work, address) {
  const d = (work && work.digital) || {};
  const cat = holdersOf(work).has(lower(address));
  if (d.chain !== 'ethereum' || !d.contract || d.token_id == null) return { holds: cat, how: 'the catalogue' };
  const id = BigInt(d.token_id);
  const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
  const call = async (data) => {
    const r = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: d.contract, data }, 'latest'] }),
    });
    const j = await r.json();
    if (j.error || !j.result || j.result === '0x') throw new Error('no answer');
    return j.result;
  };
  try {
    if (d.standard === 'ERC-1155') {
      const res = await call(`0x00fdd58e${pad(lower(address))}${pad(id.toString(16))}`);
      return { holds: BigInt(res) > 0n, how: 'the chain' };
    }
    const res = await call(`0x6352211e${pad(id.toString(16))}`);
    return { holds: lower(`0x${res.slice(-40)}`) === lower(address), how: 'the chain' };
  } catch (e) {
    return { holds: cat, how: 'the catalogue, the chain would not answer' };
  }
}

async function nameOf(origin, address) {
  try {
    const reg = await at(origin, 'data/collectors.json');
    const hit = (reg.collectors || []).find((c) => lower(c.address) === lower(address));
    return hit ? (hit.display_name || hit.ens || null) : null;
  } catch (e) { return null; }
}
async function taoOf(origin, address) {
  try {
    const tao = await at(origin, 'data/tao.json');
    const w = tao.wallets && tao.wallets[lower(address)];
    return w ? w.tao : 0;
  } catch (e) { return 0; }
}

/** One row as the stream and a collector's own list read it. */
const rowOf = (r) => ({
  id: r.id, work: r.work, title: r.title || null, at: r.at, role: r.role,
  name: r.name || null, address: r.address, text: r.text,
  visibility: r.visibility, edited: Boolean(r.edited_at),
});

/** The date whoever holds it now came by it, which ends the previous tenure. */
function currentAcquired(work) {
  const c = work && work.collector;
  if (c && c.acquired) return c.acquired;
  const dates = ((work && work.holders) || []).map((h) => h.acquired).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

/* ---------------------------------------------------------------- reading */

export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  const url = new URL(request.url);
  const workId = url.searchParams.get('work');
  const address = url.searchParams.get('address');
  const viewer = lower(url.searchParams.get('viewer') || '');
  const wantRecent = url.searchParams.get('recent');

  if (!storeConfigured()) {
    // the page should draw its empty state, not its error state
    return json({ notes: [], provenance: [], counts: { shown: 0, provenance: 0 }, me: null, store: false });
  }

  let cfg;
  try { cfg = await config(origin); } catch (e) { return json({ error: 'the notes are not reachable' }, 503); }
  const db = notesStore(pipe, cfg);

  try {
    if (workId) {
      const hit = await findWork(workId);
      if (!hit) return json({ error: 'no such work' }, 404);
      const holders = holdersOf(hit.work);
      const isArtist = Boolean(viewer && cfg.artist[viewer]);

      /* A page that offers a form and then refuses the signature has wasted
         somebody's time and their wallet prompt. So the same question the post
         will ask is asked here, chain and all, and the answer decides whether
         there is a form at all. */
      let me = null;
      if (/^0x[0-9a-f]{40}$/.test(viewer)) {
        const chain = await holdsNow(hit.work, viewer);
        const set = new Set(holders);
        if (chain.holds) set.add(viewer);
        const tao = await taoOf(origin, viewer);
        const who = standing({ address: viewer, cfg, tao, holders: set });
        me = who.error
          ? { can_write: false, why: who.error, tao }
          : { can_write: true, role: who.role, tao, can_be_private: who.role === 'collector' };
      }

      const rows = await db.byWork(workId);
      const out = arrange(rows, { holders, viewer, isArtist, currentAcquired: currentAcquired(hit.work) });
      return json({ ...out, work: workId, me, fold_after: cfg.fold_after, max_chars: cfg.max_chars,
        senior_tao: cfg.senior_tao, store: true });
    }

    if (address) {
      /* A collector's own line: how many they have written, and where. Only
         what a stranger may read is counted, so the number on a public page
         never hints at a private note. */
      const rows = await db.byWallet(address, 200);
      const mine = viewer && viewer === lower(address);
      const shown = rows.filter((r) => !r.hidden && (r.visibility === 'public' || mine));
      return json({
        address: lower(address), count: shown.length,
        notes: shown.slice(0, 60).map(rowOf),
        store: true,
      });
    }

    if (wantRecent) {
      const rows = await db.recent(Math.min(100, Number(wantRecent) || 50));
      const live = rows.filter((r) => !r.hidden && r.visibility === 'public');
      return json({ notes: live.map(rowOf), store: true });
    }
  } catch (e) {
    return json({ error: 'the notes are not reachable' }, 503);
  }

  return json({ error: 'ask for a work, an address, or the recent stream' }, 400);
}

/* ---------------------------------------------------------------- writing */

export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  if (!storeConfigured()) return json({ error: 'the notes store is not configured yet' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const address = lower(body.address);
  const action = String(body.action || 'write');
  const signature = String(body.signature || '');
  const issued = String(body.issued || '');

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
  if (!ACTIONS.includes(action)) return json({ error: 'no such action' }, 400);
  if (!signature.startsWith('0x')) return json({ error: 'a signature is required' }, 400);
  // an old signature should not sit around waiting to be replayed
  const age = Date.now() - Date.parse(issued);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
    return json({ error: 'that signature has gone stale, please sign again' }, 400);
  }

  let cfg;
  try { cfg = await config(origin); } catch (e) { return json({ error: 'the notes are not reachable' }, 503); }
  const db = notesStore(pipe, cfg);
  const isArtist = Boolean(cfg.artist[address]);

  /* Everything but a new note acts on a note that already exists, and the
     signature has to name the same one. */
  if (action !== 'write') {
    const note = await db.get(String(body.id || ''));
    if (!note) return json({ error: 'no such note' }, 404);
    const mine = lower(note.address) === address;
    if (action === 'hide' || action === 'show') {
      if (!isArtist) return json({ error: 'only the artist can hide a note' }, 403);
    } else if (!mine) {
      return json({ error: 'a note is edited and deleted by the wallet that wrote it' }, 403);
    }

    const text = action === 'edit' ? checkText(body.text, cfg) : { text: null };
    if (text.error) return json({ error: text.error }, 400);
    const message = noteMessage({ action, work: note.work, text: text.text, address, issued });
    let ok = false;
    try { ok = await verifyMessage({ address, message, signature }); } catch (e) { ok = false; }
    if (!ok) return json({ error: 'that signature does not match the wallet' }, 401);

    if (action === 'delete') { await db.remove(note); return json({ ok: true, deleted: note.id }); }
    if (action === 'hide' || action === 'show') {
      note.hidden = action === 'hide';
      await db.save(note);
      return json({ ok: true, id: note.id, hidden: note.hidden });
    }
    note.text = text.text;
    note.edited_at = new Date().toISOString();
    await db.save(note);
    return json({ ok: true, id: note.id });
  }

  /* ---- a new note ---- */
  const workId = String(body.work || '');
  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);

  const text = checkText(body.text, cfg);
  if (text.error) return json({ error: text.error }, 400);

  const chain = await holdsNow(hit.work, address);
  const holders = holdersOf(hit.work);
  if (chain.holds) holders.add(address);
  const tao = await taoOf(origin, address);
  const who = standing({ address, cfg, tao, holders });
  if (who.error) return json({ error: who.error, tao }, 403);

  const vis = checkVisibility({ role: who.role, visibility: body.visibility });
  if (vis.error) return json({ error: vis.error }, 400);

  const spent = await db.spentToday(address);
  if (spent >= Number(cfg.per_wallet_per_day)) {
    return json({ error: `${cfg.per_wallet_per_day} notes in a day is enough for anyone. Tomorrow.` }, 429);
  }

  const message = noteMessage({ action: 'write', work: workId, text: text.text, visibility: vis.visibility, address, issued });
  let ok = false;
  try { ok = await verifyMessage({ address, message, signature }); } catch (e) { ok = false; }
  if (!ok) return json({ error: 'that signature does not match the wallet' }, 401);

  const now = new Date().toISOString();
  const note = {
    id: noteId(), work: workId, title: hit.work.title || workId, collection: hit.collection.slug,
    address, name: who.name || (await nameOf(origin, address)),
    role: who.role, tao_at_post: who.role === 'senior' ? who.tao : (tao || 0),
    held_since: who.role === 'collector' ? (heldSince(hit.work, address) || now) : null,
    text: text.text, visibility: vis.visibility, hidden: false,
    at: now, edited_at: null, verified: chain.how,
  };
  await db.put(note, { count: true, day: today() });

  const rows = await db.byWork(workId);
  const out = arrange(rows, {
    holders, viewer: address, isArtist,
    currentAcquired: currentAcquired(hit.work),
  });
  return json({ ok: true, id: note.id, verified: chain.how, ...out });
}
