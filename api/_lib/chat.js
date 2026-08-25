/* The room.
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

const lower = (a) => String(a || '').toLowerCase();

/** The sentence a wallet signs. */
export function chatMessage({ action, text, target, address, issued, until }) {
  /* The closing lines never name a duration. The Until line above already says
     exactly when this runs out, to the second, and it is worked out from the
     config ... so changing the length of a sign-in changes one number and the
     wallet still shows the truth. A sentence that said "for a week" beside a
     date a month away would be the config and the prose disagreeing in front
     of the person being asked to trust it. */
  const closing = action === 'sign in'
    ? [
      'Signing opens the room until the date above. It moves nothing and spends nothing.',
      'Until then this browser can speak here without asking again.',
    ]
    : ['Signing speaks in the room. It moves nothing and spends nothing.'];
  return [
    'MintFace ... the room',
    '',
    `Action: ${action}`,
    ...(text != null ? [`Message: ${text}`] : []),
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
    return { error: `${t.length} characters, and the room's limit is ${cfg.max_chars}` };
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

/**
 * How one stored message reads now.
 * A deleted message leaves its place rather than its words: the room should
 * show that something was said and taken down, not pretend the conversation
 * never had a gap in it. The artist sees what it was, and can put it back.
 */
export function render(row, { isArtist, artist } = {}) {
  if (!row) return null;
  /* Read from the row where it was written down, and from the config where it
     was not: a message said before the artist was known as the artist should
     still read as his. */
  const mine = row.role === 'artist'
    || Boolean(artist && artist[String(row.address || '').toLowerCase()]);
  const base = mine
    ? { n: row.n, address: row.address, name: 'MintFace', role: 'artist', tao: null, worn: null,
        at: row.at, deleted: Boolean(row.deleted) }
    : { n: row.n, address: row.address, name: row.name || null, role: 'collector',
        tao: row.tao || 0, worn: wearTao(row.tao), at: row.at, deleted: Boolean(row.deleted) };
  if (row.deleted && !isArtist) return { ...base, text: null };
  return { ...base, text: row.text, ...(isArtist ? { can_delete: true } : {}) };
}

export const keys = {
  msg: (n) => `chat:m:${n}`,
  log: 'chat:log',
  muted: 'chat:muted',
  floor: (a) => `chat:floor:${lower(a)}`,
  burst: (a) => `chat:burst:${lower(a)}`,
  session: (t) => `chat:s:${t}`,
};

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
  };
}
