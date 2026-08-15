// rrrecursive.com lists the full canon: 13 thoughts. Only some carry an inscription.
import fs from 'fs';
const html = fs.readFileSync('rrr.html', 'utf8');
const inscribed = JSON.parse(fs.readFileSync('raw/recursive-mind.json', 'utf8'));

const WORDS = ['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen'];
const seq = [...html.matchAll(/class="style1">([^<]+)<|class="style5">([^<]+)<|class="style3">([^<]+)</g)]
  .map((m) => (m[1] || m[2] || m[3]).replace(/<+$/, '').trim());

// each thought sits inside a section whose background image is the work
const bg = {};
for (const m of html.matchAll(/#(container\d+)[^{]*\{[^}]*url\('([^']+)'\)/g)) bg[m[1]] = m[2].split('?')[0];
const containerFor = (needle) => {
  const i = html.indexOf('>' + needle + '<');
  if (i < 0) return null;
  const ids = [...html.slice(0, i).matchAll(/id="(container\d+)"/g)].map((m) => m[1]);
  return ids.length ? ids[ids.length - 1] : null;
};

const works = [];
for (let i = 0; i < seq.length; i++) {
  const m = /^thought (\w+)$/i.exec(seq[i]);
  if (!m) continue;
  const n = WORDS.indexOf(m[1].toLowerCase()) + 1;
  if (!n) continue;
  const title = seq[i + 1] || null;
  const meta = seq[i + 2] || '';    // "toil | two years old"
  const [sub, age] = meta.split('|').map((x) => x.trim());
  const ins = inscribed.find((x) => (x.thought || '').toLowerCase() === `thought ${m[1].toLowerCase()}`);
  const container = containerFor(seq[i]);
  const image = container && bg[container] ? `https://rrrecursive.com/${bg[container]}` : null;
  works.push({ n, sequence: `thought ${m[1].toLowerCase()}`, title, keyword: sub, age, container, site_image: image, inscription: ins || null });
}
works.sort((a, b) => a.n - b.n);
const cover = inscribed.find((x) => (x.thought || '').toUpperCase() === 'RRRECURSIVE') || null;
fs.writeFileSync('raw/recursive-canon.json', JSON.stringify({ works, cover }, null, 2));

console.log('canon works:', works.length, '| inscribed:', works.filter((w) => w.inscription).length, '| uninscribed:', works.filter((w) => !w.inscription).length);
for (const w of works) console.log('  ', String(w.n).padStart(2), w.sequence.padEnd(16), (w.title || '').padEnd(26), (w.keyword || '').padEnd(14), (w.age || '').padEnd(18), (w.container || '?').padEnd(13), w.inscription ? '#' + w.inscription.inscription_number : 'NOT INSCRIBED');
console.log('distinct container images:', new Set(works.map((w) => w.container)).size, 'of', works.length);
console.log('cover inscription:', cover ? cover.id : 'none');
