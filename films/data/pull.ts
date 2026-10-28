/* The films' data, pulled once per build and date-stamped (FILMS.md).
 *
 *   node data/pull.ts
 *
 * Everything on screen is real, so everything on screen comes from here: the
 * locked palette, the board the weigh-ins replay from, the top hundred
 * collectors with their faces and what each has held longest, the collector
 * fronting film 2 and the works behind their TAO, and the street the //Strips
 * film opens on. Pictures are copied into public/snap from our own R2 (faces,
 * works through the site's own resizer, street photographs), never hotlinked.
 *
 * Writes data/snapshot.json and data/credits.json. Chat posts are not pulled
 * here: the film shows the ones on screen in the capture, so capture.ts reads
 * them and adds them to the credits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SITE = 'https://mintface.art';
const ASSETS = 'https://assets.mintface.art';
const ROOT = path.resolve(import.meta.dirname, '..');
const SNAP = path.join(ROOT, 'public', 'snap');
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'script.json'), 'utf8'));
const { loadRegister } = await import(path.join(ROOT, '..', 'api', '_lib', 'register.js'));

const now = new Date();
const lower = (a: string) => String(a || '').toLowerCase();
const json = async (p: string) => {
  const r = await fetch(p.startsWith('http') ? p : `${SITE}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

fs.mkdirSync(SNAP, { recursive: true });
/* The site's own fonts and mark, copied beside the pictures. */
for (const [from, to] of [['fonts/Geist-Variable.woff2', 'fonts'], ['fonts/GeistMono-Variable.woff2', 'fonts'], ['assets/MintFace-Logo-Black.png', 'brand']]) {
  fs.mkdirSync(path.join(ROOT, 'public', to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '..', from), path.join(ROOT, 'public', to, path.basename(from)));
}
const got = new Map<string, string | null>();
/** Copy one picture into public/snap and answer its path there (or null). */
async function keep(url: string | null, name: string): Promise<string | null> {
  if (!url) return null;
  if (got.has(url)) return got.get(url)!;
  const ext = (/\.(webp|jpe?g|png|gif)(?:$|\?|&)/i.exec(url) || [, 'webp'])[1].toLowerCase().replace('jpeg', 'jpg');
  const file = `${name}.${url.includes('images.weserv.nl') ? 'webp' : ext}`;
  const dest = path.join(SNAP, file);
  if (!fs.existsSync(dest)) {
    const r = await fetch(url);
    if (!r.ok) { console.warn(`  could not copy ${url}: ${r.status}`); got.set(url, null); return null; }
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
  got.set(url, `snap/${file}`);
  return `snap/${file}`;
}
/* The site's own resizer, as the grids use it: first frame of an animation. */
const resized = (assetPath: string, w: number) => {
  const url = /^[a-z]+:/i.test(assetPath) ? assetPath : `${ASSETS}/${assetPath}`;
  return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&w=${w}&output=webp&q=85`;
};
const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
/* Pool the downloads so a hundred faces do not open a hundred sockets. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

console.log(`pulling from ${SITE} at ${now.toISOString()}`);
const [nudgeApi, nudgesFile, weighings, collectorsFile, heldFile, pfpAll, tao, sitesApi, index, palettesFile, stripHome] = await Promise.all([
  json('api/nudge'), json(`data/nudges.json?t=${Date.now()}`), json('data/nudge-weighings.json'), json('data/collectors.json'), json('data/collectors-held.json'),
  json('api/pfp?all=1'), json('data/tao.json'), json('api/strip-sites'), json('data/index.json'),
  json('data/strip-palettes.json'), fetch(`${SITE}/strip-home.js`).then((r) => r.text()),
]);
const reg = await loadRegister(async (_o: string, p: string) => json(p), SITE, null);
const nameOf = (a: string) => { const w = reg.who(a); return w && !w.private ? w.name : null; };

/* ---------------------------------------------------------------- faces */
const alias = pfpAll.alias || {};
const faceUrl = (a: string, small: boolean) => {
  const who = alias[lower(a)] || lower(a);
  const h = pfpAll.map[who];
  return h ? `${pfpAll.base}/${who}/${h}${small ? `-${pfpAll.small}` : ''}.webp` : null;
};
const face = (a: string, small = true) => keep(faceUrl(a, small), `pfp-${lower(a).slice(2, 12)}${small ? '-s' : ''}`);

/* ---------------------------------------------------------------- palette */
const recordOf = new Map((nudgesFile.nudges || []).map((n: any) => [n.id, n]));
const arc = nudgeApi.series;
const palette = (arc.locked || []).map((v: any) => {
  const b = (recordOf.get(v.nudge) as any)?.banked || {};
  return {
    slot: v.slot, hex: String(v.hex).toUpperCase(), nudge: v.nudge, number: v.number,
    locked_at: b.locked_at || b.banked_at || v.closed, backers: v.collectors, tao: v.tao, locked_by: v.locked_by || null,
  };
});
const open = (nudgeApi.nudges || []).find((n: any) => n.open) || null;

/* ------------------------------------------------------------- the board */
const bn = (nudgeApi.nudges || []).find((n: any) => n.id === script.board_nudge);
if (!bn) throw new Error(`no nudge ${script.board_nudge}`);
const board = {
  id: bn.id, number: bn.number, question: bn.question, closes: bn.closes, slot: bn.slot,
  rule: bn.rule, total: bn.total, collectors: bn.collectors, line: bn.line, locked: bn.locked, locked_by: bn.locked_by,
  candidates: await Promise.all((bn.candidates || []).map(async (c: any) => ({
    hex: c.hex, total: c.total, voters: c.voters,
    wallets: await Promise.all((c.wallets || []).map(async (w: any) => ({
      address: lower(w.address), name: w.name, weight: w.weight, artist: Boolean(w.artist),
      face: await face(w.address, false),
    }))),
  }))),
  /* The ledger as it happened, oldest first: the replay's order. Each row's
     figure is the one its wallet signed for (data/nudge-weighings.json), and
     the artist's rows are marked, as the card marks them: in the room, not in
     the count. */
  ledger: [...(bn.ledger || [])].reverse().map((r: any) => {
    const signed = (weighings.weighings || []).find((w: any) => w.nudge === bn.id && lower(w.address) === lower(r.address)
      && String(w.candidate).toUpperCase() === String(r.candidate).toUpperCase() && w.at === r.at);
    const artist = (bn.candidates || []).some((c: any) => (c.wallets || []).some((w: any) => lower(w.address) === lower(r.address) && w.artist));
    return { address: lower(r.address), name: r.name, candidate: r.candidate, amount: signed ? signed.amount : null, at: r.at, artist };
  }),
};

/* -------------------------------------------------------- the register */
const ranked = (collectorsFile.collectors || []).filter((c: any) => c.tao_rank && !c.private)
  .sort((a: any, b: any) => a.tao_rank - b.tao_rank).slice(0, 100);
const day = 86400000;
const heldOf = async (a: string, w: number) => {
  const h = heldFile.held[lower(a)];
  if (!h) return null;
  const [id, label, image, since] = h;
  return { id, label, since, days: since ? Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / day)) : null,
    image: image ? await keep(resized(image, w), `held-${slug(id)}-${w}`) : null };
};
const top = await pool(ranked, 8, async (c: any) => ({
  rank: c.tao_rank, address: lower(c.address), name: nameOf(c.address) || c.ens || `${c.address.slice(0, 6)}…${c.address.slice(-4)}`,
  tao: c.tao, rate: c.tao_rate, works: c.counts.works, one_of_ones: c.counts.one_of_ones, editions: c.counts.editions,
  face: await face(c.address, c.tao_rank > script.featured_count),
  held: await heldOf(c.address, c.tao_rank <= script.featured_count ? 900 : 240),
}));

/* --------------------------------------------------- film 2's collector */
const frontRow = top.find((c) => c.name === script.front_collector)
  || ranked.map((c: any) => ({ address: lower(c.address), name: nameOf(c.address) })).find((c: any) => c.name === script.front_collector);
if (!frontRow) throw new Error(`no collector ${script.front_collector} in the top hundred`);
const fw = tao.wallets[frontRow.address];
const catalogue = new Map<string, any>();
const workOf = async (id: string) => {
  const s = index.work_index[id];
  if (!s) return null;
  if (!catalogue.has(s)) catalogue.set(s, await json(`data/c/${s}.json`));
  const col = catalogue.get(s);
  return (col.works || []).find((w: any) => w.id === id)
    || (col.children || []).flatMap((c: any) => c.works || []).find((w: any) => w.id === id) || null;
};
const frontWorks = [];
for (const [id, t] of Object.entries(fw.works).sort((a: any, b: any) => b[1] - a[1])) {
  const w = await workOf(id);
  if (!w) continue;
  const unique = w.edition && w.edition.type === '1/1';
  const img = (w.assets && (w.assets.display || w.assets.image)) || null;
  frontWorks.push({ id, title: w.title, unique, tao: t, image: img ? await keep(resized(img, 600), `work-${slug(id)}`) : null });
}
const pick = [...frontWorks.filter((w) => w.unique && w.image).slice(0, 5), ...frontWorks.filter((w) => !w.unique && w.image).slice(0, 3)];
const front = {
  address: frontRow.address, name: script.front_collector, tao: fw.tao, rate: fw.rate,
  one_of_ones: frontWorks.filter((w) => w.unique).length, editions: frontWorks.filter((w) => !w.unique).length,
  face: await face(frontRow.address, false),
  works: pick,
  /* What they put behind the colour on the board, if they did. */
  weighed: board.ledger.filter((r) => r.address === frontRow.address).reduce((a, r) => a + (Number(r.amount) || 0), 0),
};

/* ---------------------------------------------------------- the street */
const site = (sitesApi.sites || []).find((s: any) => s.no === script.street_site);
const street = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'street.json'), 'utf8'))[String(script.street_site)];
const strip = {
  no: site.no, address: site.address, street: site.street, building: site.building, size: site.size,
  before: await keep(`${ASSETS}/${site.specimens.before}`, `street-${site.no}-before`),
  after: await keep(`${ASSETS}/${site.specimens.after}`, `street-${site.no}-after`),
  ...street,
};
/* street.json can name a sharper original than R2 holds (328 West's before).
   That one is not pulled, so stop here if it is missing. */
for (const k of ['before', 'after']) if (street[k] && !fs.existsSync(path.join(ROOT, 'public', street[k]))) {
  throw new Error(`public/${street[k]} (named in data/street.json) is missing: copy the original in`);
}

/* ---------------------------------------------------------- the slider */
const len = /const LEN = \{ min: (\d+), max: (\d+), step: (\d+), standard: (\d+) \}/.exec(stripHome);
const slider = len ? { min: +len[1], max: +len[2], step: +len[3], standard: +len[4] } : { min: 80, max: 240, step: 10, standard: 120 };

const snapshot = {
  _note: 'Pulled by films/data/pull.ts. Every figure and picture in the films comes from here or from data/captures.json.',
  taken_at: now.toISOString(),
  site: SITE,
  rates: tao.rates,
  palette,
  slots: arc.slots,
  open: open ? { id: open.id, number: open.number, slot: open.slot, closes: open.closes, question: open.question,
    candidates: (open.candidates || []).map((c: any) => ({ hex: c.hex, total: c.total, voters: c.voters })) } : null,
  board,
  top,
  front,
  strip,
  slider,
  register: { collectors: (collectorsFile.counts && collectorsFile.counts.collectors) || null, tao_live: tao.counts.tao_live },
};
const out = JSON.stringify(snapshot, null, 1) + '\n';
fs.writeFileSync(path.join(ROOT, 'data', 'snapshot.json'), out);

/* Credits: every weigh-in, collector and colour shown, traced to its row. */
const creditsPath = path.join(ROOT, 'data', 'credits.json');
const prev = fs.existsSync(creditsPath) ? JSON.parse(fs.readFileSync(creditsPath, 'utf8')) : {};
fs.writeFileSync(creditsPath, JSON.stringify({
  _note: 'What each film shows, traced to the record it came from. Weigh-ins are rows of the board\'s public ledger (/api/nudge); chat posts are message numbers in the Studio (/api/chat), written by capture.ts.',
  snapshot_at: now.toISOString(),
  palette: palette.map((p: any) => ({ slot: p.slot, hex: p.hex, nudge: p.nudge, locked_at: p.locked_at, backers: p.backers })),
  weighins: board.ledger.map((r) => ({ nudge: board.id, address: r.address, name: r.name, candidate: r.candidate, amount: r.amount, at: r.at, artist: r.artist })),
  collectors: top.map((c) => ({ rank: c.rank, address: c.address, name: c.name, tao: c.tao, held: c.held ? { id: c.held.id, since: c.held.since } : null })),
  front: { address: front.address, name: front.name, works: front.works.map((w: any) => w.id) },
  street: { site: strip.no, before: site.specimens.before, after: site.specimens.after },
  chat: prev.chat || [],
}, null, 1) + '\n');

console.log(`snapshot ${createHash('sha256').update(out).digest('hex').slice(0, 10)}: ${palette.length} locked, board ${board.id} (${board.ledger.length} rows), `
  + `${top.length} collectors (${top.filter((c) => c.face).length} with faces), front ${front.name} (${front.works.length} works), street No. ${strip.no}`);
