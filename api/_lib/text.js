/* The text layer.
 *
 * What a message looks like, as against what it says. The log is permanent and
 * public, so everything here is done at the moment of drawing and nothing is
 * ever stored as markup: the row keeps the characters somebody typed, and this
 * turns them into a paragraph. That is what lets it reach backwards ... the
 * messages written before any of this existed, with a raw URL sitting in them
 * as text, become messages with a working link in them, and nothing stored had
 * to change for that.
 *
 * The subset is deliberately tiny. Bold, italic, a link with words on it, and
 * bare URLs made clickable. No headings, no images, no code fences, and no raw
 * HTML ever ... a room whose log is kept forever is a room where an injection
 * is kept forever too, so the only thing that reaches the page is markup this
 * file wrote, character by character, around text it escaped first.
 *
 * Markdown that does not come off renders as the characters that were typed.
 * A half-written link is somebody mid-sentence, not an error, and it should
 * read as what it is rather than as broken syntax.
 *
 * Nothing here reaches the store or the network. Rules only, so the acceptance
 * cases in scripts/chat/test-text.mjs can run the real thing.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/* Ours, across two deploys. A link home opens in this tab like any other page
   of the site; everything else is somebody else's and opens beside it. */
const FAMILY = /^(?:www\.)?(?:mintface\.art|collectors\.mintface\.art)$/i;
export const hostOf = (href) => { try { return new URL(href).hostname.toLowerCase(); } catch (e) { return null; } };
export const isFamily = (href) => FAMILY.test(hostOf(href) || '');

/** The only two schemes that ever become an href. Everything else is text. */
export function safeHref(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 500) return null;
  const whole = /^www\./i.test(s) ? `https://${s}` : s;
  let u;
  try { u = new URL(whole); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;          // credentials in a link are a trick, not a link
  if (!u.hostname.includes('.')) return null;
  return u.toString();
}

/* What a link is worn as. The scheme is noise on a line of prose and the tail
   of a long one is an id nobody reads, so the domain leads and the rest runs
   until it stops. Sixty characters is about a line of this measure. */
const SHOWN_MAX = 60;
export function shownUrl(raw) {
  const s = String(raw || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return s.length > SHOWN_MAX ? `${s.slice(0, SHOWN_MAX - 1)}…` : s;
}

/* Where a pasted URL ends and the sentence resumes.
   "See https://mintface.art/chat." is a link and a full stop, and the brackets
   only count as the URL's where the URL opened them ... which is the whole of
   why Wikipedia links used to break. */
const TAIL = '.,;:!?…"\'`*';
const PAIRS = { ')': '(', ']': '[', '}': '{' };
const balanced = (s, close) => {
  const open = PAIRS[close];
  let n = 0;
  for (const ch of s) { if (ch === open) n++; else if (ch === close) n--; }
  return n >= 0;
};
export function trimTail(s) {
  let t = String(s || '');
  for (;;) {
    const last = t[t.length - 1];
    if (!last) break;
    if (TAIL.includes(last)) { t = t.slice(0, -1); continue; }
    if (PAIRS[last] && !balanced(t, last)) { t = t.slice(0, -1); continue; }
    break;
  }
  return t;
}

/* One pass, one alternation, in the order things outrank each other: an escape,
   a link with words on it, bold, italic, and a bare URL last. Built fresh per
   call because it carries a lastIndex and the emphasis branches recurse. */
const markup = () => new RegExp([
  '\\\\([*\\[\\]\\\\])',                                        // \* ... the character, said plainly
  '\\[([^\\]\\n]{0,200})\\]\\(\\s*([^\\s()]{1,500})\\s*\\)',    // [words](url)
  '(?<!\\*)\\*\\*(?=\\S)((?:[^*\\n]|\\*(?!\\*))+?)(?<=\\S)\\*\\*(?!\\*)',   // **bold**
  '(?<!\\*)\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?!\\*)',           // *italic*, and never half a **
  '((?:https?://|www\\.)[^\\s<>"\'`]{2,500})',                  // a URL, as pasted
].join('|'), 'g');

const anchor = (href, text, cls) => `<a class="${cls}" href="${escape(href)}"`
  + (isFamily(href) ? '' : ' target="_blank" rel="nofollow ugc noopener noreferrer"')
  + `>${escape(text)}</a>`;

/* One stretch of a message, with the tags that fall inside it.
   Depth is how far in the emphasis has nested. Two is generous ... bold around
   a link is a sentence, bold around italic around bold is a fight ... and past
   it the inside is simply the words. */
function inline(s, tags, depth) {
  const marks = [];
  /* Markup may hold a name ... **@visco.eth** is a sentence somebody meant ...
     but it may never cut one in half. A span that crosses the edge of a tag is
     dropped and the scan moves on a character, which leaves the name whole and
     the stray asterisk showing as an asterisk. */
  const cutsTag = (a, b) => tags.some((t) => {
    const ta = t.start;
    const tb = t.start + t.len;
    return a < tb && b > ta && !(a <= ta && b >= tb);
  });
  const re = markup();
  let m;
  while ((m = re.exec(s))) {
    const a = m.index;
    const b = a + m[0].length;
    const on = () => { re.lastIndex = a + 1; };
    if (!m[0].length) { on(); continue; }
    if (cutsTag(a, b)) { on(); continue; }

    if (m[1] != null) marks.push({ a, b, kind: 'lit', text: m[1] });
    else if (m[3] != null) {
      const href = safeHref(m[3]);
      if (!href) { on(); continue; }                 // a link to nowhere is the characters that were typed
      marks.push({ a, b, kind: 'link', href, text: m[2] || shownUrl(m[3]) });
    } else if (m[4] != null) marks.push({ a, b, kind: 'strong', inner: [a + 2, b - 2] });
    else if (m[5] != null) marks.push({ a, b, kind: 'em', inner: [a + 1, b - 1] });
    else if (m[6] != null) {
      if (a > 0 && /[\w@]/.test(s[a - 1])) { on(); continue; }   // mid-word is not a URL
      const kept = trimTail(m[6]);
      const href = kept && safeHref(kept);
      if (!href) { on(); continue; }
      marks.push({ a, b: a + kept.length, kind: 'url', href, text: shownUrl(kept) });
    } else { on(); continue; }
    re.lastIndex = marks[marks.length - 1].b;
  }

  const all = tags.map((t) => ({ a: t.start, b: t.start + t.len, kind: 'tag', t }))
    .concat(marks)
    .sort((x, y) => x.a - y.a);

  let out = '';
  let i = 0;
  for (const sp of all) {
    if (sp.a < i) continue;
    out += escape(s.slice(i, sp.a));
    if (sp.kind === 'tag') {
      const label = `@${sp.t.name}`;
      out += sp.t.url
        ? `<a class="tag" href="${escape(sp.t.url)}">${escape(label)}</a>`
        : `<span class="tag">${escape(label)}</span>`;
    } else if (sp.kind === 'lit') out += escape(sp.text);
    else if (sp.kind === 'link' || sp.kind === 'url') out += anchor(sp.href, sp.text, 'lnk');
    else {
      const [ia, ib] = sp.inner;
      const inside = tags.filter((t) => t.start >= ia && t.start + t.len <= ib)
        .map((t) => ({ ...t, start: t.start - ia }));
      const body = depth >= 2
        ? escape(s.slice(ia, ib))
        : inline(s.slice(ia, ib), inside, depth + 1);
      out += sp.kind === 'strong' ? `<strong>${body}</strong>` : `<em>${body}</em>`;
    }
    i = sp.b;
  }
  return out + escape(s.slice(i));
}

/**
 * A message as a paragraph's worth of HTML ... the inside of the <p>, since the
 * room supplies the paragraph and its whitespace.
 *
 * @param mentions  the dressed tags: { start, len, name, url }, offsets into
 *                  the stored text. They outrank everything: a name is what the
 *                  register says it is, not something a message can restyle.
 */
export function renderProse(text, mentions = []) {
  const s = String(text == null ? '' : text);
  const tags = (mentions || [])
    .filter((m) => Number.isInteger(m.start) && m.start >= 0 && Number(m.len) > 0
      && m.start + m.len <= s.length)
    .sort((a, b) => a.start - b.start)
    .filter((m, i, arr) => i === 0 || m.start >= arr[i - 1].start + arr[i - 1].len);
  return inline(s, tags, 0);
}

/**
 * Every link a message carries, in the order they were written.
 *
 * Read off the stored text rather than off the rendering, so a link inside bold
 * counts and a link the room decided not to draw does not. This is the only
 * list of URLs the server will ever fetch: a preview is fetched because it is
 * already in the log, which took TAO and a signature to manage.
 */
export function linksIn(text, max = 3) {
  const s = String(text == null ? '' : text);
  const re = /\[[^\]\n]{0,200}\]\(\s*([^\s()]{1,500})\s*\)|((?:https?:\/\/|www\.)[^\s<>"'`]{2,500})/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) && out.length < max) {
    if (m[2] != null && m.index > 0 && /[\w@]/.test(s[m.index - 1])) continue;
    const href = safeHref(m[1] != null ? m[1] : trimTail(m[2]));
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}
