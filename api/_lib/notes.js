/* Notes on the works.
 *
 * The artist writes on any work. The wallet holding a work writes on that work,
 * publicly or privately. A collector who has held enough art for long enough
 * ... 69,000 TAO, a thousand days of a single 1/1 ... writes on any work, always
 * publicly. The three of them writing to each other is the point: the artworks
 * become the rooms.
 *
 * Two rules give the layer its shape, and both are worked out at read time
 * rather than by a job that moves rows about:
 *
 *   A note's standing follows its author's standing with the work. When a work
 *   is sold, the seller's public notes do not disappear ... they become
 *   provenance, attributed and dated with the tenure they were written in.
 *   Notes are provenance too.
 *
 *   A private note is private to a tenancy, not to a person. It renders to its
 *   author while they hold the work and to nobody afterwards, including them.
 *   It is not deleted; it simply stops being renderable, the way a conversation
 *   in a room stops when you no longer live there.
 *
 * Nothing here reaches the store or the chain. Rules in, shapes out, so the
 * acceptance cases in scripts/notes/test-notes.mjs can run the real thing.
 */

import { isArtist, ARTIST_NAME } from './artist.js';

export const ROLES = ['artist', 'collector', 'senior'];

const lower = (a) => String(a || '').toLowerCase();
const year = (d) => (d ? String(d).slice(0, 4) : null);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;

/** The sentence a wallet signs. Says plainly what it is agreeing to. */
export function noteMessage({ action, work, text, visibility, address, issued }) {
  return [
    'MintFace ... a note on a work',
    '',
    `Work: ${work}`,
    `Action: ${action}`,
    ...(text != null ? [`Note: ${text}`] : []),
    ...(visibility ? [`Visible: ${visibility}`] : []),
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    'Signing writes this note. It moves nothing and spends nothing.',
  ].join('\n');
}

/** Every wallet holding this work right now, lowercased. */
export function holdersOf(work) {
  const out = new Set();
  const c = work && work.collector;
  if (c && c.address) out.add(lower(c.address));
  for (const h of (work && work.holders) || []) {
    if (h && h.address && (h.qty == null || Number(h.qty) > 0)) out.add(lower(h.address));
  }
  return out;
}

/** When this wallet's tenure began, as the catalogue records it. */
export function heldSince(work, address) {
  const a = lower(address);
  const c = work && work.collector;
  if (c && lower(c.address) === a && c.acquired) return c.acquired;
  for (const h of (work && work.holders) || []) {
    if (lower(h.address) === a && h.acquired) return h.acquired;
  }
  return null;
}

/**
 * What standing this wallet writes with, or why it may not.
 * @returns { role, name?, tao? } or { error }
 */
export function standing({ address, cfg, tao, holders }) {
  const a = lower(address);
  /* The artist first, always, and through the one shared test ... his wallets
     are excluded from TAO accrual by design, so any gate that reaches the
     threshold check before it reaches him shuts him out for good. */
  if (isArtist(cfg.artist, a)) return { role: 'artist', name: ARTIST_NAME };
  if (holders.has(a)) return { role: 'collector' };
  const held = Math.floor(Number(tao) || 0);
  if (held >= Number(cfg.senior_tao)) return { role: 'senior', tao: held };
  return {
    error: `A note here is for the artist, whoever holds the work, or a collector above `
      + `${Number(cfg.senior_tao).toLocaleString('en-NZ')} TAO. This wallet holds ${held.toLocaleString('en-NZ')}.`,
  };
}

/** What may be said, and how long it may be. */
export function checkText(text, cfg) {
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (!t) return { error: 'a note needs some words' };
  if (t.length > Number(cfg.max_chars)) {
    return { error: `${t.length} characters, and the limit is ${cfg.max_chars}` };
  }
  /* Line breaks are kept and nothing else is interpreted, so a pasted link
     stays a pasted link and no note can style the page it sits on. */
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) {
    return { error: 'that note carries characters this page cannot show' };
  }
  return { text: t };
}

/** Only the wallet holding a work may keep a note on it private. */
export function checkVisibility({ role, visibility }) {
  const v = visibility === 'private' ? 'private' : 'public';
  if (v === 'private' && role !== 'collector') {
    return { error: 'only the wallet holding a work can keep a note on it private' };
  }
  return { visibility: v };
}

/**
 * How one stored note reads now, to this viewer.
 * @returns null when it must not be rendered at all
 */
export function render(note, { holders, viewer, isArtist, currentAcquired }) {
  if (!note) return null;
  const author = lower(note.address);
  const stillHolds = holders.has(author);
  const me = Boolean(viewer && lower(viewer) === author);

  /* A private note belongs to a tenancy. While its author holds the work it is
     theirs to read; once the work has gone it renders to nobody, author and
     artist alike. Ryan can see that it exists in the data; he cannot make the
     page show it. Privacy is checked before moderation, so hiding a private
     note does not hand it to the person doing the hiding. */
  if (note.visibility === 'private' && !(me && stillHolds)) return null;

  /* Hidden is gone from the page for everyone except the artist, who sees it
     marked, because moderation you cannot undo is a trap rather than a tool. */
  if (note.hidden && !isArtist) return null;

  const base = {
    hidden: Boolean(note.hidden),
    id: note.id, work: note.work, text: note.text, at: note.at,
    edited: Boolean(note.edited_at), edited_at: note.edited_at || null,
    address: note.address, name: note.name || null,
    visibility: note.visibility, mine: me,
    can_edit: me, can_hide: Boolean(isArtist),
  };

  if (note.role === 'artist') {
    return { ...base, kind: 'artist', label: "Artist's note", byline: note.name || 'MintFace' };
  }

  if (stillHolds) {
    return {
      ...base, kind: 'collector', label: "Collector's note",
      byline: note.name || short(note.address),
      ...(note.role === 'senior' ? { tao: note.tao_at_post || null } : {}),
    };
  }

  /* They wrote it while holding the work, and the work has moved on. The note
     stays, dated with the tenure it was written in. */
  if (note.role === 'collector') {
    const from = year(note.held_since || note.at);
    const to = year(currentAcquired);
    const tenure = from && to && to !== from ? `collector ${from}–${to}`
      : (from ? `collector since ${from}` : 'a former collector');
    return {
      ...base, kind: 'provenance', label: 'Provenance note',
      byline: note.name || short(note.address), tenure,
    };
  }

  /* A senior collector who never held it: their standing is their TAO, and TAO
     is not tied to this work, so nothing about it has changed. */
  return {
    ...base, kind: 'collector', label: "Collector's note",
    byline: note.name || short(note.address), tao: note.tao_at_post || null,
  };
}

/**
 * The section as the work page draws it: the artist first, then whoever holds
 * the work, then the collectors writing from outside it, newest first. What has
 * become provenance is folded away underneath.
 */
export function arrange(notes, ctx) {
  const shown = notes.map((x) => render(x, ctx)).filter(Boolean);
  const rank = { artist: 0, collector: 1 };
  const holds = (x) => (ctx.holders.has(lower(x.address)) ? 0 : 1);
  const live = shown.filter((x) => x.kind !== 'provenance').sort((a, b) => {
    const ra = rank[a.kind] == null ? 2 : rank[a.kind];
    const rb = rank[b.kind] == null ? 2 : rank[b.kind];
    return ra - rb || holds(a) - holds(b) || String(b.at).localeCompare(String(a.at));
  });
  const provenance = shown.filter((x) => x.kind === 'provenance')
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    notes: live,
    provenance,
    counts: { shown: live.length + provenance.length, provenance: provenance.length },
  };
}

/* ---- the store, over whatever pipeline it is handed ---- */

export const keys = {
  note: (id) => `note:${id}`,
  work: (id) => `notes:work:${id}`,
  wallet: (a) => `notes:wallet:${lower(a)}`,
  all: 'notes:all',
  rate: (a, d) => `notes:rate:${lower(a)}:${d}`,
};

export const today = (at = new Date()) => at.toISOString().slice(0, 10);

/* An id that sorts by time and cannot collide: the millisecond it was written,
   then randomness. Sorting by id and sorting by date are the same sort. */
export function noteId(at = Date.now(), rand = Math.random) {
  return `${at.toString(36).padStart(9, '0')}${Math.floor(rand() * 1e9).toString(36).padStart(6, '0')}`;
}

export function notesStore(pipe, cfg = {}) {
  const parse = (s) => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; }
  };
  const readMany = async (ids) => {
    if (!ids || !ids.length) return [];
    const [rows] = await pipe([['MGET', ...ids.map(keys.note)]]);
    return (rows || []).map(parse).filter(Boolean);
  };

  return {
    async byWork(workId) {
      const [ids] = await pipe([['ZRANGE', keys.work(workId), '0', '-1']]);
      return readMany(ids);
    },
    async byWallet(address, limit = 100) {
      const [ids] = await pipe([['ZRANGE', keys.wallet(address), '0', '-1', 'REV']]);
      return readMany((ids || []).slice(0, limit));
    },
    async recent(limit = 50) {
      const [ids] = await pipe([['ZRANGE', keys.all, '0', String(Math.max(0, limit - 1)), 'REV']]);
      return readMany(ids);
    },
    async get(id) {
      const [row] = await pipe([['GET', keys.note(id)]]);
      return parse(row);
    },
    /** How many this wallet has written today, before writing another. */
    async spentToday(address, day = today()) {
      const [x] = await pipe([['GET', keys.rate(address, day)]]);
      return Number(x) || 0;
    },
    async put(note, { count = false, day = today() } = {}) {
      const score = String(Date.parse(note.at) || Date.now());
      const cmds = [
        ['SET', keys.note(note.id), JSON.stringify(note)],
        ['ZADD', keys.work(note.work), score, note.id],
        ['ZADD', keys.wallet(note.address), score, note.id],
      ];
      // the stream is public, so a private note never joins it
      if (note.visibility === 'public' && !note.hidden) cmds.push(['ZADD', keys.all, score, note.id]);
      if (count) {
        cmds.push(['INCR', keys.rate(note.address, day)]);
        cmds.push(['EXPIRE', keys.rate(note.address, day), '172800']);
      }
      if (cfg.index_keep) cmds.push(['ZREMRANGEBYRANK', keys.all, '0', String(-1 - Number(cfg.index_keep))]);
      await pipe(cmds);
      return note;
    },
    /** An edit or a hiding rewrites the row; only a deletion unlinks it. */
    async save(note) {
      const cmds = [['SET', keys.note(note.id), JSON.stringify(note)]];
      if (note.hidden || note.visibility !== 'public') cmds.push(['ZREM', keys.all, note.id]);
      await pipe(cmds);
      return note;
    },
    async remove(note) {
      await pipe([
        ['DEL', keys.note(note.id)],
        ['ZREM', keys.work(note.work), note.id],
        ['ZREM', keys.wallet(note.address), note.id],
        ['ZREM', keys.all, note.id],
      ]);
    },
    async countFor(address) {
      const [x] = await pipe([['ZCARD', keys.wallet(address)]]);
      return Number(x) || 0;
    },
  };
}
