/* The seam between the studio's events and the tweet queue.
 *
 * Each function composes one job — a stable idempotency id, the tweet text in
 * the house voice, and the OG image spec — and enqueues it. Callers in the
 * request path add a single non-fatal line; nothing here is allowed to fail the
 * act it is reporting on (a weigh-in is committed with or without its tweet).
 *
 * Colour names: the ledger stores hexes, not names, so `name` is whatever the
 * caller can supply (none today → the copy falls back to ≈ #HEX). A hex→name
 * resolver, or a name captured at proposal time, is the way to get ≈ LIGHT GREEN.
 */
import { enqueue } from './tweetq.js';
import * as copy from './tweet-copy.js';
import { nameFor } from './colour-names.js';

const qs = (o) => Object.entries(o)
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
  .join('&');

const clean = (h) => (h ? String(h).replace('#', '') : null);

// Idempotency id for a weigh/propose row: the signature if signed, else the
// session tuple — the same key withLive() dedupes on.
const rowId = (kind, row) => (row.signature
  ? `${kind}:${row.signature}`
  : `${kind}:${row.session}@${row.at}@${clean(row.candidate || row.hex) || row.side || ''}`);

// Production leaves the store default; tests point it at an in-memory fake.
let TEST_STORE;
export function __setStoreForTests(s) { TEST_STORE = s; }

async function push(job) {
  try { await enqueue(job, TEST_STORE); } catch (e) { /* the queue is best-effort here */ }
}

/** A colour proposed onto the board. */
export async function propose({ n, row, who, locked = [] }) {
  const hex = clean(row.hex);
  const name = row.colourName || nameFor(hex);
  await push({
    id: rowId('propose', row),
    kind: 'propose',
    text: copy.proposeTweet({ number: n.number, name, hex, who }),
    image: { og: qs({ tweet: 'propose', hex, name: name || '', locked: locked.map(clean).join(','), cap: `PROPOSED · NUDGE #${n.number}` }) },
  });
}

/** A weigh-in or a move. `standingText` is the optional running total on the candidate. */
export async function weigh({ n, row, who, standingText = '', locked = [] }) {
  const hex = clean(row.candidate);
  const name = row.colourName || nameFor(hex);
  await push({
    id: rowId('weigh', row),
    kind: 'weigh',
    text: copy.weighTweet({ who, amount: row.amount, name, hex, move: !!row.from }),
    image: { og: qs({ tweet: 'weigh', hex, name: name || '', locked: locked.map(clean).join(','), total: standingText, cap: `NUDGE #${n.number}` }) },
  });
}

/** A nudge locking on its winning colour. `slot` is 1-based, `of` the total colours. */
export async function lock({ n, hex, name, total, collectors, slot, of = 12, locked = [] }) {
  const label = name || nameFor(hex);
  await push({
    id: `lock:${n.id}`,
    kind: 'lock',
    text: copy.lockTweet({ name: label, hex: clean(hex), total, collectors, slot, of }),
    image: { og: qs({ tweet: 'lock', hex: clean(hex), name: label || '', locked: locked.map(clean).join(','), total: `${copy.tao(total)} TAO · ${collectors} COLLECTOR${collectors === 1 ? '' : 'S'}`, cap: `LOCKED · COLOUR ${slot} OF ${of}` }) },
  });
}

/** A nudge opening. Idempotent per nudge id (the worker also guards with a marker). */
export async function open({ n, slot, locked = [] }) {
  await push({
    id: `open:${n.id}`,
    kind: 'open',
    text: copy.openTweet({ number: n.number, slot: slot || n.number, closes: n.closes }),
    image: { og: qs({ tweet: 'open', locked: locked.map(clean).join(','), open: '1', cap: `NUDGE #${n.number} · WEIGH IN` }) },
  });
}

/** A settled on-chain ETH sale. Reuses the work's existing OG card. */
export async function sale({ txHash, workId, collection, title, priceEth, who }) {
  await push({
    id: `sale:${txHash || workId}`,
    kind: 'sale',
    text: copy.saleTweet({ collection, title, priceEth, who, workUrl: workId ? `https://mintface.art/w/${workId}` : null }),
    image: workId ? { work: workId } : null,
  });
}
