/* A Strip Painting laid out from a palette, on the server.
 *
 * The same drawing the Maker makes, ported unchanged in what it does: the
 * home page's commission block asks for a painting and receives its strips as
 * data (a colour and a width in millimetres each), never the rule that laid
 * them. Full intensity, the one standing sequence, so a palette and a width
 * always give the same painting, which is what lets an order say "paint the
 * one I saw" with nothing but those two facts.
 *
 * `acrossMM` is the measure the strips are stacked over: the painting's
 * width. They run its length, so the length changes nothing here.
 */

export const RED_LINE = '#D32011';
const RED_LINE_H = 12;
const RED_LINE_NOMINAL = 16;
const RED_LINE_MIN_STRIPS = 48;
const SIZES = [24, 12, 6];
const SEED = 1;
const VIB = 0.7;

// the reference palette (Strip Painting No. 1), which places the red line
const REFERENCE = [
  { hex: '#e16448', w: 120 }, { hex: '#82b2ce', w: 60 }, { hex: '#5fb25b', w: 60 },
  { hex: '#d5c089', w: 60 }, { hex: '#4c4040', w: 60 }, { hex: '#b4bbae', w: 36 },
  { hex: '#6d392e', w: 30 }, { hex: '#2f1f1d', w: 24 }, { hex: '#b87556', w: 24 },
  { hex: '#2a6529', w: 24 }, { hex: '#878082', w: 24 }, { hex: '#edbfb7', w: 18 },
];

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const lum = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

function pickColour(palette, prevHex, rand, vib) {
  if (prevHex && vib < 0.45 && rand() < 0.12) {
    const same = palette.find((p) => p.hex === prevHex);
    if (same) return same;
  }
  const pool = palette.filter((p) => p.hex !== prevHex);
  const list = pool.length ? pool : palette;
  if (!prevHex) {
    const total = list.reduce((s, p) => s + p.w, 0);
    let r = rand() * total;
    for (const p of list) { r -= p.w; if (r <= 0) return p; }
    return list[list.length - 1];
  }
  const prev = hexToRgb(prevHex);
  const scored = list.map((p) => {
    const rgb = hexToRgb(p.hex);
    const d = Math.sqrt(dist2(prev, rgb)) / 441.7;
    const dl = Math.abs(lum(prev) - lum(rgb)) / 255;
    const contrast = 0.5 * d + 0.5 * dl;
    return { p, score: p.w * (0.1 + (1 - vib) * 0.6 + vib * 4 * Math.pow(contrast, 2)) };
  });
  const total = scored.reduce((s, x) => s + x.score, 0);
  let r = rand() * total;
  for (const x of scored) { r -= x.score; if (r <= 0) return x.p; }
  return scored[scored.length - 1].p;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const streamFor = (seed, idx, salt) =>
  mulberry32((Math.imul(seed, 0x9e3779b1) ^ Math.imul(idx + 1, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0);

function lay(palette, acrossMM, redIndex) {
  const maxW = Math.max(...palette.map((p) => p.w));
  const minSize = Math.min(...SIZES);
  const strips = [];
  let sum = 0;
  while (sum < acrossMM - 0.01) {
    const idx = strips.length;
    if (idx === redIndex && acrossMM - sum >= RED_LINE_H) {
      strips.push({ hex: RED_LINE, mm: RED_LINE_H });
      sum += RED_LINE_H;
      continue;
    }
    const prev = strips.length ? strips[strips.length - 1].hex : null;
    const c = pickColour(palette, prev, streamFor(SEED, idx, 1), VIB);
    const dominance = c.w / maxW;
    const roll = streamFor(SEED, idx, 2)();
    let h = dominance > 0.6 ? (roll < 0.5 ? SIZES[0] : SIZES[1]) : roll < 0.07 ? SIZES[0] : roll < 0.30 ? SIZES[1] : SIZES[2];
    const remaining = acrossMM - sum;
    if (h > remaining) h = remaining >= minSize ? minSize : remaining;
    if (remaining - h > 0 && remaining - h < minSize) h = remaining;
    strips.push({ hex: c.hex, mm: h });
    sum += h;
  }
  return strips;
}

function redIndexFor(acrossMM) {
  const est = lay(REFERENCE, acrossMM, -1).length;
  if (est >= RED_LINE_MIN_STRIPS) return RED_LINE_NOMINAL - 1;
  const third = Math.max(1, Math.round(est / 3));
  return Math.min(est - 1, third - 1);
}

/** The strips, first to last, for a palette of {hex, w} across `acrossMM`. */
export function layStrips(colours, acrossMM) {
  const palette = colours.map((c) => ({ hex: String(c.hex).toUpperCase(), w: Number(c.w) > 0 ? Number(c.w) : 1 }));
  return lay(palette, acrossMM, redIndexFor(acrossMM));
}
