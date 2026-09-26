/* THE STUDIO WIRE — the queue, and the voice.
 *
 * The bot tweets the studio's life as it happens: a nudge opening, a colour
 * proposed, every weigh-in, a lock, a sale. Nothing is summarised and nothing
 * is filtered, so the feed is a record rather than a highlight reel.
 *
 * THE QUEUE IS THE TRUTH AND THE TIMELINE IS THE RENDER. Events are written
 * here the moment they happen, by whatever wrote them ... a route, a cron, the
 * sale webhook ... and a worker drains them to X in order afterwards. That
 * split is the whole reliability story: posting cannot fail a weighing, a
 * retry cannot double-tweet because sending is recorded against the event id,
 * and an outage at X costs lateness rather than events. Late beats lost.
 *
 * Nothing in this file talks to X. Shapes, copy and the store only, so the
 * acceptance cases can run the real thing without a credential.
 */
import { pipe, storeConfigured } from './kv.js';
import { colourName } from './palette.js';

export const keys = {
  q: 'wire:q',                       // ids waiting, oldest first
  ev: (id) => `wire:e:${id}`,        // the event itself
  sent: 'wire:sent',                 // id -> what X gave back. The dedupe.
  dead: 'wire:dead',                 // id -> why it will never send
};

/* 🧧 is the TAO glyph in this voice and the only one that appears by rule.
   The brief allows the odd 🍒; it is not a template's to spend. */
export const TAO_GLYPH = '\u{1F9E7}';

const n = (x) => Math.round(Number(x) || 0).toLocaleString('en-NZ');
/* Caps, and without the sentence's own full stop: a question written for a
   page ends in one, and a line of middots does not. */
const up = (s) => String(s == null ? '' : s).toUpperCase().replace(/[.\s]+$/, '');

/* Mono-terse. Caps, middots, no hashtags, no exclamation marks. The rule is
   enforced rather than remembered, because a template added in a hurry is
   exactly where a stray hashtag would get in. */
export function speak(parts) {
  const line = parts.filter(Boolean).map((p) => String(p).trim()).join(' · ');
  return line.replace(/!/g, '').replace(/#(?=[A-Za-z])/g, '');
}

const DAY = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const shortDate = (d) => {
  const x = new Date(d);
  return `${x.getUTCDate()} ${DAY[x.getUTCMonth()]} '${String(x.getUTCFullYear()).slice(2)}`;
};

/**
 * What to call somebody, and whether to call them anything at all.
 *
 * A handle where the overlay knows one, the display name where it does not,
 * and NOTHING where they have asked to be left out. The opt-out is silent by
 * design: a tweet saying somebody declined to be named is still a tweet about
 * them. It also has to be honoured without the tweet collapsing, so a quiet
 * collector's act is still tweeted ... it simply has no name in it.
 */
export function who(address, overlay, register) {
  const a = String(address || '').toLowerCase();
  const o = ((overlay && overlay.collectors) || {})[a] || null;
  if (o && o.quiet) return { quiet: true, label: null, handle: null };
  const r = register && register.who ? register.who(a) : null;
  /* Verified > overlay > typed. The register's `x` folds the verified OAuth
     handle over the overlay column, so reading it here makes the bot's tags
     more accurate for free; `o.x` is the fallback for a wallet the register no
     longer holds. */
  const handle = (r && r.x) || (o && o.x) || null;
  if (handle) return { quiet: false, label: `@${handle}`, handle };
  /* A private collector on the register is not named here either. The register
     already decided that about them and this is the same fact in public. */
  if (r && r.private) return { quiet: true, label: null, handle: null };
  const name = (o && o.name) || (r && r.name) || null;
  return { quiet: false, label: name ? up(name) : null, handle: null };
}

/* ------------------------------------------------------------ the copy */

const SITE = () => process.env.SITE_ORIGIN || 'https://mintface.art';

/**
 * One event, as a tweet. Pure: everything it needs is on the event or handed
 * in, so the copy can be read in a test rather than inferred from a timeline.
 */
export function compose(ev, { overlay = null, register = null } = {}) {
  const p = ev.payload || {};
  const said = (hex) => up((colourName(hex) || {}).label || hex);
  const tag = (addr) => who(addr, overlay, register);

  if (ev.kind === 'nudge-open') {
    return {
      text: speak([`NUDGE #${p.number}`, up(p.question), `CLOSES ${shortDate(p.closes)}`])
        + `\n\n${SITE()}/studio`,
      card: { kind: 'strip', slot: p.slot },
    };
  }

  if (ev.kind === 'propose') {
    const w = tag(p.address);
    return {
      text: speak([said(p.hex) + (w.label ? ` PROPOSED BY ${w.label}` : ' PROPOSED'), `NUDGE #${p.number}`]),
      card: { kind: 'swatch', hex: p.hex, slot: p.slot },
    };
  }

  if (ev.kind === 'weigh') {
    const w = tag(p.address);
    const amount = `${n(p.amount)} TAO ${TAO_GLYPH}`;
    /* A move and a fresh weighing read differently because they are different
       acts: one is somebody arriving behind a colour, the other is somebody
       leaving one. The feed should not flatten that. */
    const body = p.moved
      ? speak([`${w.label || 'A COLLECTOR'} MOVED ${n(p.amount)} TAO ${TAO_GLYPH} TO ${said(p.hex)}`])
      : speak([`${w.label || 'A COLLECTOR'} PUT ${amount} BEHIND ${said(p.hex)}`]);
    return { text: body, card: { kind: 'swatch', hex: p.hex, slot: p.slot, total: p.total } };
  }

  if (ev.kind === 'nudge-lock') {
    /* THE HONESTY TRAVELS HERE TOO.
       A colour the studio locked over the thresholds reads as a plain LOCKED
       on the timeline unless this says otherwise ... and a feed is the one
       place a claim like that spreads beyond the people who were there. It is
       the same sentence the banked card carries, in this voice. */
    const artist = p.locked_by === 'artist';
    const short = [];
    if (artist) {
      if (p.met && !p.met.voters) short.push(`${p.voters} OF ${p.rule.voters} VOTERS`);
      if (p.met && !p.met.tao) short.push(`${n(p.total)} OF ${n(p.rule.tao)} TAO`);
    }
    return {
      text: speak([
        'LOCKED', said(p.hex), `${n(p.total)} TAO ${TAO_GLYPH}`,
        `${p.voters} COLLECTOR${p.voters === 1 ? '' : 'S'}`,
        `COLOUR ${p.slot} OF ${p.slots}`,
        artist ? `LOCKED BY THE ARTIST${short.length ? ` AT ${short.join(' AND ')}` : ''}` : null,
      ]),
      card: { kind: 'strip', slot: p.slot, hex: p.hex },
    };
  }

  if (ev.kind === 'nudge-mixed') {
    return { text: speak(['MIXED IN THE STUDIO', said(p.hex), `COLOUR ${p.slot} OF ${p.slots}`]),
      card: { kind: 'photo', image: p.image } };
  }

  if (ev.kind === 'sale') {
    const w = tag(p.address);
    return {
      text: speak(['COLLECTED', up(p.collection), up(p.title), up(p.price), w.label])
        + (p.url ? `\n\n${p.url}` : ''),
      card: { kind: 'work', id: p.id },
    };
  }

  return null;
}

/**
 * The pottle row, as the card draws it: one entry a slot, `#HEX` where it is
 * locked, `:o` where it is the one being asked, empty where nothing is.
 * Flattened to a string because it travels on a query, and the card must be
 * renderable from the URL alone.
 */
export function slotsRow(series, openSlot = null) {
  const board = (series && series.board) || [];
  const count = Math.max(1, Math.floor(Number(series && series.slots) || 12));
  const by = new Map(board.map((v) => [Number(v.slot), v]));
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const v = by.get(i);
    const hex = v && v.state === 'locked' && v.hex ? String(v.hex).toUpperCase() : '';
    const open = Number(openSlot) === i || (v && v.state === 'open');
    out.push(`${hex}${open ? ':o' : ''}`);
  }
  return out.join(',');
}

/* ----------------------------------------------------------- the queue */

export const wireConfigured = () => storeConfigured();

/** An id that sorts by time and cannot collide, as the notes do it. */
export const eventId = (at = Date.now()) =>
  `${at.toString(36).padStart(9, '0')}${Math.floor(Math.random() * 1e9).toString(36).padStart(6, '0')}`;

/**
 * Put an event on the wire.
 *
 * NEVER THROWS. A tweet that cannot be queued must not fail the weighing, the
 * lock or the sale that produced it ... the studio's own record is the thing
 * that matters and the timeline is downstream of it. A dropped tweet is a
 * dropped tweet; a dropped sale is a different kind of day.
 */
export async function enqueue(kind, payload, { test = false, at = Date.now() } = {}) {
  if (!storeConfigured()) return null;
  try {
    const id = eventId(at);
    const ev = { id, kind, at: new Date(at).toISOString(), test: Boolean(test), payload };
    await pipe([
      ['SET', keys.ev(id), JSON.stringify(ev)],
      ['RPUSH', keys.q, id],
    ]);
    return id;
  } catch (e) {
    console.error('wire: could not queue', kind, String(e && e.message ? e.message : e));
    return null;
  }
}

/** The next few, oldest first, without taking them off. */
export async function peek(limit = 10) {
  if (!storeConfigured()) return [];
  const [ids] = await pipe([['LRANGE', keys.q, '0', String(Math.max(0, limit - 1))]]);
  if (!ids || !ids.length) return [];
  const rows = await pipe(ids.map((i) => ['GET', keys.ev(i)]));
  return rows.map((r, i) => {
    try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return { id: ids[i], kind: 'unreadable' }; }
  }).filter(Boolean);
}

/** Whether this one has already gone out. The guard against double-tweeting. */
export async function alreadySent(id) {
  if (!storeConfigured()) return false;
  const [v] = await pipe([['HGET', keys.sent, id]]);
  return Boolean(v);
}

/** Off the queue, and recorded as gone. Only ever called after X said yes. */
export async function markSent(id, result) {
  await pipe([
    ['HSET', keys.sent, id, JSON.stringify({ at: new Date().toISOString(), ...(result || {}) })],
    ['LREM', keys.q, '1', id],
  ]);
}

/** Off the queue, and recorded as never going. Test events, and the unsendable. */
export async function markDead(id, why) {
  await pipe([
    ['HSET', keys.dead, id, JSON.stringify({ at: new Date().toISOString(), why: String(why).slice(0, 200) })],
    ['LREM', keys.q, '1', id],
  ]);
}

export async function depth() {
  if (!storeConfigured()) return 0;
  const [v] = await pipe([['LLEN', keys.q]]);
  return Number(v) || 0;
}
