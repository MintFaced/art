/* The bot's voice, in one place. Mono-terse: caps, · separators, no hashtags,
 * no exclamation marks, no emoji beyond 🧧 (the TAO glyph) and the odd 🍒. TAO
 * figures are grouped and read as figures. Ryan supplies nothing per tweet;
 * these templates carry the voice.
 *
 * Pure text only — an event's image and link are assembled by the caller. Every
 * function returns a single line of tweet text.
 */

const ART = 'https://mintface.art';

// A collector, as the feed names them: their @handle when known, their display
// name when not, and a neutral stand-in when they have opted out of being named.
export function actor(who = {}) {
  if (who.optOut) return 'A COLLECTOR';
  if (who.handle) return '@' + String(who.handle).replace(/^@/, '');
  if (who.name) return String(who.name).toUpperCase();
  return 'A COLLECTOR';
}

// TAO figures: grouped thousands, always as figures, never abbreviated.
export const tao = (n) => Number(n || 0).toLocaleString('en-US');

// A colour, as the feed writes it: ≈ NAME, or ≈ #HEX when it has no name yet.
export function colour({ name, hex } = {}) {
  if (name) return '≈ ' + String(name).toUpperCase();
  if (hex) return '≈ #' + String(hex).replace(/^#/, '').toUpperCase();
  return '≈ A COLOUR';
}

// 28 SEP '26 — short, caps, the way the feed dates things.
export function shortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} '${String(d.getUTCFullYear()).slice(-2)}`;
}

const ordinals = ['ZEROTH', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH'];
export const ordinal = (n) => ordinals[n] || `#${n}`;

/* 1. NUDGE #3 · WEIGH IN ON THE THIRD COLOUR · CLOSES 28 SEP '26  (+ /studio) */
export function openTweet({ number, slot, closes, prompt }) {
  const mid = prompt || `WEIGH IN ON THE ${ordinal(slot || number)} COLOUR`;
  return line([`NUDGE #${number}`, mid, `CLOSES ${shortDate(closes)}`]) + link(`${ART}/studio`);
}

/* 2. ≈ POWDER BLUE PROPOSED BY @0xunix · NUDGE #3 */
export function proposeTweet({ number, name, hex, who }) {
  return line([`${colour({ name, hex })} PROPOSED BY ${actor(who)}`, `NUDGE #${number}`]);
}

/* 3. @piercedcat PUT 100,000 TAO 🧧 BEHIND ≈ LIGHT GREEN
 *    @keyrun MOVED 13,749 TAO TO ≈ ORCHID   (a move) */
export function weighTweet({ who, amount, name, hex, move }) {
  const swatch = colour({ name, hex });
  return move
    ? `${actor(who)} MOVED ${tao(amount)} TAO 🧧 TO ${swatch}`
    : `${actor(who)} PUT ${tao(amount)} TAO 🧧 BEHIND ${swatch}`;
}

/* 4. LOCKED · ≈ LIGHT GREEN · 627,000 TAO · 4 COLLECTORS · COLOUR 2 OF 12 */
export function lockTweet({ name, hex, total, collectors, slot, of = 12 }) {
  return line([
    'LOCKED',
    colour({ name, hex }),
    `${tao(total)} TAO`,
    `${collectors} COLLECTOR${collectors === 1 ? '' : 'S'}`,
    `COLOUR ${slot} OF ${of}`,
  ]);
}

/* 5. COLLECTED · GHOST · TWO BURDENS · 0.3 ETH · @handle  (+ work page) */
export function saleTweet({ collection, title, priceEth, who, workUrl }) {
  const parts = ['COLLECTED'];
  if (collection) parts.push(String(collection).toUpperCase());
  if (title) parts.push(String(title).toUpperCase());
  parts.push(`${trimEth(priceEth)} ETH`);
  const a = who && !who.optOut && (who.handle || who.name) ? actor(who) : null;
  if (a) parts.push(a);
  return line(parts) + (workUrl ? link(workUrl) : '');
}

// ---- helpers ----
function line(parts) {
  // caps house voice, · separators, and the voice bans ! entirely
  return parts.filter(Boolean).join(' · ').replace(/!/g, '');
}
function link(url) { return url ? `\n${url}` : ''; }
function trimEth(n) {
  const x = Number(n || 0);
  // up to 4 dp, no trailing zeros: 0.3, 0.305, 1.2345
  return String(Math.round(x * 1e4) / 1e4);
}
