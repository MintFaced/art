/* Strips read off a design image (COMMISSION-CUSTOM), for the studio's custom
 * commission form and its test. The image is read where it is opened and goes
 * nowhere: what comes out is a list of {hex, mm}, first to last across the
 * width, the way stripPNG lays them (a landscape painting from the bottom up).
 *
 *   bandsOf({ data, width, height }, { widthMm, orientation })
 *     data is RGBA, as a canvas's getImageData or sharp's raw output gives it.
 *     orientation is the image's own: landscape stacks the strips top to
 *     bottom on the screen, portrait left to right. It defaults to the shape.
 */

const SHORT = 3;      // runs thinner than this, in pixels, are edges left by compression, not strips
const TOL = [6, 12];  // how far apart two colours must be to be two strips: 6 for a clean image, up to 12 for a rough JPEG
const EDGE_GAP = 2;   // an edge is the biggest change within this many rows of it
const MATCH = 12;     // how close a row must be to the strip laid back over it
const LINES = 9;      // lines read along the strips, the median taken across them

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const near = (p, q, d) => Math.abs(p[0] - q[0]) <= d && Math.abs(p[1] - q[1]) <= d && Math.abs(p[2] - q[2]) <= d;
const apart = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
const colourOf = (rows) => [0, 1, 2].map((c) => median(rows.map((r) => r[c])));
const hexOf = (p) => `#${p.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** One colour per pixel across the strips: the median of LINES lines along them.
    `noise` is how much the lines disagree (90th percentile, worst channel): a
    row is one colour by design, so whatever varies along it is compression. */
export function profileOf({ data, width, height }, landscape) {
  const across = landscape ? height : width;
  const along = landscape ? width : height;
  const lines = Array.from({ length: Math.min(LINES, along) }, (_, i) => Math.min(along - 1, Math.floor(((i + 0.5) / Math.min(LINES, along)) * along)));
  const out = new Array(across);
  const spread = new Array(across);
  for (let a = 0; a < across; a += 1) {
    const px = lines.map((l) => {
      const i = ((landscape ? a : l) * width + (landscape ? l : a)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    });
    out[a] = colourOf(px);
    spread[a] = Math.max(...[0, 1, 2].map((c) => Math.max(...px.map((p) => p[c])) - Math.min(...px.map((p) => p[c]))));
  }
  spread.sort((x, y) => x - y);
  out.noise = spread[Math.floor(across * 0.9)] || 0;
  return out;
}

export function bandsOf(img, { widthMm, orientation } = {}) {
  const landscape = (orientation || (img.width >= img.height ? 'landscape' : 'portrait')) === 'landscape';
  const profile = profileOf(img, landscape);
  const across = profile.length;
  const tol = Math.min(TOL[1], Math.max(TOL[0], 2 * profile.noise + 4));

  /* Edges first. JPEG smears colour for a few rows either side of an edge, so
     a run that starts on a smeared row reads as a thin strip of its own. The
     edge itself is where the colour changes most: a peak in the change from
     row to row (summed over R, G and B, at least tol), the biggest within
     EDGE_GAP rows of it. */
  const step = (i) => apart(profile[i], profile[i + 1]);
  const cuts = [];
  for (let i = 0; i < across - 1; i += 1) {
    const d = step(i);
    if (d < tol) continue;
    let peak = true;
    for (let j = Math.max(0, i - EDGE_GAP); j <= Math.min(across - 2, i + EDGE_GAP) && peak; j += 1) {
      if (j !== i && (step(j) > d || (step(j) === d && j < i))) peak = false;
    }
    if (peak) cuts.push(i + 1);
  }
  /* runs between the edges, top to bottom (or left to right) on the screen;
     each one's colour from its middle rows, clear of the smear */
  let runs = [];
  let from = 0;
  for (const c of [...cuts, across]) { runs.push({ rows: profile.slice(from, c) }); from = c; }
  const settle = (r) => {
    const n = r.rows.length;
    const trim = n >= 8 ? 2 : n >= 4 ? 1 : 0;
    r.colour = colourOf(r.rows.slice(trim, n - trim));
  };
  runs.forEach(settle);
  /* neighbours within tol of each other on every channel are one strip */
  const join = () => {
    runs = runs.reduce((out, r) => {
      const last = out[out.length - 1];
      if (last && near(last.colour, r.colour, tol)) { last.rows.push(...r.rows); settle(last); } else out.push(r);
      return out;
    }, []);
  };
  join();
  /* runs thinner than SHORT are edges, not strips: each folds into whichever
     neighbour is closer in colour */
  for (;;) {
    let at = -1;
    runs.forEach((r, i) => { if (runs.length > 1 && r.rows.length < SHORT && (at < 0 || r.rows.length < runs[at].rows.length)) at = i; });
    if (at < 0) break;
    const r = runs[at];
    const before = runs[at - 1];
    const after = runs[at + 1];
    const into = !before ? after : !after ? before : (apart(r.colour, before.colour) <= apart(r.colour, after.colour) ? before : after);
    if (into === before) into.rows.push(...r.rows); else into.rows.unshift(...r.rows);
    settle(into);
    runs.splice(at, 1);
  }
  join();

  /* each strip's mm, rounded at its edges so the roundings never add up; one
     thinner than a mm when rounded is dropped */
  const pxPerMm = across / widthMm;
  let at = 0;
  const strips = runs.map((r) => {
    const start = Math.round(at / pxPerMm);
    at += r.rows.length;
    return { hex: hexOf(r.colour), mm: Math.round(at / pxPerMm) - start };
  }).filter((x) => x.mm > 0);
  const total = strips.reduce((n, s) => n + s.mm, 0);
  if (strips.length && total !== widthMm) {
    const big = strips.reduce((b, s) => (s.mm > b.mm ? s : b), strips[0]);
    big.mm += widthMm - total;
  }
  if (landscape) strips.reverse(); // first to last across the width: a landscape painting is laid from the bottom up
  return { strips, match: matchOf(profile, strips, landscape), pxPerMm, tol };
}

/** The fraction of rows within MATCH of the strip laid back over them, as
    stripPNG lays it. A row within EDGE_GAP of an edge may be a blend of the two
    strips there (JPEG smears colour across an edge): it matches if each channel
    lies between the two, give or take MATCH. */
export function matchOf(profile, strips, landscape) {
  const across = profile.length;
  const total = strips.reduce((n, s) => n + s.mm, 0) || 1;
  const laid = new Array(across);
  let mm = 0;
  strips.forEach((s, k) => {
    const a = Math.round((mm / total) * across);
    const b = Math.round(((mm + s.mm) / total) * across);
    for (let i = a; i < b; i += 1) laid[landscape ? across - 1 - i : i] = k;
    mm += s.mm;
  });
  const rgb = strips.map((s) => rgbOf(s.hex));
  const between = (p, a, b) => p.every((v, c) => v >= Math.min(a[c], b[c]) - MATCH && v <= Math.max(a[c], b[c]) + MATCH);
  let ok = 0;
  for (let i = 0; i < across; i += 1) {
    if (laid[i] == null) continue;
    if (near(profile[i], rgb[laid[i]], MATCH)) { ok += 1; continue; }
    for (let j = Math.max(0, i - EDGE_GAP); j <= Math.min(across - 1, i + EDGE_GAP); j += 1) {
      if (laid[j] != null && laid[j] !== laid[i] && between(profile[i], rgb[laid[i]], rgb[laid[j]])) { ok += 1; break; }
    }
  }
  return ok / across;
}
