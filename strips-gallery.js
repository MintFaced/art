/* The //STRIPS gallery on /c/strip-paintings: street works first, then public
 * mints, stills that play on hover, filtered by display, rhythm and redeemed.
 * Stays hidden until there's something in it.
 */
import { play } from '/strips-blink.js';
import { stillSVG } from '/strips-design.js';

const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function mountGallery(root) {
  const r = await fetch('/api/strips/gallery').catch(() => null);
  const all = r && r.ok ? await r.json() : [];
  if (!all.length) return;
  root.hidden = false;
  const grid = root.querySelector('[data-grid]');
  const pick = { display: '', rhythm: '', redeemed: '' };
  const options = (key) => [...new Set(all.map((t) => t[key]).filter(Boolean))].sort();
  root.querySelector('[data-filters]').innerHTML = [
    ['display', 'Display', options('display')], ['rhythm', 'Rhythm', options('rhythm')], ['redeemed', 'Redeemed', ['Yes', 'No']],
  ].map(([k, label, list]) => `<label>${label} <select data-f="${k}"><option value="">All</option>${list.map((v) => `<option>${e(v)}</option>`).join('')}</select></label>`).join('');
  function paint() {
    const shown = all.filter((t) => (!pick.display || t.display === pick.display) && (!pick.rhythm || t.rhythm === pick.rhythm) && (!pick.redeemed || (t.redeemed ? 'Yes' : 'No') === pick.redeemed));
    grid.innerHTML = shown.map((t) => `<a class="tok" data-id="${t.id}" href="/c/strip-paintings/strips/${t.id}">
      <span class="frame"><img loading="lazy" alt="//STRIPS #${t.id}" src="data:image/svg+xml;base64,${btoa(stillSVG(t.design))}"></span>
      <span class="mono">${t.no ? `No.${t.no}` : `#${t.id}`}${t.display ? ` · ${e(t.display)}` : ' · Tuning'}</span></a>`).join('');
  }
  root.addEventListener('change', (ev) => { const k = ev.target.dataset.f; if (k) { pick[k] = ev.target.value; paint(); } });
  let stop = null;
  grid.addEventListener('pointerover', (ev) => {
    const a = ev.target.closest('.tok');
    if (!a || a.dataset.on) return;
    const t = all.find((x) => x.id === Number(a.dataset.id));
    if (!t || !t.word) return;
    if (stop) stop();
    grid.querySelectorAll('[data-on]').forEach((x) => delete x.dataset.on);
    a.dataset.on = '1';
    const host = a.querySelector('.frame');
    host.querySelector('img').style.visibility = 'hidden';
    const end = play(host, { design: t.design, word: t.word, minted: t.minted, frame: false, long: 480 });
    stop = () => { end(); host.querySelector('img').style.visibility = ''; delete a.dataset.on; stop = null; };
    a.addEventListener('pointerleave', () => stop && stop(), { once: true });
  });
  paint();
}
