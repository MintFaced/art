/* A Strip Painting laid out from a palette, on the server (strip-rhythm-spec).
 *
 * Every Strip Painting follows one fixed rhythm; the colours are the inputs.
 * The Maker, the home page's commission block and every commission order are
 * laid here, and the pages receive the strips as data (a colour and a height
 * in millimetres each, bottom first), never the rule that laid them.
 *
 * Nothing here is random: the same colours, measure, vibrancy and count give
 * the same painting every time, which is what lets an order say "paint the one
 * I saw" with nothing but those.
 */

export const RED_LINE = '#D32011';
const RED_H = 12;
const RED_AT = 15; // the 16th strip from the bottom
const GRID = [6, 12, 24];
export const STRIPS = 55;
export const GAMMA = { calm: 1.0, punchy: 1.6 };

const snap6 = (mm) => Math.max(6, Math.round(Number(mm) / 6) * 6);

/** The measure a painting is laid across, on the 6 mm grid, and the strip
    count it can hold with the red line 16th from the bottom. */
export function fitOf(acrossMM, count = STRIPS) {
  const minH = RED_H + RED_AT * 6 + 0; // sixteen strips, the red the 16th
  const H = Math.max(snap6(acrossMM), minH % 6 ? minH + (6 - (minH % 6)) : minH);
  const lo = Math.max(RED_AT + 1, Math.ceil((H - RED_H) / 24) + 1);
  const hi = Math.floor((H - RED_H) / 6) + 1;
  const N = Math.min(hi, Math.max(lo, Math.round(Number(count) || STRIPS)));
  return { height: H, count: N, min: lo, max: hi };
}

/** The colours in order of how much of the street each covers, with shares. */
function ranked(colours) {
  const k = colours.length;
  const given = colours.every((c) => Number(c.w) > 0);
  const list = colours.map((c, i) => ({ hex: String(c.hex).toUpperCase(), w: given ? Number(c.w) : (k - i), i }));
  list.sort((a, b) => b.w - a.w || a.i - b.i);
  const total = list.reduce((s, c) => s + c.w, 0) || 1;
  return list.map((c) => ({ hex: c.hex, share: c.w / total }));
}

/**
 * The full layout: { strips:[{hex, mm}], height, count }, bottom first.
 * `gamma` is the vibrancy, 1.0 calm to 1.6 punchy.
 */
export function layout(colours, acrossMM, { gamma = GAMMA.calm, count = STRIPS } = {}) {
  const seq = ranked(colours);
  const g = Math.min(GAMMA.punchy, Math.max(GAMMA.calm, Number(gamma) || GAMMA.calm));
  const { height: H, count: N } = fitOf(acrossMM, count);

  /* the order: the sequence, then the sequence back again, over and over */
  const run = [...seq, ...seq.slice().reverse()];
  const stack = Array.from({ length: N }, (_, i) => run[i % run.length]);

  /* the heights: share to the power of the vibrancy, scaled to the measure
     the coloured strips have, each snapped to the nearest of 6, 12, 24 */
  const idx = stack.map((_, i) => i).filter((i) => i !== RED_AT);
  const raw = new Map(idx.map((i) => [i, stack[i].share ** g]));
  const sumRaw = [...raw.values()].reduce((s, v) => s + v, 0) || 1;
  const room = H - RED_H;
  const want = new Map(idx.map((i) => [i, (raw.get(i) / sumRaw) * room]));
  const nearest = (v) => GRID.reduce((best, s) => (Math.abs(v - s) < Math.abs(v - best) ? s : best), GRID[0]);
  const h = new Map(idx.map((i) => [i, nearest(want.get(i))]));

  /* balance: one step at a time, up or down the grid, on the strip that the
     step moves least from what it wanted, until the sum is exact */
  const up = { 6: 12, 12: 24 };
  const down = { 24: 12, 12: 6 };
  const cost = (i, to) => Math.abs(want.get(i) - to) - Math.abs(want.get(i) - h.get(i));
  for (let guard = 0; guard < 4 * N; guard += 1) {
    const sum = [...h.values()].reduce((s, v) => s + v, 0);
    const diff = room - sum;
    if (diff === 0) break;
    const moves = [];
    for (const i of idx) {
      const from = h.get(i);
      const to = diff > 0 ? up[from] : down[from];
      if (!to) continue;
      const step = Math.abs(to - from);
      moves.push({ i, to, fits: step <= Math.abs(diff), c: cost(i, to) });
    }
    if (!moves.length) break;
    const pool = moves.some((m) => m.fits) ? moves.filter((m) => m.fits) : moves;
    pool.sort((a, b) => a.c - b.c || a.i - b.i);
    h.set(pool[0].i, pool[0].to);
  }

  const strips = stack.map((c, i) => (i === RED_AT ? { hex: RED_LINE, mm: RED_H } : { hex: c.hex, mm: h.get(i) }));
  return { strips, height: H, count: N };
}

/** The strips alone, bottom first, as the pages and orders take them. */
export const layStrips = (colours, acrossMM, opts) => layout(colours, acrossMM, opts).strips;
