/* The home page's Strip Painting door (docs: STRIP-HOME).
 *
 * A length, a painting drawn to it, a price, a button. The painting arrives
 * from /api/strip-render as strips (a colour and a width each) in a palette
 * picked for this visit; the page only draws them, to scale, and turns them
 * for portrait. Prices come from strip-price.js, the one the Maker reads.
 *
 * COMMISSION writes to the studio with the spec until the commission checkout
 * exists; the spec carries the palette, so what was seen is what is painted.
 */
import { stripPrice, fmtNZD, fmtETH, fmtUSD, STRIP_ETH_NZD } from '/strip-price.js';

const LEN = { min: 80, max: 240, step: 10, standard: 120 };
const WIDTH = { min: 10, max: 120, step: 10, standard: 60 };
const RECENT_KEY = 'mf_strip_seen';
const STUDIO = 'ryan@mintface.art';
const FRAME = { none: null, black: '#141414', white: '#F4F2EC' };

const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* The palettes this browser was shown last, so a reload brings a new one. */
const seen = {
  read() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string'); } catch { return []; } },
  add(id) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...this.read().filter((x) => x !== id)].slice(0, 4))); } catch { /* private window */ } },
};

/* A photograph, reduced to its twelve most common colours that are distinct
   from one another, each weighted by its share. */
function sampleColours(imgData) {
  const buckets = new Map();
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] & 0xf0) << 16) | ((d[i + 1] & 0xf0) << 8) | (d[i + 2] & 0xf0);
    const b = buckets.get(key);
    if (b) { b.n += 1; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; } else buckets.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  const far = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 > 1600;
  const picked = [];
  for (const c of [...buckets.values()].map((v) => ({ rgb: [v.r / v.n, v.g / v.n, v.b / v.n].map(Math.round), n: v.n })).sort((a, b) => b.n - a.n)) {
    if (picked.length >= 12) break;
    if (picked.every((p) => far(p.rgb, c.rgb))) picked.push(c);
  }
  const total = picked.reduce((s, p) => s + p.n, 0) || 1;
  return picked.map((p) => ({ hex: `#${p.rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`, w: Math.max(1, Math.round((p.n / total) * 100)) }));
}

/* Two curved arrows, drawn in the ink: no fill, no colour of their own. */
const TURN = '<svg class="sh-turn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path vector-effect="non-scaling-stroke" d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path vector-effect="non-scaling-stroke" d="M21 3v5h-5"/>'
  + '<path vector-effect="non-scaling-stroke" d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path vector-effect="non-scaling-stroke" d="M8 16H3v5"/></svg>';

const MARKUP = `
  <div class="sh-intro">
    <p class="sh-h">Your size.</p>
    <p class="sh-lede">Choose a length. We paint a //Strips to it.</p>
  </div>
  <div class="sh-body">
    <figure class="sh-stage" data-stage>
      <canvas data-canvas role="img" aria-label="A //Strips"></canvas>
      <figcaption class="sh-floor" data-floor hidden>Stands on the floor.</figcaption>
    </figure>
    <div class="sh-controls">
      <div class="sh-len">
        <label class="vh" for="shLen">Length</label>
        <input id="shLen" type="range" min="${LEN.min}" max="${LEN.max}" step="${LEN.step}" value="${LEN.standard}" data-len>
        <div class="sh-ticks" aria-hidden="true">
          <span style="left:0">80</span>
          <span style="left:${((120 - LEN.min) / (LEN.max - LEN.min)) * 100}%">120 Recommended</span>
          <span class="end">240 Freestanding</span>
        </div>
      </div>
      <div class="sh-opts">
        <div class="sh-pick" role="group" aria-label="Orientation">
          <button type="button" data-orient="portrait" aria-pressed="false">Portrait</button><span aria-hidden="true">&middot;</span><button type="button" data-orient="landscape" aria-pressed="true">Landscape</button>
        </div>
        <div class="sh-width">
          <button type="button" class="sh-quiet" data-width-open aria-expanded="false" aria-controls="shWidth">60 cm wide</button>
          <span class="sh-width-pick" id="shWidthWrap" hidden>
            <label class="vh" for="shWidth">Width</label>
            <input id="shWidth" type="range" min="${WIDTH.min}" max="${WIDTH.max}" step="${WIDTH.step}" value="${WIDTH.standard}" data-width>
          </span>
        </div>
        <div class="sh-row">
          <div class="sh-pick" role="group" aria-label="Frame">
            <button type="button" data-frame="none" aria-pressed="true">None</button><span aria-hidden="true">&middot;</span><button type="button" data-frame="black" aria-pressed="false">Black</button><span aria-hidden="true">&middot;</span><button type="button" data-frame="white" aria-pressed="false">White</button>
          </div>
          <span class="sh-sep" aria-hidden="true">&middot;</span>
          <button type="button" class="sh-new" data-new aria-label="New colours">${TURN}<span>New colours</span></button>
        </div>
      </div>
      <p class="sh-result" data-result aria-live="polite"></p>
      <p class="sh-ship"><span data-ship-say></span> <button type="button" class="sh-quiet" data-ship></button></p>
      <a class="sh-go" data-go href="mailto:${STUDIO}">Commission</a>
      <p class="sh-photo"><button type="button" class="sh-quiet" data-photo>Or sample your own colours from a photo.</button><input type="file" accept="image/*" data-file hidden></p>
    </div>
  </div>`;

export function mount(root) {
  if (!root) return;
  root.innerHTML = MARKUP;
  const $ = (sel) => root.querySelector(sel);
  const S = {
    length: LEN.standard, width: WIDTH.standard, orient: 'landscape', frame: 'none', shipping: false,
    palette: null, photo: null, strips: null, usd: null, cache: new Map(), asked: 0, turns: 0,
  };

  /* ---------- the painting ---------- */
  async function fetchStrips() {
    const key = `${S.photo ? 'photo' : S.palette ? S.palette.id : '*'}:${S.width}`;
    if (S.cache.has(key)) return S.cache.get(key);
    let r;
    if (S.photo) {
      r = await fetch('/api/strip-render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ width: S.width, colours: S.photo }) });
    } else if (S.palette) {
      r = await fetch(`/api/strip-render?width=${S.width}&palette=${encodeURIComponent(S.palette.id)}`);
    } else {
      r = await fetch(`/api/strip-render?width=${S.width}&not=${encodeURIComponent(seen.read().join(','))}`);
    }
    if (!r.ok) throw new Error(`strip-render ${r.status}`);
    const j = await r.json();
    S.cache.set(`${j.palette.id}:${S.width}`, j);
    return j;
  }

  async function paint() {
    const ask = ++S.asked;
    try {
      const j = await fetchStrips();
      if (ask !== S.asked) return; // a later change has already asked again
      if (!S.palette || S.palette.id !== j.palette.id) {
        S.palette = j.palette;
        if (j.palette.id !== 'photo') seen.add(j.palette.id);
      }
      S.strips = j.strips;
      say(); // the email names the palette now on screen
      draw();
    } catch (err) {
      console.error('strip painting', err);
      if (!S.strips) $('[data-stage]').hidden = true;
    }
  }

  /* To scale: in portrait the tallest painting (240 cm) is the stage's full
     height, in landscape the longest is its full width, so the slider is seen
     to make the painting bigger. On a phone the stage is a fixed box and the
     painting stands on its foot. On a desktop the canvas is the painting, at
     its own proportions, and the grid centres the controls on it. Edges are
     running totals rounded once, so no seam is a colour of its own. */
  const PHONE = window.matchMedia('(max-width: 820px)');
  function draw() {
    const cv = $('[data-canvas]');
    const stage = $('[data-stage]');
    if (!S.strips || !cv) return;
    const phone = PHONE.matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = stage.clientWidth;
    const H = phone ? stage.clientHeight : Math.min(440, Math.max(300, window.innerWidth * 0.3));
    if (!W || !H) return;
    const portrait = S.orient === 'portrait';
    const pad = 8;
    const scale = portrait
      ? Math.min((H - pad * 2) / (LEN.max * 10), (W - pad * 2) / (WIDTH.max * 10))
      : Math.min((W - pad * 2) / (LEN.max * 10), (H - pad * 2) / (WIDTH.max * 10));
    const lenPx = Math.round(S.length * 10 * scale);
    const widPx = Math.round(S.width * 10 * scale);
    const pw = portrait ? widPx : lenPx;
    const ph = portrait ? lenPx : widPx;
    const frame = FRAME[S.frame];
    const f = frame ? Math.max(3, Math.round(Math.min(pw, ph) * 0.04)) : 0;
    const CH = phone ? H : ph + f * 2;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(CH * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${CH}px`;
    const ctx = cv.getContext('2d', { alpha: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, CH);
    const x0 = Math.round((W - pw) / 2);
    const y0 = phone ? H - pad - ph : f; // a phone's stands on the foot of the stage
    if (frame) {
      ctx.fillStyle = frame;
      ctx.fillRect(x0 - f, y0 - f, pw + f * 2, ph + f * 2);
      if (S.frame === 'white') { ctx.strokeStyle = 'rgba(20,20,20,.25)'; ctx.lineWidth = 1; ctx.strokeRect(x0 - f + 0.5, y0 - f + 0.5, pw + f * 2 - 1, ph + f * 2 - 1); }
    }
    const total = S.strips.reduce((n, s) => n + s.mm, 0) || 1;
    const across = portrait ? pw : ph;
    let mm = 0;
    for (const s of S.strips) {
      const a = Math.round((mm / total) * across);
      const b = Math.round(((mm + s.mm) / total) * across);
      ctx.fillStyle = s.hex;
      // portrait: strips stand left to right; landscape: they lie, laid from the bottom up
      if (portrait) ctx.fillRect(x0 + a, y0, b - a, ph);
      else ctx.fillRect(x0, y0 + ph - b, pw, b - a);
      mm += s.mm;
    }
    cv.setAttribute('aria-label', `A //Strips, ${S.length} by ${S.width} cm, ${S.orient}${S.frame !== 'none' ? `, in a ${S.frame} frame` : ''}`);
    $('[data-floor]').hidden = !(portrait && S.length === LEN.max);
  }

  /* ---------- the words ---------- */
  function say() {
    const nzd = stripPrice({ lengthCm: S.length, widthCm: S.width, framed: S.frame !== 'none', shipping: S.shipping });
    const bits = [`${S.length} × ${S.width} cm`, S.orient];
    if (S.frame !== 'none') bits.push(`${S.frame} frame`);
    bits.push(fmtNZD(nzd), fmtETH(nzd));
    const usd = fmtUSD(nzd, S.usd);
    if (usd) bits.push(usd);
    $('[data-result]').textContent = bits.join(' · ').toUpperCase();
    $('[data-ship-say]').textContent = S.shipping ? 'Shipped worldwide, boxed.' : 'Collected from The Line, Hastings.';
    $('[data-ship]').textContent = S.shipping ? 'Collect from The Line instead →' : 'Ship it worldwide, boxed →';
    $('[data-width-open]').textContent = `${S.width} cm wide`;
    $('[data-len]').setAttribute('aria-valuetext', `${S.length} cm`);
    $('[data-width]').setAttribute('aria-valuetext', `${S.width} cm`);
    $('[data-go]').href = mailto(nzd, usd);
    for (const b of root.querySelectorAll('[data-orient]')) b.setAttribute('aria-pressed', String(b.dataset.orient === S.orient));
    for (const b of root.querySelectorAll('[data-frame]')) b.setAttribute('aria-pressed', String(b.dataset.frame === S.frame));
  }

  function mailto(nzd, usd) {
    const colours = S.palette ? S.palette.colours.join(' ') : '';
    const subject = `//Strips commission ... ${S.length} × ${S.width} cm, ${S.orient}`;
    const body = [
      'I would like this //Strips.',
      '',
      `Size: ${S.length} × ${S.width} cm, ${S.orient}`,
      `Frame: ${S.frame}`,
      S.shipping ? 'Shipped worldwide, boxed' : 'Collected from The Line, Hastings',
      `Palette: ${S.palette ? S.palette.id : 'to come'}${colours ? ` (${colours})` : ''}`,
      `Price: ${[fmtNZD(nzd), `${fmtETH(nzd)} at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH`, usd].filter(Boolean).join(' · ')}`,
    ].join('\n');
    return `mailto:${STUDIO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  const update = (repaint) => { say(); if (repaint) paint(); else draw(); };

  /* NEW COLOURS: another palette from the pool, never the one on screen, in
     the same size, turn, width and frame. The painting crossfades in place:
     the old one is laid over the new as a still and faded out. The palette
     on screen is the one the email carries. */
  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)');
  async function newColours() {
    const icon = root.querySelector('.sh-turn');
    S.turns += 1;
    if (icon) icon.style.transform = `rotate(${S.turns * 180}deg)`;
    const ask = ++S.asked;
    try {
      const not = S.photo || !S.palette ? '' : S.palette.id;
      const r = await fetch(`/api/strip-render?width=${S.width}&not=${encodeURIComponent(not)}`);
      if (!r.ok) throw new Error(`strip-render ${r.status}`);
      const j = await r.json();
      if (ask !== S.asked) return;
      const old = STILL.matches ? null : still();
      S.photo = null;
      S.palette = j.palette;
      seen.add(j.palette.id);
      S.cache.set(`${j.palette.id}:${S.width}`, j);
      S.strips = j.strips;
      say();
      draw();
      if (old) {
        requestAnimationFrame(() => requestAnimationFrame(() => { old.style.opacity = '0'; }));
        setTimeout(() => old.remove(), 260);
      }
    } catch (err) {
      console.error('new colours', err);
    }
  }
  /* the painting as it is now, as a picture laid exactly over it */
  function still() {
    const cv = $('[data-canvas]');
    if (!cv || !cv.width || !S.strips) return null;
    const o = document.createElement('canvas');
    o.width = cv.width;
    o.height = cv.height;
    o.getContext('2d').drawImage(cv, 0, 0);
    o.className = 'sh-fade';
    o.setAttribute('aria-hidden', 'true');
    Object.assign(o.style, { width: cv.style.width, height: cv.style.height, left: `${cv.offsetLeft}px`, top: `${cv.offsetTop}px` });
    cv.after(o);
    return o;
  }

  /* ---------- wiring ---------- */
  $('[data-len]').addEventListener('input', (ev) => { S.length = Number(ev.target.value); update(false); });
  $('[data-width]').addEventListener('input', (ev) => { S.width = Number(ev.target.value); update(true); });
  $('[data-width-open]').addEventListener('click', (ev) => {
    const wrap = root.querySelector('#shWidthWrap');
    wrap.hidden = !wrap.hidden;
    ev.currentTarget.setAttribute('aria-expanded', String(!wrap.hidden));
    if (!wrap.hidden) $('[data-width]').focus();
  });
  for (const b of root.querySelectorAll('[data-orient]')) b.addEventListener('click', () => { S.orient = b.dataset.orient; update(false); });
  for (const b of root.querySelectorAll('[data-frame]')) b.addEventListener('click', () => { S.frame = b.dataset.frame; update(false); });
  $('[data-ship]').addEventListener('click', () => { S.shipping = !S.shipping; update(false); });
  $('[data-new]').addEventListener('click', newColours);
  /* COMMISSION makes the order and opens its checkout (/commission/{id}). The
     palette goes with it, and for the collectors' or a photograph's the
     colours on screen, so what is painted is what was seen. The price is the
     server's to work out. If the order cannot be made, the link it falls back
     to is the letter to the studio it always carried. */
  $('[data-go]').addEventListener('click', async (ev) => {
    if (!S.palette) return;
    ev.preventDefault();
    const go = ev.currentTarget;
    if (go.getAttribute('aria-busy') === 'true') return;
    go.setAttribute('aria-busy', 'true');
    try {
      const spec = {
        length_cm: S.length, width_cm: S.width, orientation: S.orient, frame: S.frame,
        delivery: S.shipping ? 'shipped' : 'collect', palette_id: S.palette.id,
        ...(S.photo ? { colours: S.photo } : S.palette.id === 'collectors' ? { colours: S.palette.colours } : {}),
      };
      const r = await fetch('/api/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', spec }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id || !j.key) throw new Error(j.error || `commission ${r.status}`);
      location.href = `/commission/${encodeURIComponent(j.id)}#k=${encodeURIComponent(j.key)}`;
    } catch (err) {
      console.error('commission', err);
      go.removeAttribute('aria-busy');
      location.href = go.href;
    }
  });
  $('[data-photo]').addEventListener('click', () => $('[data-file]').click());
  $('[data-file]').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const k = Math.min(1, 320 / img.width);
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const colours = sampleColours(c.getContext('2d').getImageData(0, 0, c.width, c.height));
      if (colours.length < 4) return; // too little colour in it to paint; the painting stays
      S.photo = colours;
      S.cache.clear();
      update(true);
    };
    img.src = url;
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => draw()).observe($('[data-stage]'));
  PHONE.addEventListener('change', () => draw());

  say();
  paint();
  if (window.MF && MF.fx) MF.fx().then((fx) => { S.usd = fx && fx.usd ? fx.usd : null; say(); }).catch(() => {});
}
