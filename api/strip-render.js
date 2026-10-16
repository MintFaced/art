/* /api/strip-render: a Strip Painting for the home page's commission block,
 * as data. One colour and one width in millimetres per strip, first to last,
 * across the painting's width; the page draws them and turns them for portrait.
 *
 * GET  ?width=60                  a palette at random, a different one each visit
 *      ?width=60&not=site-1,site-4   ... other than the ones this visitor just saw
 *      ?width=90&palette=site-6     that palette again, at another width
 * POST {width, colours:[{hex,w}]}  the visitor's own, sampled from a photograph
 *
 * The palettes are the site designs' (data/strip-palettes.json) and the
 * collectors' twelve so far, read live from the nudges: every colour locked,
 * then the colour leading the open nudge. A palette id and a width always give
 * the same painting, so an order needs only those two to paint what was shown.
 */
import palettesFile from '../data/strip-palettes.json' with { type: 'json' };
import { layStrips } from './_lib/strip-render.js';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';

const WIDTHS = { min: 10, max: 120, step: 10, standard: 60 };
const HEX = /^#[0-9a-f]{6}$/i;

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'access-control-allow-origin': '*' },
});

function widthOf(v) {
  const n = Math.round(Number(v ?? WIDTHS.standard) / WIDTHS.step) * WIDTHS.step;
  return Number.isFinite(n) && n >= WIDTHS.min && n <= WIDTHS.max ? n : null;
}

/* The collectors' palette, or null when the studio cannot be read or has
   fewer than four colours to give: a painting needs four at the least. Held
   for a minute: the studio takes a second to answer and a nudge moves slower
   than that. */
let held = { at: 0, palette: null };
async function collectors(origin) {
  if (Date.now() - held.at < 60_000) return held.palette;
  held = { at: Date.now(), palette: await readCollectors(origin) };
  return held.palette;
}
async function readCollectors(origin) {
  try {
    const r = await fetch(`${origin}/api/nudge`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const j = await r.json();
    const s = j && j.series;
    if (!s) return null;
    const hexes = (s.locked || []).map((x) => String(x.hex).toUpperCase());
    const open = (j.nudges || []).find((n) => n.open && n.series === s.id && n.leader && n.leader.hex);
    if (open) hexes.push(String(open.leader.hex).toUpperCase());
    const colours = [...new Set(hexes.filter((h) => HEX.test(h)))].map((hex) => ({ hex, w: 10 }));
    return colours.length >= 4 ? { id: 'collectors', colours } : null;
  } catch {
    return null;
  }
}

const painted = (palette, width) => ({
  palette: { id: palette.id, colours: palette.colours.map((c) => c.hex) },
  width_cm: width,
  strips: layStrips(palette.colours, width * 10),
});

export async function GET(request) {
  const url = new URL(request.url);
  const width = widthOf(url.searchParams.get('width'));
  if (!width) return json({ error: `width is ${WIDTHS.min} to ${WIDTHS.max} cm in steps of ${WIDTHS.step}` }, 400, 'no-store');
  const origin = useRequestOrigin(request) || siteOrigin();
  const sites = palettesFile.palettes;
  const want = url.searchParams.get('palette');

  if (want) {
    const p = want === 'collectors' ? await collectors(origin) : sites.find((x) => x.id === want);
    if (!p) return json({ error: 'no such palette' }, 404, 'no-store');
    /* a site's palette never changes between renders; the collectors' moves
       when a nudge does */
    return json(painted(p, width), 200, want === 'collectors' ? 'public, max-age=60, s-maxage=300' : 'public, max-age=3600, s-maxage=86400');
  }

  /* Chosen before anything is fetched, so the studio is asked only on the
     visits that land on the collectors' palette, and a studio that cannot
     answer hands the visit to a site's palette instead. */
  const not = new Set((url.searchParams.get('not') || '').split(',').filter(Boolean));
  const ids = [...sites.map((p) => p.id), 'collectors'];
  const fresh = ids.filter((id) => !not.has(id));
  const from = fresh.length ? fresh : ids;
  const id = from[Math.floor(Math.random() * from.length)];
  let palette = id === 'collectors' ? await collectors(origin) : sites.find((p) => p.id === id);
  if (!palette) {
    const rest = sites.filter((p) => !not.has(p.id));
    palette = (rest.length ? rest : sites)[Math.floor(Math.random() * (rest.length || sites.length))];
  }
  return json(painted(palette, width), 200, 'no-store');
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, 'no-store'); }
  const width = widthOf(body && body.width);
  if (!width) return json({ error: `width is ${WIDTHS.min} to ${WIDTHS.max} cm in steps of ${WIDTHS.step}` }, 400, 'no-store');
  const colours = Array.isArray(body.colours) ? body.colours
    .filter((c) => c && HEX.test(String(c.hex)))
    .map((c) => ({ hex: String(c.hex).toUpperCase(), w: Math.min(1000, Math.max(1, Number(c.w) || 1)) }))
    .slice(0, 12) : [];
  if (new Set(colours.map((c) => c.hex)).size < 4) return json({ error: 'four colours at the least' }, 400, 'no-store');
  return json(painted({ id: 'photo', colours }, width), 200, 'no-store');
}
