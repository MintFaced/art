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
export function checkCandidate(raw, { against = [], floor = 0, space = SPACE } = {}) {
  const colour = checkHex(raw);
  if (colour.error) return colour;
  const hex = colour.hex;
  const place = inSpace(hex, space);
  if (!place.ok) {
    return { error: `${hex} is ${place.why}. The palette is sampled from the street, so it stays in that range.`, hex };
  }
  const near = nearest(hex, against);
  if (near && near.distance < floor) {
    return {
      error: `${hex} is ${near.distance.toFixed(2)} from ${near.hex}, and a colour here has to stand `
        + `${floor.toFixed(2)} clear of everything already locked. Pick something further from ${near.hex}.`,
      hex, nearest: near.hex, distance: near.distance, floor,
    };
  }
  return { hex, nearest: near ? near.hex : null, distance: near ? near.distance : null, floor };
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
        tao: Math.round(Number(n.banked.total) || 0),
        collectors: Number(n.banked.collectors) || 0,
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
     collectors chose it or not. */
  const against = [...filled.map((f) => f.hex), ...(fixed && fixed.hex ? [fixed.hex] : [])];
  const rule = floorFor(against, {
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
    against,
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
  const fixed = st.fixed && st.fixed.hex ? [st.fixed.hex] : [];
  const against = [...before.map((f) => f.hex), ...fixed];
  const rule = floorFor(against, { space: s.space, ladder: s.ladder, minShare: s.field_share });
  return {
    slot,
    slots: st.slots,
    floor: rule.floor,
    field: rule.share,
    space: st.space,
    fixed: st.fixed,
    /* Drawn beside every candidate, so a voter weighs the pair rather than the
       colour on its own. */
    against: [
      ...before.map((f) => ({ hex: f.hex, slot: f.slot, number: f.number, nudge: f.nudge, label: `Nudge #${f.number}` })),
      ...(st.fixed && st.fixed.hex
        ? [{ hex: String(st.fixed.hex).toUpperCase(), slot: null, number: null, nudge: null,
          label: st.fixed.label || 'Red line', fixed: true }]
        : []),
    ],
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
