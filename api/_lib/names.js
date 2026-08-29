/* Names.
 *
 * A wallet is an identity and a poor one to read. The register has always been
 * able to say what to call somebody ... a reverse ENS record, or a name Ryan
 * wrote down beside an address ... and everywhere the register speaks it uses
 * that name. This is the third source: the name a collector chooses for
 * themselves.
 *
 * Precedence is the whole of the design, and it runs one way:
 *
 *     what Ryan wrote down  >  what they chose  >  their ENS  >  the address
 *
 * Ryan's overlay outranks a self-set name for the same reason he can take a
 * note down: the register is his, and a name that has to be argued about is a
 * name he can simply set. A reset clears what somebody chose and leaves them
 * with their ENS, which is theirs on chain and not his to take.
 *
 * The slug never follows the name. URLs stay ENS-and-address canonical, so a
 * link made today still finds somebody who renames tomorrow, and a name is a
 * label rather than an address.
 *
 * Nothing here reaches the store or the network. Rules and shapes only, so the
 * acceptance cases in scripts/names/test-names.mjs can run the real thing.
 */

export const NAME_MAX = 32;

const lower = (a) => String(a || '').toLowerCase();
export const shortAddress = (a) => (a ? `${String(a).slice(0, 6)}…${String(a).slice(-4)}` : null);

/* Characters that look like other characters.
 *
 * Uniqueness that only folds case is uniqueness a determined impersonator walks
 * straight through: MintFace, MintFace with a Cyrillic e, M1ntFace and mint-face
 * are four different strings and one name. So a name is compared by what it
 * looks like rather than by what it is ... accents dropped, lookalikes mapped
 * home, everything that is not a letter or a digit thrown away.
 *
 * The fold is deliberately brutal. It costs a collector the occasional name
 * that was free in the strict sense, and it buys the register the guarantee
 * that two collectors never read as one. That trade is the right way round.
 */
const CONFUSABLE = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g',
  '|': 'i', '!': 'i', $: 's', '@': 'a',
  /* l and i are one letter to the eye in almost every face on the web, and a
     one in place of either is the oldest trick there is. All three go home to
     the same letter, which is why MintFace, MlntFace and M1ntFace are one
     reserved name rather than three. */
  l: 'i',
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ѕ': 's', 'і': 'i',
  'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k',
  'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
};

/** What a name looks like, reduced to the letters it looks like. */
export function fold(name) {
  return String(name == null ? '' : name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')          // the accents NFKD has just separated off
    .toLowerCase()
    .replace(/./gu, (ch) => CONFUSABLE[ch] || ch)
    .replace(/[^a-z0-9]+/g, '');
}

/* Kept by the register. The artist's own names first ... every wallet in
   data/source/artist.json, and the vault ... then the words a page uses to
   speak with its own authority. Folded, so the close variants go with them. */
export const RESERVED = new Set([
  'mintface', 'mintfaceart', 'themintface', 'mintfaceofficial', 'officialmintface',
  'mintfacestudio', 'mintestate', 'mintfaced', 'ryanj', 'ryanjennings',
  'theartist', 'artist', 'thegallery', 'theline', 'thelinegallery',
  'admin', 'administrator', 'moderator', 'support', 'staff', 'team', 'official',
  'studio', 'collectors', 'collector', 'register', 'tao',
  'private', 'privatecollector', 'anonymous', 'deleted', 'null', 'undefined',
].map(fold));

/* Characters a page cannot show: the control codes, and the format characters
   that are invisible on purpose. A zero-width joiner hides a difference the eye
   cannot check, and a bidi override reverses the text after it. Unicode already
   keeps a list of exactly these and calls it Other, so the list is not kept
   twice. A name is read; anything that cannot be read has no business in one. */
const UNREADABLE = /\p{C}/u;

/**
 * What may be used as a name.
 * @param ens  the .eth names this wallet actually holds. An .eth name is
 *             claimed on chain, so it may be typed here only by the wallet it
 *             already resolves to ... otherwise it is somebody else's identity
 *             worn as a label.
 */
export function checkName(text, { ens = [] } = {}) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const len = [...raw].length;
  if (!raw) return { error: 'a name needs some letters in it' };
  if (len > NAME_MAX) return { error: `${len} characters, and a name here is ${NAME_MAX} at most` };
  if (UNREADABLE.test(raw)) return { error: 'that name carries characters this page cannot show' };
  if (raw.includes('@')) return { error: 'a name cannot carry an @ ... that is how Studio starts a tag' };
  if (/^0x[0-9a-f]{6,}$/i.test(raw)) return { error: 'that reads as a wallet address rather than as a name' };

  const key = fold(raw);
  if (!key) return { error: 'a name needs letters or numbers in it, not punctuation alone' };
  if (RESERVED.has(key)) return { error: 'that name is kept by the register' };
  if (/\.eth$/i.test(raw) && !ens.map(fold).includes(key)) {
    return { error: 'an .eth name is claimed on chain rather than typed here' };
  }
  return { name: raw, key };
}

/**
 * What to call a wallet, in the one order that decides it everywhere.
 * @param overlay  the name Ryan wrote down, from the register
 * @param self     the name the collector chose, from the store
 * @param ens      their reverse record, which they set
 * @param fwd      the one name that resolves to them, which they did not
 */
export function nameFor({ overlay = null, self = null, ens = null, fwd = null, address = null } = {}) {
  return overlay || self || ens || fwd || shortAddress(address) || null;
}

/* The fourth tier is last for a reason, and it is named apart from the third
   wherever it is asked about.
   A reverse record is a wallet saying what it is called. A forward pointer is
   a name saying where it goes, which is a weaker claim in the direction that
   matters: anybody can point a name at anybody's wallet. It is only worth
   anything because it is the only one ... see api/_lib/ens.js ... and the
   register keeps the two apart so the audit trail knows which tier named whom,
   even though a reader sees no difference. */
export function sourceOf({ overlay = null, self = null, ens = null, fwd = null } = {}) {
  if (overlay) return 'overlay';
  if (self) return 'self';
  if (ens) return 'ens';
  if (fwd) return 'ens-forward';
  return 'address';
}

/* Where the name a person is reading came from, said once: whether it is
   something anybody signed for or merely something that points their way. The
   nudge to set a name is drawn from this ... a wallet on the fourth tier is
   named, and still has not said so itself. */
export const TIERS_UNCLAIMED = new Set(['ens-forward', 'address']);

/* ---------------------------------------------------------- the register */

/**
 * The columnar register, read by name rather than by position.
 * `data/collectors-register.json` carries every collector, which is what both
 * the uniqueness guard and the tag index need: a collector holding one edition
 * copy has no page and is still somebody who can be tagged and named.
 */
export function registerIndex(register) {
  const fields = (register && register.fields) || [];
  const col = Object.fromEntries(fields.map((f, i) => [f, i]));
  const byAddress = new Map();
  for (const r of (register && register.rows) || []) {
    const address = lower(r[col.address]);
    if (!address) continue;
    const ens = col.ens == null ? null : (r[col.ens] || null);
    /* The one name that points here, where nothing points back. A column of
       its own rather than folded into `ens`, because the two are different
       claims and the register is the place that has to know which. */
    const fwd = col.fwd == null ? null : (r[col.fwd] || null);
    const name = r[col.name] || null;
    byAddress.set(address, {
      address,
      ens,
      fwd,
      name,
      /* The register writes one name field, which is the overlay where there is
         one and the ENS otherwise. Splitting them again here is what lets a
         self-set name know whether it is outranked. */
      overlay: name && name !== ens ? name : null,
      slug: r[col.slug] || null,
      private: Boolean(r[col.private]),
      tao: Number(r[col.tao]) || 0,
      works: Number(r[col.works]) || 0,
    });
  }
  return byAddress;
}

/**
 * Everything the site needs to say who somebody is, from the two sources.
 *
 * @param rows     registerIndex()
 * @param self     address -> the name they chose
 * @param special  address -> { name, url }, for the wallets the register does
 *                 not hold. The artist is the whole of this list: his wallets
 *                 are excluded from the register by design, which would leave
 *                 the one person everybody wants to tag untaggable, and his
 *                 name pointing at nothing. He is named here and linked to the
 *                 front door rather than to a collector page he cannot have.
 */
export function naming(rows, self = {}, special = {}) {
  const chosen = new Map(Object.entries(self || {}).map(([a, n]) => [lower(a), n]));
  const named = new Map(Object.entries(special || {}).map(([a, v]) => [lower(a), v]));

  const who = (address) => {
    const a = lower(address);
    const fixed = named.get(a);
    if (fixed) {
      return { address: a, name: fixed.name, slug: null, url: fixed.url || null, ens: null,
        overlay: null, self: null, private: false, source: 'artist', tao: 0, fixed: true, known: true };
    }
    const r = rows.get(a) || null;
    const s = chosen.get(a) || null;
    const overlay = r ? r.overlay : null;
    const ens = r ? r.ens : null;
    const fwd = r ? r.fwd : null;
    /* A private collector is a private collector wherever they are named. The
       name they chose is still theirs and still held; it is simply not what
       this register says out loud. */
    if (r && r.private) {
      return { address: a, name: 'Private collector', slug: null, ens: null, overlay: null,
        self: null, private: true, source: 'private', tao: r.tao, known: true };
    }
    return {
      address: a,
      /* Whether the register holds this wallet at all.
         A collector who sells everything leaves it, and their name leaves with
         them ... which would quietly turn every message and note they ever
         wrote back into a hex string. So callers are told, and keep the name
         the row was written under for a wallet the register no longer sees. */
      known: Boolean(r),
      name: nameFor({ overlay, self: s, ens, fwd, address: a }),
      slug: r ? r.slug || null : null,
      ens: ens || null,
      /* Kept apart from `ens` all the way out to the caller. Nothing on the
         register draws them differently; the difference is a fact about the
         name, and facts about names are what this file is for. */
      fwd: fwd || null,
      overlay: overlay || null,
      self: s,
      private: false,
      source: sourceOf({ overlay, self: s, ens, fwd }),
      tao: r ? r.tao : 0,
    };
  };

  const urlOf = (a) => {
    const w = who(a);
    if (w.url) return w.url;
    return w.slug ? `https://collectors.mintface.art/${encodeURIComponent(w.slug)}` : null;
  };

  return { who, rows, chosen, named, nameOf: (a) => who(a).name, slugOf: (a) => who(a).slug, urlOf };
}

/* ------------------------------------------------------- who owns a name */

/**
 * Whether this name is free for this wallet.
 * Three ways it is not: another collector chose it, another collector's ENS
 * already reads as it, or Ryan wrote it down beside another address.
 * @returns null when free, otherwise a sentence saying why not
 */
export function claimedBy(key, { address, rows, taken = {} }) {
  const me = lower(address);
  const holder = lower((taken || {})[key] || '');
  if (holder && holder !== me) return 'another collector already goes by that name';
  for (const r of rows.values()) {
    if (r.address === me) continue;
    if (r.ens && fold(r.ens) === key) return "that is another collector's .eth name";
    if (r.overlay && fold(r.overlay) === key) return 'another collector already goes by that name';
  }
  return null;
}

/* --------------------------------------------------------------- tagging */

/**
 * The index an @ is matched against: every way a collector can be written.
 * Names and ENS fold; an address is compared as it is written, since folding
 * hex would only invent collisions.
 */
export function tagIndex(register) {
  const byKey = new Map();
  const put = (key, address) => { if (key && !byKey.has(key)) byKey.set(key, address); };
  /* The artist first, so his name is his however the register happens to sort:
     nobody else can take @MintFace off him by being iterated over sooner. */
  for (const [address, v] of register.named || []) {
    put(fold(v.name), address);
    byKey.set(address, address);
  }
  for (const [address, r] of register.rows) {
    const w = register.who(address);
    if (w.private) continue;                      // no name to tag, and no page to reach
    put(fold(w.name), address);
    if (r.ens) put(fold(r.ens), address);
    if (r.overlay) put(fold(r.overlay), address);
    const chosen = register.chosen.get(address);
    if (chosen) put(fold(chosen), address);
    byKey.set(address, address);                  // the whole address, written out
  }
  return byKey;
}

/* A tag begins at a boundary, so an email address is not four tags and a
   surname. Forty-eight characters is the longest a tag can run: a name is
   thirty-two, an address is forty-two, and folding only ever shortens. */
const BOUNDARY = /[\s"']|[\p{Ps}\p{Pi}\p{Pd}]/u;
const WINDOW = 48;
const ENDS_WELL = /[\p{L}\p{N}]$/u;

/**
 * Every @ in a message that lands on somebody, longest match first.
 *
 * The wallet is what a tag is, and the text is only how it was typed. So the
 * ranges come back with an address on them and nothing else: rendering looks
 * the wallet up when it draws, which is why a tag written on Monday still says
 * the right name after Tuesday's rename.
 *
 * @returns [{ start, len, address, text }] in the order they appear
 */
export function parseTags(text, index) {
  const s = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf('@', i);
    if (at < 0) break;
    if (at > 0 && !BOUNDARY.test(s[at - 1])) { i = at + 1; continue; }
    const line = s.slice(at + 1, at + 1 + WINDOW).split('\n')[0];
    let hit = null;
    for (let len = line.length; len > 0; len--) {
      const raw = line.slice(0, len);
      if (!ENDS_WELL.test(raw)) continue;          // never end a tag on punctuation
      const address = index.get(raw.toLowerCase()) || index.get(fold(raw));
      if (address) { hit = { start: at, len: len + 1, address, text: raw }; break; }
    }
    if (!hit) { i = at + 1; continue; }
    out.push(hit);
    i = hit.start + hit.len;
  }
  return out;
}

/**
 * A message ready to draw: the text as it was said, and the tags in it said as
 * they read now. The client splices; nothing about the stored row changes.
 */
export function dressTags(text, mentions, register) {
  const n = String(text == null ? '' : text).length;
  return (mentions || []).map((m) => {
    const w = register.who(m.address);
    return {
      start: m.start, len: m.len, address: m.address,
      name: w.name, slug: w.slug || null, url: register.urlOf(m.address),
    };
  }).filter((m) => Number.isInteger(m.start) && m.start >= 0 && m.start + m.len <= n);
}

/* ----------------------------------------------------------- the sentence */

/** What a wallet signs to be called something. */
export function nameMessage({ action, name, target, address, issued }) {
  const closing = action === 'reset'
    ? ['Signing clears a name from the register. It moves nothing and spends nothing.']
    : ['Signing writes this name on the register. It moves nothing and spends nothing.',
      'Your wallet stays your address, and your page keeps its URL.'];
  return [
    'MintFace ... the register',
    '',
    `Action: ${action}`,
    ...(name != null ? [`Name: ${name}`] : []),
    ...(target ? [`Subject: ${target}`] : []),
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    ...closing,
  ].join('\n');
}

/* ------------------------------------------------------------- the store */

export const keys = {
  self: 'name:self',        // address -> the name they chose
  claim: 'name:claim',      // folded name -> the address holding it
  log: 'name:log',          // every change, oldest first
};

export function namesStore(pipe) {
  const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };

  /* Upstash answers HGETALL as a flat array. Both shapes are handled because
     the stand-in store the tests run against answers with an object. */
  const asMap = (v) => {
    if (!v) return {};
    if (Array.isArray(v)) {
      const out = {};
      for (let i = 0; i < v.length; i += 2) out[String(v[i])] = v[i + 1];
      return out;
    }
    return v;
  };

  return {
    /** Every self-set name, which is one command and a small answer. */
    async all() {
      const [rows] = await pipe([['HGETALL', keys.self]]);
      const out = {};
      for (const [a, n] of Object.entries(asMap(rows))) out[lower(a)] = n;
      return out;
    },
    async taken() {
      const [rows] = await pipe([['HGETALL', keys.claim]]);
      const out = {};
      for (const [k, a] of Object.entries(asMap(rows))) out[k] = lower(a);
      return out;
    },
    async get(address) {
      const [n] = await pipe([['HGET', keys.self, lower(address)]]);
      return n || null;
    },

    /**
     * Take a name, if it is going.
     * HSETNX is the whole of the race: the store decides who got there first,
     * not a read followed hopefully by a write.
     */
    async claim(key, address) {
      const [won] = await pipe([['HSETNX', keys.claim, key, lower(address)]]);
      if (Number(won) === 1) return { ok: true };
      const [holder] = await pipe([['HGET', keys.claim, key]]);
      return lower(holder) === lower(address) ? { ok: true, already: true } : { ok: false, holder: lower(holder) };
    },
    async release(key) {
      if (key) await pipe([['HDEL', keys.claim, key]]);
    },
    async set(address, name) {
      await pipe([['HSET', keys.self, lower(address), name]]);
    },
    async clear(address) {
      await pipe([['HDEL', keys.self, lower(address)]]);
    },

    /* Changes are logged. A name is what everybody else sees, so a name that
       changed is a thing that happened, and the register keeps what happened. */
    async note(entry) {
      await pipe([['RPUSH', keys.log, JSON.stringify(entry)]]);
      return entry;
    },
    async history(limit = 100) {
      const [rows] = await pipe([['LRANGE', keys.log, String(-Math.abs(limit)), '-1']]);
      return (rows || []).map(parse).filter(Boolean).reverse();
    },
  };
}
