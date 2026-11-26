#!/usr/bin/env node
/* COMPOSITION-32: the story page and its catalog entry.
 *
 *   node scripts/catalog/test-composition-32.mjs
 *
 * The story is read the way f.html reads it, the routes the way vercel.json
 * orders them, and the buy block through the same module the page imports.
 * FROGDNA's buy block is held to the markup it had before the block was
 * generalised: the old code is copied below, verbatim, as the reference.
 */
import { readFileSync, existsSync } from 'node:fs';
import { buyBlock, collected } from '../../f-buy.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(76) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const json = (p) => JSON.parse(read(p));
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

console.log('\n— the story —');
const story = json('data/f/composition-32.json');
const page = read('f.html');
is('it parses, with its slug, collection and checkout', [story.slug, story.collection, story.checkout], ['composition-32', 'composition-32', 'composition-32-1']);
const rendered = new Set(['heading', 'p', 'lead', 'close', 'image', 'work', 'works']);
is('it uses only block types f.html renders', story.blocks.filter((b) => !rendered.has(b.type)).map((b) => b.type), []);
const images = story.blocks.filter((b) => b.type === 'image').map((b) => b.src);
is('six images, the hero first', [images.length, images[0]], [6, '/composition-32-by-mintface.jpg']);
is('every image src exists on disk', images.filter((src) => !existsSync(new URL(src.slice(1), ROOT))), []);
is('the work it closes on is in the catalog', story.blocks.filter((b) => b.type === 'work').map((b) => b.id), ['composition-32-1']);
const links = story.blocks.flatMap((b) => [...String(b.text || '').matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]));
is('its links use the **[text](/path)** form, to pages that exist', links, ['/c/frogdna', '/c/pixelarcade', '/c/two-burdens', '/c/strip-paintings']);
is('the token line is gone (the token is not minted yet)', JSON.stringify(story).includes('TOKEN_LINE'), false);

console.log('\n— copy —');
const words = JSON.stringify(story);
is('no em dash in the story', /\u2014/.test(read('data/f/composition-32.json')), false);
is('no em dash in the buy block', /\u2014/.test(read('f-buy.js')), false);
is('never "memorial"', /memorial/i.test(words), false);
is('the series is //Strips in copy, and only ever a link or a name', [/Strip Painting/.test(words), (words.match(/\/\/Strips/g) || []).length], [false, 3]);

console.log('\n— routes —');
/* Vercel's order: a file that exists wins, then the first rewrite that
   matches. :name is one segment, :name+ is one or more. */
const vercel = json('vercel.json');
const toRe = (src) => new RegExp(`^${src.replace(/[.]/g, '\\.').replace(/:[a-z]+\+/gi, '(.+)').replace(/:[a-z]+/gi, '([^/]+)')}$`);
const route = (path) => {
  if (existsSync(new URL(`${path.slice(1)}.html`, ROOT))) return `${path} (file)`;
  const hit = vercel.rewrites.find((r) => toRe(r.source).test(path));
  return hit ? hit.destination : null;
};
is('/c/composition-32 serves f.html', route('/c/composition-32'), '/f');
is('/composition-32 serves f.html', route('/composition-32'), '/f');
is('/c/frogdna still serves f.html', route('/c/frogdna'), '/f');
is('/c/pixelarcade still goes through /api/c', route('/c/pixelarcade'), '/api/c');
const at = (src) => vercel.rewrites.findIndex((r) => r.source === src);
is('both new rewrites sit above /c/:slug', [at('/c/composition-32') < at('/c/:slug'), at('/composition-32') < at('/c/:slug')], [true, true]);

/* which() as the page has it, run against a pretend location */
const whichSrc = page.match(/function which\(\) \{[\s\S]*?\n\}/)[0];
const which = (pathname, search = '') => new Function('location', `${whichSrc}; return which();`)({ pathname, search });
is('which() picks composition-32 on both paths', [which('/c/composition-32'), which('/composition-32'), which('/c/composition-32/')], ['composition-32', 'composition-32', 'composition-32']);
is('and still frogdna, genesis and 10k, falling back to genesis', [which('/c/frogdna'), which('/frogdna'), which('/10k'), which('/f')], ['frogdna', 'frogdna', '10k', 'genesis']);
is('f.html renders the buy block through f-buy.js', /import\('\/f-buy\.js'\)/.test(page) && !/Acquire this artwork/.test(page), true);

console.log('\n— the catalog —');
const index = json('data/index.json');
const slugs = index.collections.map((c) => c.slug);
is('the index lists composition-32 right after frogdna', slugs[slugs.indexOf('frogdna') + 1], 'composition-32');
const entry = index.collections.find((c) => c.slug === 'composition-32');
is('as core painting, 2026, with its card line and cover', [entry.group, entry.genre, entry.year, entry.medium, entry.card_statement, entry.cover.image],
  ['core', 'Painting', '2026', 'Acrylic on canvas', 'Thirty-two small vistas, each dragged out of a pure colour.', '/composition-32-by-mintface.jpg']);
is('work_index points the work at its collection', index.work_index['composition-32-1'], 'composition-32');
const col = json('data/c/composition-32.json');
const w = col.works.find((x) => x.id === 'composition-32-1');
is('the work: 1/1, made 19 July 2026, 120 × 60 cm, ready to hang, unframed',
  [w.edition.type, w.made, w.physical.width_cm, w.physical.height_cm, w.physical.ready_to_hang, w.physical.framed, w.physical.certificate],
  ['1/1', '2026-07-19', 120, 60, true, false, true]);
is('sold to Shaun Peterson, NZD 1,000 incl. GST, nothing on offer',
  [w.status, w.physical.sold, w.collector.display_name, w.pricing_nzd, w.gst_inclusive, w.offers],
  ['acquired', true, 'Shaun Peterson', { digital: null, painting: 1000, both: null }, true, { digital: false, painting: false, both: false }]);
is('its digital block is the image alone until the token is minted', w.digital, { image: '/composition-32-by-mintface.jpg' });
is('the image is at the site root, like FROGDNA\'s', existsSync(new URL('composition-32-by-mintface.jpg', ROOT)), true);
const cat = json('catalog.json');
is('catalog.json carries it after frogdna, the same as the split output', (() => {
  const cs = cat.collections.map((c) => c.slug);
  const c = cat.collections.find((x) => x.slug === 'composition-32');
  return [cs[cs.indexOf('frogdna') + 1], c.works[0].collector.display_name, c.works[0].pricing_nzd.painting];
})(), ['composition-32', 'Shaun Peterson', 1000]);
is('20-build.mjs writes it by hand, so a full rebuild keeps it', /slug: 'composition-32'/.test(read('scripts/catalog/20-build.mjs')), true);
const ov = json('data/source/overlay.json').works['composition-32-1'];
is('the overlay holds the price, the collector and the closed offers', [ov.pricing_nzd.painting, ov.collector_display_name, ov.status, ov.offers.painting], [1000, 'Shaun Peterson', 'acquired', false]);
const core = read('mintface.js').match(/core: \[([^\]]*)\]/)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
is('the collections page orders it right after FROGDNA (MF.groupOrder)', core[core.indexOf('frogdna') + 1], 'composition-32');
const sets = json('data/sets.json');
const painting = sets.sets.find((s) => s.key === 'painting').slots.map((s) => s.key);
is('sets.json: in the Painting Set, next to FROGDNA', painting[painting.indexOf('frogdna') + 1], 'composition-32');

console.log('\n— the buy block —');
const html = buyBlock(w, e);
is('Composition 32: The painting, NZD 1,000 incl. GST', [html.includes('<span class="what">The painting</span>'), html.includes('<span class="amt">NZD 1,000 incl. GST</span>')], [true, true]);
is('"Collected by Shaun Peterson", and no Acquire button', [html.includes('Collected by Shaun Peterson'), /Acquire|class="btn"/.test(html)], [true, false]);
is('a collected painting is read off the work, not its slug', [collected(w), collected({ ...w, physical: { ...w.physical, sold: false } })], [true, false]);

/* The FROGDNA block as f.html wrote it before COMPOSITION-32, verbatim. */
function before(w) {
  const parts = [];
  const eth = w.wrapped ? `${w.wrapped.artist_held} of the wrapped editions are still with the artist` : null;
  const price = w.pricing_nzd && w.pricing_nzd.digital != null
    ? `$${Math.round(w.pricing_nzd.digital).toLocaleString('en-NZ')}`
    : null;
  parts.push(`<div class="prose buy">
        <div class="buy-row">
          <span class="what">The digital work</span>
          ${price ? `<span class="amt">${e(price)}</span>` : ''}
        </div>
        <a class="btn" href="/w/${encodeURIComponent(w.id)}">Acquire this artwork</a>
        <p class="note">Eighty-eight editions on Bitcoin as a Counterparty asset${eth ? `, and ${e(eth)} on Ethereum` : ''}. Paying in Bitcoin is arranged directly; the wrapped edition goes through the wallet.</p>
      </div>`);
  return parts[0];
}
const frog = json('data/c/frogdna.json').works.find((x) => x.id === 'frogdna-1');
is('FROGDNA\'s block is unchanged, byte for byte', buyBlock(frog, e), before(frog));
/* with no digital price and its painting sold, a work is collected: that is
   the new branch, so the no-price variant keeps its painting unsold */
const unsoldNoPrice = { ...frog, physical: { ...frog.physical, sold: false }, pricing_nzd: { ...frog.pricing_nzd, digital: null } };
is('and unchanged with no wrapped edition, or no price on an unsold painting', [buyBlock({ ...frog, wrapped: null }, e) === before({ ...frog, wrapped: null }),
  buyBlock(unsoldNoPrice, e) === before(unsoldNoPrice)], [true, true]);
is('FROGDNA still says Acquire, with its digital price', [buyBlock(frog, e).includes('Acquire this artwork'), buyBlock(frog, e).includes('$150')], [true, true]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
