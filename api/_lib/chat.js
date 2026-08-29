/* Studio.
 *
 * One room, for anyone holding any TAO at all. A single edition copy held for a
 * single day is a voice, and the threshold sits there on purpose: the room is
 * not another leaderboard, it is the place the leaderboard was always for.
 *
 * A guestbook rather than a chat app. The log is append-only and kept forever,
 * so a message is a thing that was said on a date rather than a thing scrolling
 * past. Deleting does not remove: it marks, and the row stays in the data with
 * everything around it undisturbed. Nothing is ever renumbered, which is what
 * lets the page page backwards through years of it without the ground moving.
 *
 * No HTTP and no chain in here. Rules and store shape only, so the acceptance
 * cases can run the real thing.
 */

import { dressTags } from './names.js';
import { ARTIST_NAME as ARTIST } from './artist.js';
import { renderProse, linksIn } from './text.js';

const lower = (a) => String(a || '').toLowerCase();

/* What to call the author of a stored row.
   The register first, because a rename should reach everything they ever said.
   The name written into the row second, for somebody the register no longer
   holds ... a collector who has sold up leaves it, and their words should not
   turn back into a hex string when they do. */
const said = (who, stored) => (who && who.known ? who.name : (stored || (who && who.name) || null));

/** The sentence a wallet signs. */
export function chatMessage({ action, text, target, address, issued, until, reply, emoji, domain }) {
  /* The closing lines never name a duration. The Until line above already says
     exactly when this runs out, to the second, and it is worked out from the
     config ... so changing the length of a sign-in changes one number and the
     wallet still shows the truth. A sentence that said "for a week" beside a
     date a month away would be the config and the prose disagreeing in front
     of the person being asked to trust it. */
  const closing = action === 'sign in'
    ? [
      'Signing opens Studio until the date above. It moves nothing and spends nothing.',
      'Until then this browser can speak here without asking again.',
    ]
    : action === 'react'
      ? ['Signing leaves a reaction in Studio. It moves nothing and spends nothing.']
      : ['Signing speaks in Studio. It moves nothing and spends nothing.'];
  /* What a reply is answering, and which mark a reaction leaves, are both in
     the sentence. They are part of what was said: a page that could change the
     message a signature is hung under, or turn a cherry into a fire, would be
     signing something other than what was approved. */
  return [
    'MintFace ... Studio',
    '',
    `Action: ${action}`,
    /* Where this was asked for. Only on the sign-in, which is the only thing
       here that mints a credential and hands it to two hosts; every other
       action carries what it authorises in its own words and is spent at
       once. A sentence that named the site on all of them would be four more
       lines in four more wallets for nothing. */
    ...(domain ? [`Domain: ${domain}`] : []),
    ...(text != null ? [`Message: ${text}`] : []),
    ...(reply != null && reply !== '' ? [`Replying to: ${reply}`] : []),
    ...(emoji ? [`Reaction: ${emoji}`] : []),
    ...(target ? [`Subject: ${target}`] : []),
    `Wallet: ${address}`,
    ...(until ? [`Until: ${until}`] : []),
    `Issued: ${issued}`,
    '',
    ...closing,
  ].join('\n');
}

/* When a signature signed at `issued` runs out. Both sides work it out from the
   same two numbers rather than one telling the other, so there is nothing to
   disagree about and nothing to tamper with. */
export function sessionUntil(issued, days) {
  const t = Date.parse(issued);
  if (!Number.isFinite(t)) return null;
  return new Date(t + Number(days) * 86400000).toISOString();
}

/** What may be said, and how much of it. */
export function checkMessage(text, cfg) {
  const t = String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')                 // a wall of blank lines is a shout
    .trim();
  if (!t) return { error: 'say something' };
  if (t.length > Number(cfg.max_chars)) {
    return { error: `${t.length} characters, and Studio's limit is ${cfg.max_chars}` };
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) {
    return { error: 'that message carries characters this page cannot show' };
  }
  return { text: t };
}

/* TAO beside a name, worn lightly: 1.49M, 69.0K, 420. The room says roughly
   what someone holds, not exactly, because exactly is the register's job. */
export function wearTao(n) {
  const v = Math.floor(Number(n) || 0);
  if (v >= 1000000) return `${(v / 1000000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

/* ---------------------------------------------------------------- marks */

/* The set is small on purpose, and it is Ryan's to change: it lives in
   data/source/chat.json, and this list is only what stands in where a config
   has not said. Eight would already be a keyboard; six is a nod. */
export const REACTIONS = ['\ud83c\udf52', '\u2764\ufe0f', '\ud83d\udc4d', '\ud83d\udd25', '\ud83d\ude02', '\u2726'];

export const reactionSet = (cfg = {}) => {
  const list = Array.isArray(cfg.reactions) && cfg.reactions.length ? cfg.reactions : REACTIONS;
  return list.map((x) => String(x)).slice(0, 8);
};

/** One of Studio's marks, or nothing. Never what a browser felt like sending:
    the log is kept forever, so what may go into it is a list, not a length. */
export function checkReaction(emoji, cfg) {
  const e = String(emoji == null ? '' : emoji);
  if (!reactionSet(cfg).includes(e)) return { error: 'that is not one of Studio\'s reactions' };
  return { emoji: e };
}

/**
 * How one stored message reads now.
 *
 * Now, not then. The name written into the row is what the register said on the
 * day, and the register is asked again here ... so a collector who renames on
 * Tuesday is renamed on every message they have ever left, and the tags in
 * everybody else's messages follow them. A message is a thing that was said; a
 * name is a thing that is true, and the two do not have to be frozen together.
 * The stored name stays as the fallback for a wallet the register has since
 * lost sight of.
 *
 * A deleted message leaves its place rather than its words: the room should
 * show that something was said and taken down, not pretend the conversation
 * never had a gap in it. The artist sees what it was, and can put it back.
 *
 * @param register  api/_lib/register.js, or nothing where a caller has none
 */
export function render(row, dress = {}) {
  const { isArtist, artist, register, parents, reactions, viewer, cfg } = dress;
  if (!row) return null;
  /* Read from the row where it was written down, and from the config where it
     was not: a message said before the artist was known as the artist should
     still read as his. */
  const mine = row.role === 'artist'
    || Boolean(artist && artist[String(row.address || '').toLowerCase()]);
  const who = register ? register.who(row.address) : null;
  /* Whose name links where. A collector goes to their page on the register; the
     artist goes to the front door, which is the only page he has. Anyone the
     register will not name in public ... a private collector, or a wallet below
     the threshold that has never been given a page ... is drawn unlinked, which
     is the same restraint the register table already shows. */
  const url = mine ? 'https://mintface.art/' : (register ? register.urlOf(row.address) : null);
  const base = mine
    ? { n: row.n, address: row.address, name: ARTIST, role: 'artist', tao: null, worn: null,
        url, at: row.at, deleted: Boolean(row.deleted) }
    : { n: row.n, address: row.address, name: said(who, row.name), role: 'collector',
        tao: row.tao || 0, worn: wearTao(row.tao), url, at: row.at, deleted: Boolean(row.deleted) };
  /* What this message was answering, said as it reads now. The row keeps a
     message number and nothing else, so a reply survives its author renaming
     ... and survives that author being renamed by somebody else's hand. */
  base.reply = answering(row, dress);
  /* A deleted message takes its reactions down with it. They are not removed
     ... nothing in this room is ... but a mark stands under something that was
     said, and the room is not going to leave six cherries under a gap. */
  base.reactions = row.deleted ? [] : marksOf(reactions && reactions[row.n], viewer, cfg);
  if (row.deleted && !isArtist) return { ...base, text: null, html: null, links: [], mentions: [] };
  /* The tags, said as they read now. The row keeps wallets and offsets; what
     a wallet is called is looked up at the moment of drawing. */
  const mentions = register ? dressTags(row.text, row.mentions, register) : [];
  return {
    ...base,
    text: row.text,
    /* The sentence as it reads, rather than as it was typed: the tags spliced
       in, the URLs made clickable, and the little markdown the room allows.
       Built here, at the moment of drawing, and never stored ... which is why a
       message left before any of this existed comes back with its links live.
       The page prints this as it stands, so nothing but this file's own markup
       ever reaches it, wrapped around text this file escaped first. */
    html: renderProse(row.text, mentions),
    /* What the message points at, for the cards under it. */
    links: linksIn(row.text),
    mentions,
    ...(isArtist ? { can_delete: true } : {}),
  };
}

/* What a reply is answering.
 *
 * Stored as a message number and resolved at the moment of drawing, which is
 * the same argument the names layer already made: a message is a thing that
 * was said, and who said it is a thing that is true now. A reply written when
 * somebody was `0x6140f00e` reads with their name in it the day after they
 * choose one, and nothing stored changed.
 *
 * A message whose parent cannot be found still says it was a reply. The room
 * does not quietly turn an answer back into a remark. */
function answering(row, { parents, register, artist } = {}) {
  const n = Number(row && row.reply);
  if (!Number.isInteger(n) || n < 0) return null;
  const p = parents ? parents[n] : null;
  if (!p) return { n, address: null, name: null, url: null, deleted: false, found: false };
  const mine = p.role === 'artist' || Boolean(artist && artist[lower(p.address)]);
  const who = register ? register.who(p.address) : null;
  return {
    n,
    address: p.address,
    name: mine ? ARTIST : said(who, p.name),
    url: mine ? 'https://mintface.art/' : (register ? register.urlOf(p.address) : null),
    deleted: Boolean(p.deleted),
    found: true,
  };
}

/* The marks under a message: which ones, how many, and whether one of them is
   yours. Counted in the config's order, and anything the config has since
   dropped is kept on the end rather than swept away ... the marks are part of
   the record, and a room that erased them because a list was edited would be
   rewriting what people did. */
export function marksOf(held, viewer, cfg) {
  if (!held) return [];
  const me = lower(viewer);
  const order = reactionSet(cfg || {});
  const seen = new Set();
  const out = [];
  const put = (emoji) => {
    const wallets = held[emoji];
    if (!wallets || !wallets.length || seen.has(emoji)) return;
    seen.add(emoji);
    out.push({ emoji, count: wallets.length, mine: Boolean(me && wallets.includes(me)) });
  };
  for (const emoji of order) put(emoji);
  for (const emoji of Object.keys(held)) put(emoji);
  return out;
}

export const keys = {
  msg: (n) => `chat:m:${n}`,
  log: 'chat:log',
  muted: 'chat:muted',
  floor: (a) => `chat:floor:${lower(a)}`,
  burst: (a) => `chat:burst:${lower(a)}`,
  tags: (a) => `chat:tags:${lower(a)}`,
  session: (t) => `chat:s:${t}`,
  /* One list per tagged wallet, holding message numbers. A mention count is
     then a length rather than a walk of the whole room, which matters because
     the room is kept forever and the count is asked for on every load. */
  mentions: (a) => `chat:at:${lower(a)}`,
  seen: (a) => `chat:seen:${lower(a)}`,
  /* One hash per message, a field per wallet per mark. The field carries both,
     so one of each per wallet per message is a fact about the key rather than
     something the room has to remember to check. */
  marks: (n) => `chat:rx:${n}`,
  /* One number, bumped by every mark left or taken back. The poll carries it,
     so a room where nobody has reacted since you loaded costs a digit, and the
     page only goes asking what the marks are when this has moved. */
  markv: 'chat:rxv',
  spentMarks: (a) => `chat:rxs:${lower(a)}`,
};

/* How many mentions of one wallet are worth keeping. Anybody who has been
   tagged five hundred times since they last looked has been told. */
const MENTIONS_KEPT = 500;

export function chatStore(pipe, cfg = {}) {
  const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };
  const read = async (ns) => {
    if (!ns.length) return [];
    const [rows] = await pipe([['MGET', ...ns.map(keys.msg)]]);
    return (rows || []).map(parse).filter(Boolean);
  };

  return {
    async length() {
      const [n] = await pipe([['LLEN', keys.log]]);
      return Number(n) || 0;
    },

    /**
     * A page of the log, oldest first within the page.
     * `before` is a message number, not an offset: numbers are handed out once
     * and never reused, so a page stays the same page however much is said
     * while somebody is reading it.
     */
    async page({ before = null, limit = 50 } = {}) {
      const total = await this.length();
      const end = before == null ? total : Math.min(Number(before), total);
      const start = Math.max(0, end - limit);
      if (end <= 0) return { rows: [], start: 0, end: 0, total, more: false };
      const [ids] = await pipe([['LRANGE', keys.log, String(start), String(end - 1)]]);
      return { rows: await read(ids || []), start, end, total, more: start > 0 };
    },

    /** Anything said since message number `n`, for the poll. */
    async since(n, limit = 100) {
      const total = await this.length();
      const from = Math.max(0, Number(n) || 0);
      if (from >= total) return { rows: [], total };
      const [ids] = await pipe([['LRANGE', keys.log, String(from), String(Math.min(total, from + limit) - 1)]]);
      return { rows: await read(ids || []), total };
    },

    async get(n) {
      const [row] = await pipe([['GET', keys.msg(n)]]);
      return parse(row);
    },

    /** A handful of rows by number, for the cards a drawn page asks about. */
    async many(ns) {
      return read([...new Set((ns || []).filter((n) => Number.isInteger(n) && n >= 0))]);
    },

    /**
     * Say something. The number is the length of the log before the push, which
     * makes it the index of the row that has just been added.
     */
    async say(row) {
      const n = await this.length();
      const full = { ...row, n };
      await pipe([
        ['SET', keys.msg(n), JSON.stringify(full)],
        ['RPUSH', keys.log, String(n)],
      ]);
      return full;
    },

    async save(row) {
      await pipe([['SET', keys.msg(row.n), JSON.stringify(row)]]);
      return row;
    },

    /* ---- being spoken to ----
       A tag is stored on the message as a wallet, and mirrored here as a
       number, so the room can answer two questions cheaply: has anybody said
       my name, and how many times since I last looked. Nothing is emailed and
       nothing is pushed ... the room tells you inside the room, which is where
       you were going to read it anyway. */
    async mention(addresses, n) {
      const list = [...new Set((addresses || []).map(lower))].filter(Boolean);
      if (!list.length) return 0;
      const cmds = [];
      for (const a of list) {
        cmds.push(['RPUSH', keys.mentions(a), String(n)]);
        cmds.push(['LTRIM', keys.mentions(a), String(-MENTIONS_KEPT), '-1']);
      }
      await pipe(cmds);
      return list.length;
    },
    /** How many times this wallet has been named since it last came in. */
    async mentionsSince(address, seen) {
      const [rows] = await pipe([['LRANGE', keys.mentions(address), '0', '-1']]);
      const nums = (rows || []).map(Number).filter((x) => Number.isFinite(x));
      const from = Number(seen);
      const unseen = Number.isFinite(from) ? nums.filter((x) => x >= from) : nums;
      return {
        total: nums.length,
        unseen: unseen.length,
        last: nums.length ? nums[nums.length - 1] : null,
        /* The earliest one you have not read, because that is where the cherry
           takes you. Not the latest: being told your name was said is being
           told to go back and read from there, and a room that dropped you at
           the newest of six mentions would have you scrolling up for the rest. */
        next: unseen.length ? unseen[0] : null,
      };
    },
    async lastSeen(address) {
      const [x] = await pipe([['GET', keys.seen(address)]]);
      return x == null ? null : Number(x);
    },
    /* Marked on the way in, not on the way out. A count that says "since your
       last visit" has to be reset by the visit, and this is the visit. */
    async markSeen(address, n) {
      await pipe([['SET', keys.seen(address), String(Math.max(0, Number(n) || 0))]]);
    },

    /* ---- the marks under a message ----
       A hash per message, a field per wallet per mark, so one of each per
       wallet per message needs no counting and no locking: the field is either
       there or it is not, and pressing it again takes it back.

       Nothing is stored about who reacted beyond the wallet, which is the same
       thing the message above it already says out loud. Reading them is public
       like everything else here; leaving one takes TAO, like speaking. */
    async react(n, address, emoji) {
      const field = `${lower(address)}:${emoji}`;
      const [had] = await pipe([['HGET', keys.marks(n), field]]);
      if (had == null) {
        await pipe([['HSET', keys.marks(n), field, String(Date.now())], ['INCR', keys.markv]]);
        return { on: true };
      }
      await pipe([['HDEL', keys.marks(n), field], ['INCR', keys.markv]]);
      return { on: false };
    },

    /** The marks on a handful of messages: { n: { emoji: [wallet, ...] } }. */
    async marks(ns) {
      const list = [...new Set((ns || []).filter((n) => Number.isInteger(n) && n >= 0))];
      if (!list.length) return {};
      const rows = await pipe(list.map((n) => ['HGETALL', keys.marks(n)]));
      const out = {};
      list.forEach((n, i) => {
        /* Upstash answers a hash as a flat list; some versions answer an
           object. Both are read, because a store that changes its mind about
           that should not empty the reactions off a log kept forever. */
        const raw = rows[i];
        const fields = [];
        if (Array.isArray(raw)) for (let k = 0; k < raw.length; k += 2) fields.push(String(raw[k]));
        else if (raw && typeof raw === 'object') fields.push(...Object.keys(raw));
        if (!fields.length) return;
        const held = {};
        for (const f of fields) {
          const cut = f.indexOf(':');
          if (cut < 0) continue;
          const wallet = lower(f.slice(0, cut));
          const emoji = f.slice(cut + 1);
          if (!emoji) continue;
          (held[emoji] || (held[emoji] = [])).push(wallet);
        }
        if (Object.keys(held).length) out[n] = held;
      });
      return out;
    },

    /** Where the marks are up to. One number, for the poll to compare. */
    async marksVersion() {
      const [v] = await pipe([['GET', keys.markv]]);
      return Number(v) || 0;
    },

    /* Marks ride their own budget over the same ten minutes as the messages.
       They cost a keystroke rather than a sentence, so the floor between
       messages would be absurd here ... reacting to three things in a row is
       reading, not flooding ... but a room where one wallet can write a
       thousand hash fields a minute is a room with a hole in it. */
    async spendMarks(address) {
      const cap = Number(cfg.reaction_burst || 60);
      const [count] = await pipe([['INCR', keys.spentMarks(address)]]);
      if (Number(count) === 1) {
        await pipe([['EXPIRE', keys.spentMarks(address), String(cfg.burst_window_seconds || 600)]]);
      }
      if (Number(count) > cap) {
        return { error: `${cap} reactions in ${Math.round((cfg.burst_window_seconds || 600) / 60)} minutes is plenty.` };
      }
      return { ok: true, count: Number(count) };
    },

    /* ---- muting ---- */
    async isMuted(address) {
      const [x] = await pipe([['SISMEMBER', keys.muted, lower(address)]]);
      return Number(x) === 1;
    },
    async mute(address) { await pipe([['SADD', keys.muted, lower(address)]]); },
    async unmute(address) { await pipe([['SREM', keys.muted, lower(address)]]); },
    async muted() {
      const [x] = await pipe([['SMEMBERS', keys.muted]]);
      return x || [];
    },

    /* ---- one signature, then a week of speaking ----
       The token is minted on the server and only ever means anything there: the
       browser holds an opaque string, the store holds what it stands for.
       Nothing about the wallet can be read out of it, a stolen one buys a week
       of talking in one room and nothing else, and it stops mattering the
       moment it is closed or the week is up.

       The address a message is written under comes from the token and never
       from the request. A session already says who you are; letting the body
       say it as well would be leaving the door open beside the lock. */
    async openSession(token, address, seconds) {
      await pipe([['SET', keys.session(token), lower(address), 'EX', String(Math.floor(seconds))]]);
      return token;
    },
    async whoseSession(token) {
      if (!token || typeof token !== 'string' || token.length < 16) return null;
      const [a] = await pipe([['GET', keys.session(token)]]);
      return a ? String(a).toLowerCase() : null;
    },
    async closeSession(token) {
      if (!token) return;
      await pipe([['DEL', keys.session(token)]]);
    },

    /* ---- how often ----
       Two limits doing different jobs. The floor is a key that simply exists
       for fifteen seconds, so a second message inside that window finds it
       there. The burst cap is a counter over ten minutes, because fifteen
       seconds apart for an hour is still a flood, just a patient one. */
    async spend(address) {
      const [floor] = await pipe([['SET', keys.floor(address), '1', 'NX', 'EX', String(cfg.seconds_between || 15)]]);
      if (floor === null) return { error: `one message every ${cfg.seconds_between || 15} seconds. A moment.` };
      const [count] = await pipe([['INCR', keys.burst(address)]]);
      if (Number(count) === 1) await pipe([['EXPIRE', keys.burst(address), String(cfg.burst_window_seconds || 600)]]);
      if (Number(count) > Number(cfg.burst || 10)) {
        return { error: `${cfg.burst || 10} messages in ${Math.round((cfg.burst_window_seconds || 600) / 60)} minutes is plenty. Let it breathe.` };
      }
      return { ok: true, count: Number(count) };
    },

    /* Tags ride the same window as the messages carrying them.
       A message limit alone does not limit tagging: ten messages naming eight
       people each is eighty notifications inside the allowance, which is the
       whole of the spam. So the names spent are counted over the same ten
       minutes as the messages, and run out first. */
    async spendTags(address, n, cfg2 = {}) {
      const many = Math.max(0, Number(n) || 0);
      if (!many) return { ok: true, count: 0 };
      const cap = Number(cfg2.tag_burst || cfg.tag_burst || 25);
      const [count] = await pipe([['INCRBY', keys.tags(address), String(many)]]);
      if (Number(count) === many) {
        await pipe([['EXPIRE', keys.tags(address), String(cfg.burst_window_seconds || 600)]]);
      }
      if (Number(count) > cap) {
        return { error: `${cap} names in ${Math.round((cfg.burst_window_seconds || 600) / 60)} minutes is plenty. Say something to them instead.` };
      }
      return { ok: true, count: Number(count) };
    },
  };
}
