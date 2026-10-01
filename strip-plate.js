/* The Strip Painting plate: one site, its painting, its photographs, its facts.
 *
 * A component rather than a page section, because the collection page and the
 * dossier PDF both print plates and two copies would drift. Markup is built
 * from strings so it runs anywhere (browser, function, test); behaviour is
 * wireSlider, and only the browser calls it.
 *
 * Everything here comes from a site in data/strip-sites.json and the work it
 * names in the catalog. A missing photograph is a missing figure, a missing
 * price is the sale state's word, and nothing is ever drawn in their place.
 */
import { known } from './strip-plan.js';

/* The series' fixed numbers (STRIP-MAKER §Pricing). Copy, not site facts:
   they are the same for every painting, which is why they live here once. */
export const SERIES = { strips: 55, red_at: 16 };
export const STRIP_ETH_NZD = 5000;
export const NZD_PER_METRE = 1500;
export const STANDARD_M = [1.2, 2.4];
export const RENT_NZD_MONTH = 250;

export const SALE_WORDS = {
  for_sale: 'For sale',
  on_building: 'On a building',
  collected: 'Collected',
  not_for_sale: 'Not for sale',
  rental_only: 'Available to rent',
};

const ASSETS = 'https://assets.mintface.art';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rawImg = (key) => `${ASSETS}/${key}`;

export const nzd = (n) => `NZ$${Math.round(n).toLocaleString('en-NZ')}`;
/** ETH at the fixed Strip Painting rate, never the market's. */
export const ethAtStripRate = (n) => +(n / STRIP_ETH_NZD).toFixed(3);
export const fromNZD = () => Math.round(STANDARD_M[0] * NZD_PER_METRE);

/** The heading a plate goes by: "No. 1 · 320 West". */
export const plateTitle = (site) => `No. ${site.no} · ${site.address}`;

/**
 * The picture a page leads with: the first site's After, the street with the
 * painting on it. Until an After exists, the first gallery photograph, then
 * the first painting itself. Never a site picked by hand.
 */
export function heroOf(sites, works = {}) {
  const by = sites.slice().sort((a, b) => a.no - b.no);
  for (const kind of ['after', 'gallery']) {
    /* a mocked-up After is a proposal, not the street, so it never leads */
    const site = by.find((s) => s.specimens && s.specimens[kind] && !(kind === 'after' && s.specimens.after_is_mockup));
    if (site) return { site, kind, key: site.specimens[kind] };
  }
  const site = by.find((s) => s.work_id && works[s.work_id] && works[s.work_id].assets && works[s.work_id].assets.image);
  return site ? { site, kind: 'render', key: works[site.work_id].assets.image } : null;
}

/** The site whose palette the page shows beside "What it is". */
export const paletteSiteOf = (sites) => sites.slice().sort((a, b) => a.no - b.no).find((s) => Array.isArray(s.palette) && s.palette.length);

const KIND_LABEL = { gallery: 'In the gallery', before: 'Before', after: 'After', detail: 'Detail · raking light', render: 'The painting' };
export const kindLabel = (kind) => KIND_LABEL[kind] || kind;

/** What a photograph is of, for somebody who cannot see it. */
function altFor(site, kind) {
  const where = `No. ${site.no}, ${site.address}`;
  return {
    gallery: `${where}: the painting on the wall at The Line`,
    before: `${where}: the fascia before the painting`,
    after: `${where}: the fascia with the painting installed`,
    detail: `${where}: the painted surface close up, in raking light`,
  }[kind] || where;
}

/** The facts row: size, medium, strips, price. A fact with no value is left out. */
export function factsOf(site, work, { usd = null } = {}) {
  const out = [];
  const size = known(site.size);
  if (size) out.push(['Size', site.panels > 1 && !/panel|×.*×/i.test(size) ? `${size} · ${site.panels} panels` : size]);
  if (work && work.medium) out.push(['Medium', work.medium]);
  out.push(['Strips', `${SERIES.strips} · red line at ${SERIES.red_at}`]);
  const p = site.price && site.price.nzd;
  if (typeof p === 'number' && p > 0) {
    const bits = [nzd(p), `${ethAtStripRate(p)} ETH at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH`];
    if (usd) bits.push(`US$${Math.round(p * usd).toLocaleString('en-US')}`);
    out.push(['Price', bits.join(' · ')]);
  } else if (SALE_WORDS[site.sale_state]) {
    out.push(['Price', SALE_WORDS[site.sale_state]]);
  }
  return out;
}

/** The one thing a plate offers, by sale state; most plates offer nothing. */
export function actionOf(site, { rent = '/strip-paintings/rent' } = {}) {
  if (site.sale_state === 'for_sale' && site.work_id) return { label: 'Collect', href: `/w/${encodeURIComponent(site.work_id)}`, button: true };
  if (site.sale_state === 'rental_only') return { label: 'Available to rent', href: rent, button: false };
  return null;
}

/**
 * The edition line, once the photographs are minted. Three copies, always the
 * same three homes: the estate, a buyer, the tenant. Nothing until `tokens`.
 */
export function editionLine(site) {
  const ed = site.edition;
  const tokens = ed && Array.isArray(ed.tokens) ? ed.tokens : null;
  if (!tokens || !tokens.length) return null;
  const n = tokens.length;
  const forSale = ed.contract && tokens[1] != null
    ? `https://opensea.io/assets/ethereum/${encodeURIComponent(ed.contract)}/${encodeURIComponent(tokens[1])}`
    : null;
  return {
    text: `Photograph edition of ${n}`,
    parts: [
      { text: `1/${n} mintestate.eth` },
      { text: `2/${n}`, link: forSale ? { label: 'Collect →', href: forSale } : null },
      { text: `3/${n} gifted to ${site.tenant || 'the tenant'}` },
    ],
  };
}

/* A mocked-up After says so on the picture and under it, until the real
   photograph replaces it (the MANIFEST rule). */
const MOCK = '<span class="ph-mock" aria-hidden="true">Mockup</span>';
const isMock = (site, kind) => kind === 'after' && !!(site.specimens && site.specimens.after_is_mockup);

function figure(site, kind, key, img) {
  const mock = isMock(site, kind);
  return `<figure class="ph ph-${kind}"><div class="ph-frame"><img src="${esc(img(key, 1200))}" alt="${esc(altFor(site, kind))}${mock ? ' (a mockup)' : ''}" loading="lazy" decoding="async">${mock ? MOCK : ''}</div>`
    + `<figcaption>${esc(kindLabel(kind))}${mock ? ' · mockup' : ''}</figcaption></figure>`;
}

/* Before and After as one figure: two photographs from the same standing
   position, the After over the Before and clipped at a line the reader moves.
   The range input underneath is the handle: arrows, Home and End come free
   with it, and pointer and touch drags on the picture move the same value. */
function slider(site, before, after, img) {
  const id = `ba-${esc(site.no)}`;
  return `<figure class="ph ph-ba"><div class="ba" data-ba style="--pos:50%">`
    + `<img class="ba-before" src="${esc(img(before, 1400))}" alt="${esc(altFor(site, 'before'))}" loading="lazy" decoding="async" draggable="false">`
    + `<img class="ba-after" src="${esc(img(after, 1400))}" alt="${esc(altFor(site, 'after'))}${isMock(site, 'after') ? ' (a mockup)' : ''}" loading="lazy" decoding="async" draggable="false">`
    + `<span class="ba-line" aria-hidden="true"></span>${isMock(site, 'after') ? MOCK : ''}</div>`
    + `<figcaption class="ba-controls"><span aria-hidden="true">${isMock(site, 'after') ? 'After · mockup' : 'After'}</span><label for="${id}">Drag</label>`
    + `<input id="${id}" type="range" min="0" max="100" step="1" value="50" aria-valuetext="Half after, half before"><span aria-hidden="true">Before</span></figcaption></figure>`;
}

/**
 * One plate, as markup. `img(key, width)` turns an R2 key into a URL (the
 * page resizes; the dossier may not); `usd` is NZD→USD from the site's one FX
 * source, or null to leave USD out.
 */
export function plateHTML(site, work, { img = rawImg, usd = null, rent } = {}) {
  const no = esc(site.no);
  const status = [site.status, site.building].filter(Boolean).join(' · ');
  const out = [`<article class="plate" id="plate-${no}" data-plate-no="${no}" aria-labelledby="plate-${no}-h">`];
  out.push(`<header class="plate-head"><h3 id="plate-${no}-h">${esc(plateTitle(site))}</h3><p class="plate-status">${esc(status)}</p></header>`);

  const render = work && work.assets && work.assets.image;
  if (render) {
    const a = Number(work.aspect) > 0 ? Number(work.aspect) : null;
    out.push(`<img class="plate-band" src="${esc(img(render, 2400))}" alt="${esc(`${plateTitle(site)}, the painting: ${SERIES.strips} horizontal strips`)}"`
      + `${a ? ` style="aspect-ratio:${a}"` : ''} loading="lazy" decoding="async">`);
  }

  const sp = site.specimens || {};
  const figs = [];
  if (sp.gallery) figs.push(figure(site, 'gallery', sp.gallery, img));
  if (sp.before && sp.after) figs.push(slider(site, sp.before, sp.after, img));
  else if (sp.after) figs.push(figure(site, 'after', sp.after, img));
  else if (sp.before) figs.push(figure(site, 'before', sp.before, img));
  if (sp.detail) figs.push(figure(site, 'detail', sp.detail, img));
  if (figs.length) out.push(`<div class="plate-photos n${figs.length}">${figs.join('')}</div>`);

  const facts = factsOf(site, work, { usd });
  out.push(`<dl class="plate-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);

  const act = actionOf(site, rent ? { rent } : {});
  const ed = editionLine(site);
  if (act || ed) {
    out.push('<div class="plate-act">');
    if (act) out.push(`<a class="${act.button ? 'btn' : 'link'}" href="${esc(act.href)}">${esc(act.label)}</a>`);
    if (ed) {
      out.push(`<p class="plate-edition">${esc(ed.text)} · ${ed.parts.map((p) => (p.link
        ? `${esc(p.text)} <a href="${esc(p.link.href)}" rel="noopener">${esc(p.link.label)}</a>`
        : esc(p.text))).join(' · ')}</p>`);
    }
    out.push('</div>');
  }
  out.push('</article>');
  return out.join('');
}

/** Moves every Before/After under `root`: pointer (mouse and touch) and keys. */
export function wireSlider(root) {
  root.querySelectorAll('[data-ba]').forEach((frame) => {
    const input = frame.parentElement.querySelector('input[type="range"]');
    if (!input) return;
    const set = (v) => {
      const pos = Math.max(0, Math.min(100, Math.round(v)));
      frame.style.setProperty('--pos', `${pos}%`);
      if (Number(input.value) !== pos) input.value = String(pos);
      input.setAttribute('aria-valuetext', pos === 0 ? 'All before' : pos === 100 ? 'All after' : `${pos}% after, ${100 - pos}% before`);
    };
    const fromX = (x) => {
      const r = frame.getBoundingClientRect();
      set(((x - r.left) / r.width) * 100);
    };
    input.addEventListener('input', () => set(Number(input.value)));
    let dragging = null;
    frame.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button > 0) return;
      dragging = e.pointerId;
      try { frame.setPointerCapture(e.pointerId); } catch { /* synthetic pointers have none to capture */ }
      frame.classList.add('is-dragging');
      fromX(e.clientX);
    });
    frame.addEventListener('pointermove', (e) => { if (dragging === e.pointerId) fromX(e.clientX); });
    const stop = (e) => {
      if (dragging !== e.pointerId) return;
      dragging = null;
      frame.classList.remove('is-dragging');
    };
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('pointercancel', stop);
    set(Number(input.value));
  });
}
