/* The collectors' palette: twelve colours, one nudge each.
 *
 * Nudge #1 asked for a colour. This is the arc that question was always the
 * first of ... twelve slots beside the red line, each one locked by its own
 * nudge, on the same two thresholds. When the twelfth locks, the Strip
 * Painting Maker's community palette is simply complete: it is the same
 * config the whole way, so there is nothing to migrate at the end of it.
 *
 * THE CONSTRAINT IS THE WHOLE IDEA. A palette chosen twelve times over by
 * whoever turns up would drift ... twelve nudges is twelve chances to pick a
 * warm mid-tone, and a wall of warm mid-tones is not a palette. So each nudge
 * after the first offers only colours that stand clear of everything already
 * locked, and the collectors choose freely inside that. The board self-
 * balances as it fills rather than being balanced afterwards by the artist,
 * which would make the whole exercise a suggestion box.
 *
 * Two things bound the field:
 *
 *   THE SPACE. The streetscape these paintings are sampled from is muted
 *   architectural colour, not neon ... so the field is the region the maker's
 *   own palette occupies, in lightness and in chroma. A colour outside it is
 *   refused for not belonging on a Hastings fascia rather than for clashing.
 *   The red line sits outside it, which is exactly what "the red line sits
 *   outside the palette" has always meant.
 *
 *   THE FLOOR. A candidate has to be at least this far from every colour
 *   already locked ... max-min: the distance to the nearest locked colour is
 *   the one that counts, because a colour is only as distinct as its closest
 *   neighbour.
 *
 * Distance is perceptual, in OKLab, where the straight-line distance between
 * two colours is roughly how different they look. Naive RGB would refuse a
 * clearly different colour and pass a barely different one, which on a rule
 * that turns people's TAO away is not a thing to get approximately right.
 * The scale has a natural anchor: black to white is exactly 1.
 */

import { checkHex } from './nudges.js';

/* ------------------------------------------------------------------ OKLab */

const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** sRGB hex to OKLab. Björn Ottosson's matrices, unchanged. */
export function oklab(hex) {
  const [r, g, b] = srgb(String(hex).toUpperCase()).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** The same, said the way a palette is usually read: lightness, chroma, hue. */
export function oklch(hex) {
  const [L, a, b] = oklab(hex);
  return { l: L, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** How different two colours look, on a scale where black to white is 1. */
export function deltaE(a, b) {
  const x = Array.isArray(a) ? a : oklab(a);
  const y = Array.isArray(b) ? b : oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The distance that counts: to the nearest colour in the set. Max-min, from
 *  the candidate's side ... a colour is only as distinct as its neighbour. */
export function nearest(hex, against) {
  const p = oklab(hex);
  let best = null;
  for (const other of against || []) {
    const d = deltaE(p, oklab(other));
    if (!best || d < best.distance) best = { hex: String(other).toUpperCase(), distance: d };
  }
  return best;
}

/* ------------------------------------------------------------- the space */

/* The region the maker's own palette occupies. Strip Painting No. 1 runs from
   lightness 0.26 to 0.84 and reaches chroma 0.16; the bounds are that, rounded
   out enough not to refuse a colour for being a shade beyond a colour already
   on the wall. */
export const SPACE = { l: [0.20, 0.90], chroma: 0.18 };

const spaceOf = (s) => ({
  l: (s && Array.isArray(s.l) && s.l.length === 2) ? s.l.map(Number) : SPACE.l,
  chroma: Number((s && s.chroma) ?? SPACE.chroma),
});

/** Whether a colour belongs to the streetscape space, and why it does not. */
export function inSpace(hex, space) {
  const s = spaceOf(space);
  const { l, c } = oklch(hex);
  if (l < s.l[0]) return { ok: false, why: 'darker than anything on these walls' };
  if (l > s.l[1]) return { ok: false, why: 'lighter than anything on these walls' };
  if (c > s.chroma) return { ok: false, why: 'more saturated than a streetscape colour' };
  return { ok: true };
}

/* -------------------------------------------------------------- the field
 *
 * Every colour in the space, on a grid, so "how much room is left" is a number
 * rather than an intuition. Built once and kept: it depends on nothing but the
 * bounds.
 *
 * Each point carries its hex as well as its OKLab, because the field is read
 * two ways ... counted, to measure how much room a floor leaves, and searched,
 * to find a colour that is actually in it. A grid of bare coordinates makes
 * the second one impossible without converting back.
 */
const FIELD_STEP = 8;
const fields = new Map();

export function field(space) {
  const s = spaceOf(space);
  const key = `${s.l[0]}:${s.l[1]}:${s.chroma}`;
  if (fields.has(key)) return fields.get(key);
  const out = [];
  const hx = (v) => Math.min(255, v).toString(16).padStart(2, '0');
  for (let r = 0; r < 256; r += FIELD_STEP) {
    for (let g = 0; g < 256; g += FIELD_STEP) {
      for (let b = 0; b < 256; b += FIELD_STEP) {
        const hex = `#${hx(r)}${hx(g)}${hx(b)}`.toUpperCase();
        if (!inSpace(hex, s).ok) continue;
        out.push({ hex, lab: oklab(hex) });
      }
    }
  }
  fields.set(key, out);
  return out;
}

/* --------------------------------------------------------------- the floor
 *
 * A FIXED floor would strangle the arc. Twelve colours all 0.20 apart barely
 * fit in this space at all ... a greedy packing manages thirteen ... so the
 * last slots would be asked for something that hardly exists while the first
 * were asked for almost nothing. Geometry, not policy: points in a bounded
 * region crowd as you add them.
 *
 * So the floor is derived rather than declared. It is the highest rung of a
 * fixed ladder that still leaves a quarter of the field open. Early slots get
 * 0.30 ... about a third of the way from black to white, which is more than
 * the distance between No. 1's blue and its green ... and it comes down as the
 * board fills, never past 0.10, never to nothing. The ladder keeps it a round,
 * sayable number, so a card can state the rule rather than a computation.
 */
export const LADDER = [0.30, 0.28, 0.26, 0.24, 0.22, 0.20, 0.18, 0.16, 0.14, 0.12, 0.10];
export const FIELD_SHARE = 0.25;

/** How much of the field stands at least `floor` from everything locked. */
export function share(against, floor, space) {
  const pts = field(space);
  if (!pts.length) return 0;
  const ps = (against || []).map(oklab);
  if (!ps.length) return 1;
  let open = 0;
  for (const p of pts) {
    let min = Infinity;
    for (const q of ps) {
      const d = deltaE(p.lab, q);
      if (d < min) min = d;
      if (min < floor) break;
    }
    if (min >= floor) open += 1;
  }
  return open / pts.length;
}

/** The floor this nudge is held to, and how much room it leaves. */
export function floorFor(against, { space, ladder = LADDER, minShare = FIELD_SHARE } = {}) {
  const rungs = ladder.length ? ladder : LADDER;
  if (!(against || []).length) return { floor: rungs[0], share: 1 };
  for (const rung of rungs) {
    const s = share(against, rung, space);
    if (s >= minShare) return { floor: rung, share: s };
  }
  const last = rungs[rungs.length - 1];
  return { floor: last, share: share(against, last, space) };
}

/* --------------------------------------------------------- the constraint */

/**
 * Whether a colour may go on the board, and ... where it may not ... what it
 * clashes with and by how much. The refusal names the colour rather than the
 * rule, because "too close to the colour locked on nudge #1" is a thing a
 * collector can do something about and "below the floor" is not.
 */
export function checkCandidate(raw, { against = [], floor = 0, space = SPACE, named = null } = {}) {
  const colour = checkHex(raw);
  if (colour.error) return colour;
  const hex = colour.hex;
  const place = inSpace(hex, space);
  if (!place.ok) {
    return { error: `${hex} is ${place.why}. The palette is sampled from the street, so it stays in that range.`, hex };
  }
  /* Which of these may be said out loud. Everything, unless the caller has
     something in the set that the studio does not talk about ... the red
     line, which every one of these paintings carries and none of these
     collectors chose. */
  const sayable = named ? new Set(named.map((h) => String(h).toUpperCase())) : null;
  const near = nearest(hex, against);
  if (near && near.distance < floor) {
    return {
      error: (!sayable || sayable.has(near.hex))
        ? `${hex} is ${near.distance.toFixed(2)} from ${near.hex}, and a colour here has to stand `
          + `${floor.toFixed(2)} clear of everything already locked. Pick something further from ${near.hex}.`
        /* Refused, and the neighbour is not named. A collector can still do the
           only thing there is to do about it, which is pick a different
           colour. */
        : `${hex} is too close to a colour these paintings already carry. A colour here has to stand `
          + `${floor.toFixed(2)} clear. Try something further from this one.`,
      hex, nearest: (!sayable || sayable.has(near.hex)) ? near.hex : null, distance: near.distance, floor,
    };
  }
  /* Allowed, and the clearance it is allowed by is reported from the sayable
     colours only ... "0.34 clear of #0E5890" is a useful thing to know, and
     "0.34 clear of a colour we will not tell you about" is not. */
  const say = sayable ? nearest(hex, against.filter((h) => sayable.has(String(h).toUpperCase()))) : near;
  return { hex, nearest: say ? say.hex : null, distance: say ? say.distance : null, floor };
}


/* ------------------------------------------------------- what to call it
 *
 * The bot speaks colours aloud ... "≈ LIGHT GREEN PROPOSED BY @0xunix" ... and
 * the name has to be the one the site already uses, or the feed and the page
 * would call the same swatch two different things.
 *
 * The table lived only in mintface.js, which is a browser script and cannot be
 * imported here. So it is canonical here now and the bundle keeps its copy,
 * with a check in scripts/tao/test-wire.mjs holding the two identical. A
 * hundred and fifty Pantones for the ones a signwriter would call out, and the
 * CSS names for everything else, because "Light Green" is what a person says.
 */
export const NAMES = [
  ['#DA291C', 'Pantone 485 C'], ['#E03C31', 'Pantone 179 C'], ['#C8102E', 'Pantone 186 C'],
  ['#A6192E', 'Pantone 187 C'], ['#9D2235', 'Pantone 201 C'], ['#862633', 'Pantone 202 C'],
  ['#EF3340', 'Pantone Red 032 C'], ['#F9423A', 'Pantone Warm Red C'], ['#D22630', 'Pantone 1795 C'],
  ['#CB333B', 'Pantone 1797 C'], ['#7C2529', 'Pantone 188 C'], ['#6C1D45', 'Pantone 229 C'],
  ['#FE5000', 'Pantone Orange 021 C'], ['#FF6A13', 'Pantone 165 C'], ['#E35205', 'Pantone 166 C'],
  ['#FA4616', 'Pantone 172 C'], ['#CF4520', 'Pantone 173 C'], ['#963821', 'Pantone 174 C'],
  ['#E87722', 'Pantone 158 C'], ['#FF8200', 'Pantone 151 C'], ['#ED8B00', 'Pantone 144 C'],
  ['#FFA300', 'Pantone 137 C'], ['#F2A900', 'Pantone 130 C'], ['#FFC72C', 'Pantone 123 C'],
  ['#FFCD00', 'Pantone 116 C'], ['#FFD100', 'Pantone 109 C'], ['#FEDD00', 'Pantone Yellow C'],
  ['#F3E500', 'Pantone 3945 C'], ['#D0DF00', 'Pantone 388 C'], ['#97D700', 'Pantone 375 C'],
  ['#78BE20', 'Pantone 368 C'], ['#43B02A', 'Pantone 361 C'], ['#009639', 'Pantone 355 C'],
  ['#00843D', 'Pantone 348 C'], ['#046A38', 'Pantone 349 C'], ['#007A53', 'Pantone 341 C'],
  ['#00594C', 'Pantone 335 C'], ['#154734', 'Pantone 3435 C'], ['#658D1B', 'Pantone 370 C'],
  ['#7A9A01', 'Pantone 377 C'], ['#A8AD00', 'Pantone 383 C'], ['#C4D600', 'Pantone 397 C'],
  ['#00B08B', 'Pantone 339 C'], ['#00A499', 'Pantone 326 C'], ['#007672', 'Pantone 322 C'],
  ['#007377', 'Pantone 315 C'], ['#00677F', 'Pantone 308 C'], ['#00838F', 'Pantone 3145 C'],
  ['#006269', 'Pantone 3165 C'], ['#008C95', 'Pantone 314 C'], ['#00A3E0', 'Pantone 299 C'],
  ['#41B6E6', 'Pantone 298 C'], ['#71C5E8', 'Pantone 297 C'], ['#0072CE', 'Pantone 285 C'],
  ['#0033A0', 'Pantone 286 C'], ['#003087', 'Pantone 287 C'], ['#002D72', 'Pantone 288 C'],
  ['#002B5C', 'Pantone 289 C'], ['#003057', 'Pantone 2955 C'], ['#003865', 'Pantone 540 C'],
  ['#003DA5', 'Pantone 541 C'], ['#005EB8', 'Pantone 300 C'], ['#004B87', 'Pantone 301 C'],
  ['#1D4F91', 'Pantone 7687 C'], ['#001489', 'Pantone Reflex Blue C'], ['#10069F', 'Pantone Blue 072 C'],
  ['#500778', 'Pantone 2735 C'], ['#440099', 'Pantone Violet C'], ['#5F259F', 'Pantone 267 C'],
  ['#582C83', 'Pantone 268 C'], ['#512D6D', 'Pantone 269 C'], ['#702F8A', 'Pantone 526 C'],
  ['#9B26B6', 'Pantone 254 C'], ['#CE0058', 'Pantone Rubine Red C'], ['#D0006F', 'Pantone 226 C'],
  ['#E10098', 'Pantone Rhodamine Red C'], ['#DA1884', 'Pantone 219 C'], ['#F04E98', 'Pantone 212 C'],
  ['#E31C79', 'Pantone 1915 C'], ['#F1B2DC', 'Pantone 516 C'],
  ['#4E3629', 'Pantone 476 C'], ['#623B2A', 'Pantone 477 C'], ['#72351C', 'Pantone 478 C'],
  ['#693F23', 'Pantone 469 C'], ['#5C4830', 'Pantone 462 C'], ['#6E4C1E', 'Pantone 463 C'],
  ['#653024', 'Pantone 483 C'], ['#9A3324', 'Pantone 484 C'], ['#56342B', 'Pantone 4695 C'],
  ['#7A5647', 'Pantone 4705 C'], ['#653819', 'Pantone 168 C'], ['#603D20', 'Pantone 161 C'],
  ['#E56A54', 'Pantone 7416 C'], ['#E04E39', 'Pantone 7417 C'], ['#E8927C', 'Pantone 486 C'],
  ['#FF8D6D', 'Pantone 163 C'], ['#A45248', 'Pantone 7522 C'], ['#C08A3E', 'Pantone 7510 C'],
  ['#B9975B', 'Pantone 465 C'], ['#C6AA76', 'Pantone 466 C'], ['#D3BC8D', 'Pantone 467 C'],
  ['#DDCBA4', 'Pantone 468 C'], ['#D3BF96', 'Pantone 7502 C'], ['#A79D96', 'Pantone 7503 C'],
  ['#D6D2C4', 'Pantone 7527 C'], ['#B7B09C', 'Pantone 7530 C'], ['#63513D', 'Pantone 7532 C'],
  ['#473729', 'Pantone 7533 C'], ['#B7A99A', 'Pantone 7535 C'], ['#A69F88', 'Pantone 7536 C'],
  ['#D9D9D6', 'Pantone Cool Gray 1 C'], ['#D0D0CE', 'Pantone Cool Gray 2 C'],
  ['#C8C9C7', 'Pantone Cool Gray 3 C'], ['#BBBCBC', 'Pantone Cool Gray 4 C'],
  ['#B1B3B3', 'Pantone Cool Gray 5 C'], ['#A7A8AA', 'Pantone Cool Gray 6 C'],
  ['#97999B', 'Pantone Cool Gray 7 C'], ['#888B8D', 'Pantone Cool Gray 8 C'],
  ['#75787B', 'Pantone Cool Gray 9 C'], ['#63666A', 'Pantone Cool Gray 10 C'],
  ['#53565A', 'Pantone Cool Gray 11 C'], ['#D7D2CB', 'Pantone Warm Gray 1 C'],
  ['#BFB8AF', 'Pantone Warm Gray 3 C'], ['#ACA39A', 'Pantone Warm Gray 5 C'],
  ['#968C83', 'Pantone Warm Gray 7 C'], ['#8C8279', 'Pantone Warm Gray 8 C'],
  ['#83786F', 'Pantone Warm Gray 9 C'], ['#796E65', 'Pantone Warm Gray 10 C'],
  ['#6E6259', 'Pantone Warm Gray 11 C'], ['#2D2926', 'Pantone Black C'],
  ['#212322', 'Pantone Black 3 C'], ['#31261D', 'Pantone Black 4 C'], ['#101820', 'Pantone Black 6 C'],
  ['#231F20', 'Pantone Process Black C'], ['#333F48', 'Pantone 432 C'], ['#1D252D', 'Pantone 433 C'],
  ['#425563', 'Pantone 7545 C'], ['#98A4AE', 'Pantone 7543 C'], ['#8DB9CA', 'Pantone 549 C'],
  ['#7BAFD4', 'Pantone 542 C'], ['#9BB8D3', 'Pantone 645 C'], ['#C6DAE7', 'Pantone 290 C'],
  ['#A4BCC2', 'Pantone 5445 C'], ['#7C9BA6', 'Pantone 5435 C'], ['#4F758B', 'Pantone 5405 C'],
  ['#5B7F95', 'Pantone 5415 C'], ['#2C5234', 'Pantone 5535 C'], ['#93B1A7', 'Pantone 5575 C'],
  ['#B5C9C3', 'Pantone 5595 C'], ['#A2AAAD', 'Pantone 429 C'],
  ['#F0F8FF', 'Alice Blue'], ['#FAEBD7', 'Antique White'], ['#00FFFF', 'Aqua'], ['#7FFFD4', 'Aquamarine'],
  ['#F0FFFF', 'Azure'], ['#F5F5DC', 'Beige'], ['#FFE4C4', 'Bisque'], ['#000000', 'Black'],
  ['#FFEBCD', 'Blanched Almond'], ['#0000FF', 'Blue'], ['#8A2BE2', 'Blue Violet'], ['#A52A2A', 'Brown'],
  ['#DEB887', 'Burlywood'], ['#5F9EA0', 'Cadet Blue'], ['#7FFF00', 'Chartreuse'], ['#D2691E', 'Chocolate'],
  ['#FF7F50', 'Coral'], ['#6495ED', 'Cornflower Blue'], ['#FFF8DC', 'Cornsilk'], ['#DC143C', 'Crimson'],
  ['#00008B', 'Dark Blue'], ['#008B8B', 'Dark Cyan'], ['#B8860B', 'Dark Goldenrod'], ['#A9A9A9', 'Dark Gray'],
  ['#006400', 'Dark Green'], ['#BDB76B', 'Dark Khaki'], ['#8B008B', 'Dark Magenta'],
  ['#556B2F', 'Dark Olive Green'], ['#FF8C00', 'Dark Orange'], ['#9932CC', 'Dark Orchid'],
  ['#8B0000', 'Dark Red'], ['#E9967A', 'Dark Salmon'], ['#8FBC8F', 'Dark Sea Green'],
  ['#483D8B', 'Dark Slate Blue'], ['#2F4F4F', 'Dark Slate Gray'], ['#00CED1', 'Dark Turquoise'],
  ['#9400D3', 'Dark Violet'], ['#FF1493', 'Deep Pink'], ['#00BFFF', 'Deep Sky Blue'], ['#696969', 'Dim Gray'],
  ['#1E90FF', 'Dodger Blue'], ['#B22222', 'Firebrick'], ['#FFFAF0', 'Floral White'],
  ['#228B22', 'Forest Green'], ['#DCDCDC', 'Gainsboro'], ['#FFD700', 'Gold'], ['#DAA520', 'Goldenrod'],
  ['#808080', 'Gray'], ['#008000', 'Green'], ['#ADFF2F', 'Green Yellow'], ['#F0FFF0', 'Honeydew'],
  ['#FF69B4', 'Hot Pink'], ['#CD5C5C', 'Indian Red'], ['#4B0082', 'Indigo'], ['#FFFFF0', 'Ivory'],
  ['#F0E68C', 'Khaki'], ['#E6E6FA', 'Lavender'], ['#FFF0F5', 'Lavender Blush'], ['#7CFC00', 'Lawn Green'],
  ['#FFFACD', 'Lemon Chiffon'], ['#ADD8E6', 'Light Blue'], ['#F08080', 'Light Coral'],
  ['#E0FFFF', 'Light Cyan'], ['#FAFAD2', 'Light Goldenrod Yellow'], ['#D3D3D3', 'Light Gray'],
  ['#90EE90', 'Light Green'], ['#FFB6C1', 'Light Pink'], ['#FFA07A', 'Light Salmon'],
  ['#20B2AA', 'Light Sea Green'], ['#87CEFA', 'Light Sky Blue'], ['#778899', 'Light Slate Gray'],
  ['#B0C4DE', 'Light Steel Blue'], ['#FFFFE0', 'Light Yellow'], ['#00FF00', 'Lime'],
  ['#32CD32', 'Lime Green'], ['#FAF0E6', 'Linen'], ['#FF00FF', 'Magenta'], ['#800000', 'Maroon'],
  ['#66CDAA', 'Medium Aquamarine'], ['#0000CD', 'Medium Blue'], ['#BA55D3', 'Medium Orchid'],
  ['#9370DB', 'Medium Purple'], ['#3CB371', 'Medium Sea Green'], ['#7B68EE', 'Medium Slate Blue'],
  ['#00FA9A', 'Medium Spring Green'], ['#48D1CC', 'Medium Turquoise'], ['#C71585', 'Medium Violet Red'],
  ['#191970', 'Midnight Blue'], ['#F5FFFA', 'Mint Cream'], ['#FFE4E1', 'Misty Rose'], ['#FFE4B5', 'Moccasin'],
  ['#FFDEAD', 'Navajo White'], ['#000080', 'Navy'], ['#FDF5E6', 'Old Lace'], ['#808000', 'Olive'],
  ['#6B8E23', 'Olive Drab'], ['#FFA500', 'Orange'], ['#FF4500', 'Orange Red'], ['#DA70D6', 'Orchid'],
  ['#EEE8AA', 'Pale Goldenrod'], ['#98FB98', 'Pale Green'], ['#AFEEEE', 'Pale Turquoise'],
  ['#DB7093', 'Pale Violet Red'], ['#FFEFD5', 'Papaya Whip'], ['#FFDAB9', 'Peach Puff'], ['#CD853F', 'Peru'],
  ['#FFC0CB', 'Pink'], ['#DDA0DD', 'Plum'], ['#B0E0E6', 'Powder Blue'], ['#800080', 'Purple'],
  ['#663399', 'Rebecca Purple'], ['#FF0000', 'Red'], ['#BC8F8F', 'Rosy Brown'], ['#4169E1', 'Royal Blue'],
  ['#8B4513', 'Saddle Brown'], ['#FA8072', 'Salmon'], ['#F4A460', 'Sandy Brown'], ['#2E8B57', 'Sea Green'],
  ['#FFF5EE', 'Seashell'], ['#A0522D', 'Sienna'], ['#C0C0C0', 'Silver'], ['#87CEEB', 'Sky Blue'],
  ['#6A5ACD', 'Slate Blue'], ['#708090', 'Slate Gray'], ['#FFFAFA', 'Snow'], ['#00FF7F', 'Spring Green'],
  ['#4682B4', 'Steel Blue'], ['#D2B48C', 'Tan'], ['#008080', 'Teal'], ['#D8BFD8', 'Thistle'],
  ['#FF6347', 'Tomato'], ['#40E0D0', 'Turquoise'], ['#EE82EE', 'Violet'], ['#F5DEB3', 'Wheat'],
  ['#FFFFFF', 'White'], ['#F5F5F5', 'White Smoke'], ['#FFFF00', 'Yellow'], ['#9ACD32', 'Yellow Green'],
];

const _named = new Map();

/** The nearest name, and whether it is exact. `≈` where it is not. */
export function colourName(hex) {
  const h = String(hex || '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(h)) return null;
  if (_named.has(h)) return _named.get(h);
  let best = null;
  for (const [ref, nm] of NAMES) {
    const d = deltaE(h, ref);
    if (!best || d < best.distance) best = { name: nm, hex: ref, distance: d };
  }
  const label = best.hex === h ? best.name : `≈ ${best.name}`;
  const out = { ...best, exact: best.hex === h, label, short: label.replace('Pantone ', 'PMS ') };
  _named.set(h, out);
  return out;
}

/* ---------------------------------------------------------- the series

 *
 * The nudge series and the maker's palette are one config. A nudge names its
 * series and its slot; a slot is filled by whichever of its nudges locked a
 * colour. That last part is what lets a slot be asked again: a nudge that
 * banks without locking leaves its slot empty, and the studio may put another
 * nudge on it rather than the palette ending at eleven.
 */
export const seriesOf = (store) => (store && store.series) || null;

/** Every colour locked so far, newest slot last, and the nudge that locked it. */
export function filledSlots(store, seriesId) {
  const id = seriesId || (seriesOf(store) || {}).id;
  const by = new Map();
  for (const n of (store && store.nudges) || []) {
    if (!id || n.series !== id) continue;
    const slot = Math.floor(Number(n.slot) || 0);
    if (slot < 1) continue;
    const locked = n.banked && n.banked.locked ? n.banked.locked : null;
    if (!locked) continue;
    const prev = by.get(slot);
    /* A slot asked twice keeps the lock that settled it. Two locks on one slot
       is not a thing that should happen, and if it does the later one is the
       one somebody meant. */
    if (!prev || String(n.banked.banked_at || '') > String(prev.banked_at || '')) {
      by.set(slot, {
        slot, hex: locked.hex, nudge: n.id, number: n.number,
        /* THE COLOUR'S OWN FIGURES, as the banked card counts them. A pottle
           labelled with the whole board's TAO beside a card saying the
           colour's is the same fact wearing two numbers, and a reader is
           right to trust neither. Older records that kept no per-colour
           figures fall back to the board. */
        tao: Math.round(Number(locked.total) || Number(n.banked.total) || 0),
        collectors: Number(locked.voters) || Number(n.banked.collectors) || 0,
        /* Who settled it, so the maker can say so beside the pottle. */
        locked_by: n.banked.locked_by || null,
        closed: n.closes || null,
        banked_at: n.banked.banked_at || null,
      });
    }
  }
  return [...by.values()].sort((a, b) => a.slot - b.slot);
}

/**
 * The whole arc, as a page draws it: twelve slots, the fixed red beside them,
 * what is locked, what is being asked now, and what the constraint on the next
 * one is.
 */
export function seriesState(store, { now = new Date(), openIds = null } = {}) {
  const s = seriesOf(store);
  if (!s) return null;
  const count = Math.max(1, Math.floor(Number(s.slots) || 12));
  const filled = filledSlots(store, s.id);
  const byS = new Map(filled.map((f) => [f.slot, f]));

  /* Which slot is being asked. A published nudge on this series that has not
     banked owns its slot while it runs. */
  const live = new Map();
  for (const n of (store && store.nudges) || []) {
    if (n.series !== s.id || n.published === false || n.banked) continue;
    if (openIds && !openIds.has(n.id)) continue;
    if (new Date(n.closes).getTime() <= now.getTime()) continue;
    const slot = Math.floor(Number(n.slot) || 0);
    if (slot >= 1 && slot <= count) live.set(slot, { nudge: n.id, number: n.number, closes: n.closes });
  }

  const slots = [];
  for (let i = 1; i <= count; i += 1) {
    const f = byS.get(i);
    const l = live.get(i);
    slots.push(f
      ? { slot: i, state: 'locked', ...f }
      : (l ? { slot: i, state: 'open', ...l } : { slot: i, state: 'empty' }));
  }

  const fixed = s.fixed || null;
  /* Everything a new colour has to stand clear of: the colours locked so far
     and the red line, which is on every one of these paintings whether the
     collectors chose it or not.
     
     The red is in the maths and nowhere else. It is the artist's constant
     rather than anything the collectors chose, so the studio never draws it
     beside their twelve and never names it in a refusal ... but a community
     colour that vanished against the one line every painting carries would be
     a real defect, so it still holds the floor. `fixed.counts: false` in the
     series config takes it out of the maths too. */
  const counts = !fixed || fixed.counts !== false;
  const clearance = [...filled.map((f) => f.hex), ...(counts && fixed && fixed.hex ? [fixed.hex] : [])];
  const rule = floorFor(clearance, {
    space: s.space, ladder: s.ladder, minShare: s.field_share,
  });

  return {
    id: s.id,
    title: s.title || null,
    note: s.note || null,
    slots: count,
    collection: s.collection || null,
    maker: s.maker || null,
    fixed,
    space: spaceOf(s.space),
    board: slots,
    locked: filled,
    /* The hexes the floor is measured from, which is not the list any page
       draws. Nothing renders this. */
    clearance,
    floor: rule.floor,
    field: rule.share,
    complete: filled.length >= count,
    /* What the finished palette is worth saying about itself: every nudge that
       filled a slot, everyone who weighed on one, and all the TAO behind them.
       Collectors are counted per nudge, because a nudge is where somebody
       weighed and the same collector turning up twelve times turned up twelve
       times. */
    totals: {
      nudges: filled.length,
      collectors: filled.reduce((a, f) => a + f.collectors, 0),
      tao: filled.reduce((a, f) => a + f.tao, 0),
    },
  };
}

/** The constraint one nudge is under: what it must stand clear of, and by how
 *  much. Slot 1 opened the palette with nothing to be different from, so it
 *  carries none of this. */
export function constraintFor(store, nudge, state = null) {
  const s = seriesOf(store);
  if (!s || !nudge || nudge.series !== s.id) return null;
  const slot = Math.floor(Number(nudge.slot) || 0);
  if (slot <= 1) return null;
  const st = state || seriesState(store);
  if (!st) return null;
  /* What was locked before this slot, not everything locked ... a nudge asked
     again after a later one banked is still answering its own question. */
  const before = st.locked.filter((f) => f.slot < slot);
  const counts = !st.fixed || st.fixed.counts !== false;
  const fixed = counts && st.fixed && st.fixed.hex ? [String(st.fixed.hex).toUpperCase()] : [];
  const community = before.map((f) => f.hex);
  const rule = floorFor([...community, ...fixed], {
    space: s.space, ladder: s.ladder, minShare: s.field_share,
  });
  return {
    slot,
    slots: st.slots,
    floor: rule.floor,
    field: rule.share,
    space: st.space,
    /* Drawn beside every candidate, so a voter weighs the pair rather than the
       colour on its own. The community's colours, and only those: the red line
       is the artist's constant and not part of this conversation. */
    against: before.map((f) => ({
      hex: f.hex, slot: f.slot, number: f.number, nudge: f.nudge, label: `Nudge #${f.number}`,
    })),
    /* What the floor is measured from, which includes the red. The picker runs
       the same arithmetic as the route off this, so it can refuse a colour the
       route would refuse without ever saying what it clashed with. */
    clearance: [...community, ...fixed],
  };
}

/** Where a colour sits in the series, said on a banked card: COLOUR 1 OF 12. */
export const slotLine = (nudge, slots) =>
  (nudge && Number(nudge.slot) >= 1 && slots ? `Colour ${Number(nudge.slot)} of ${slots}` : null);

/**
 * What a painting made from the finished palette carries, forever.
 *
 * One nudge chose one colour and says so; twelve nudges chose the palette, and
 * a line naming one of them would be naming a twelfth of the truth. So the
 * compound line counts the whole arc, and the per-slot record stays reachable
 * from it ... which is the part that makes it provenance rather than a boast.
 */
export function seriesProvenanceLine(state) {
  if (!state) return null;
  const t = state.totals || { nudges: 0, collectors: 0, tao: 0 };
  const nz = (v) => Math.round(Number(v) || 0).toLocaleString('en-NZ');
  return `Palette by ${t.nudges} nudge${t.nudges === 1 ? '' : 's'} · `
    + `${nz(t.collectors)} collector${t.collectors === 1 ? '' : 's'} · ${nz(t.tao)} TAO`;
}
