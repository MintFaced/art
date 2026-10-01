/* The Strip Paintings site plan: WestSide Hastings as one drawing.
 *
 * One module, used everywhere the street is drawn: the page (with hover and
 * tap), the dossier PDF (static), and the tests. It reads data/strip-sites.json
 * and nothing else ... a tenth site is one line of JSON, never a line of code.
 *
 * Heretaunga Street West runs across. Numbers descend left to right, 402 at
 * the far left, 227 at the far right. Odd numbers are on the north side (top),
 * even on the south. King Street crosses between the 300s and the 200s, and a
 * site whose side is "king" sits on King Street, north of Heretaunga, its bar
 * along King Street. Installed is solid ink, approved an ink outline,
 * proposed a grey dashed outline. A bar is as wide as its fascia where the
 * fascia is known, 1.2 m where it is not. No colour but the art's.
 */

export const STATUSES = ['installed', 'approved', 'proposed'];
export const COLOURS = { street: '#EEECE4', ink: '#141414', grey: '#6B6A64', paper: '#F8F7F3', kerb: '#C9C6BC' };
const MONO = "'Geist Mono', ui-monospace, monospace";
const W = 1360;
const H = 360;
const STREET = { top: 150, bottom: 210, left: 40, right: 1320 };
const KING = { x: 760, w: 44, top: 40, bottom: 320 };
const PX_PER_M = 25;
const DEFAULT_M = 1.2;
const BAR = 18;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const numberOf = (site) => Number(String(site.address || '').match(/\d+/)?.[0] || 0);

/** Installed, approved, proposed: counted, never typed. */
export function counts(sites) {
  const c = { installed: 0, approved: 0, proposed: 0, total: sites.length };
  for (const s of sites) if (c[s.status] != null) c[s.status] += 1;
  return c;
}
export function countLine(sites, { scroll = false } = {}) {
  const c = counts(sites);
  return [`${c.installed} INSTALLED`, `${c.approved} APPROVED`, `${c.proposed} PROPOSED`, ...(scroll ? ['SCROLL →'] : [])].join(' · ');
}
/** Which specimens exist, in the order the shot sheet names them. */
export const specimensOf = (site) => ['gallery', 'before', 'after', 'detail'].filter((k) => site.specimens && site.specimens[k]);
/** A value still waiting on Ryan ("[SIZE]") is no value at all: never printed. */
export const known = (v) => (v == null || /^\s*\[[^\]]*\]\s*$/.test(String(v)) ? null : v);

/* What the plan calls a building: the name before any comma, "building"
   shortened as the mockup does, and the fascia where it is known. */
function planLabel(site) {
  const name = String(site.building || '').split(',')[0].replace(/\bbuilding\b/i, 'bldg').trim().toUpperCase();
  const street = site.side === 'king' ? ' · KING ST' : '';
  const size = site.fascia_m && site.fascia_m >= 3 ? ` · ${+site.fascia_m} M` : '';
  return `${name}${street}${size}`;
}

/**
 * Where everything goes. Sites on Heretaunga are spread evenly through their
 * block (the 300s west of King Street, the 200s east), in descending number
 * order, so the drawing reads like the street without pretending to be a
 * survey. Labels on one side that would collide step out a tier.
 */
export function layout(sites) {
  const here = sites.filter((s) => s.side !== 'king');
  const west = here.filter((s) => numberOf(s) >= 300).sort((a, b) => numberOf(b) - numberOf(a));
  const east = here.filter((s) => numberOf(s) < 300).sort((a, b) => numberOf(b) - numberOf(a));
  const spread = (list, x0, x1) => list.map((s, i) => [s, x0 + ((i + 0.5) * (x1 - x0)) / list.length]);
  const placed = [...spread(west, STREET.left + 20, KING.x - 20), ...spread(east, KING.x + KING.w + 20, STREET.right - 20)];
  const out = [];
  for (const [s, cx] of placed) {
    const w = Math.max(PX_PER_M * DEFAULT_M, PX_PER_M * (s.fascia_m || DEFAULT_M));
    const north = s.side === 'north';
    out.push({ site: s, kind: 'street', north, cx, bar: { x: cx - w / 2, y: north ? STREET.top - 4 - BAR : STREET.bottom + 4, w, h: BAR } });
  }
  /* King Street: along its east kerb, north of Heretaunga, stacked upward. */
  let y = STREET.top - 4;
  for (const s of sites.filter((x) => x.side === 'king').sort((a, b) => numberOf(a) - numberOf(b))) {
    const len = Math.max(PX_PER_M * DEFAULT_M, PX_PER_M * (s.fascia_m || DEFAULT_M)) + 26;
    y -= len;
    out.push({ site: s, kind: 'king', north: true, cx: KING.x + KING.w + 4 + BAR / 2, bar: { x: KING.x + KING.w + 4, y, w: BAR, h: len } });
    y -= 12;
  }
  /* Label tiers: on each side, a label that would overlap the one before it
     on the same tier moves one tier further from the street. */
  const charW = { num: 7.9, name: 7.9 };
  for (const north of [true, false]) {
    const tiers = [];
    for (const p of out.filter((q) => q.kind === 'street' && q.north === north).sort((a, b) => a.cx - b.cx)) {
      const half = Math.max(String(numberOf(p.site)).length * charW.num, planLabel(p.site).length * charW.name) / 2 + 6;
      let t = 0;
      while (tiers[t] != null && tiers[t] > p.cx - half) t += 1;
      tiers[t] = p.cx + half;
      p.tier = t;
    }
  }
  return out;
}

const STYLE = {
  installed: (b) => `fill="${COLOURS.ink}"`,
  approved: () => `fill="none" stroke="${COLOURS.ink}" stroke-width="1.5"`,
  proposed: () => `fill="none" stroke="${COLOURS.grey}" stroke-width="1.5" stroke-dasharray="4 3"`,
};

/**
 * The plan as SVG markup. `interactive` adds what the page needs (focus,
 * hover lift); the dossier asks for it without.
 */
export function planSVG(sites, { interactive = true, title = 'Site plan of Heretaunga Street West' } = {}) {
  const parts = [];
  const c = counts(sites);
  parts.push(`<svg class="strip-plan" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(`${title}: ${c.total} Strip Painting sites, ${c.installed} installed, ${c.approved} approved, ${c.proposed} proposed`)}">`);
  if (interactive) parts.push(`<style>.sp-site{cursor:pointer;transition:transform .2s ease;outline:none}.sp-site:hover,.sp-site:focus-visible,.sp-site.is-lit{transform:translateY(-2px)}.sp-site:focus-visible .sp-bar{stroke:${COLOURS.ink};stroke-width:2.5}</style>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COLOURS.paper}"/>`);
  parts.push(`<g font-family="${MONO}" font-size="13" letter-spacing="2" fill="${COLOURS.grey}"><text x="20" y="34">NORTH · ODD NUMBERS</text><text x="20" y="${H - 20}">SOUTH · EVEN NUMBERS</text></g>`);
  parts.push(`<rect x="${STREET.left}" y="${STREET.top}" width="${STREET.right - STREET.left}" height="${STREET.bottom - STREET.top}" fill="${COLOURS.street}"/>`);
  parts.push(`<rect x="${KING.x}" y="${KING.top}" width="${KING.w}" height="${KING.bottom - KING.top}" fill="${COLOURS.street}"/>`);
  parts.push(`<line x1="${STREET.left}" y1="${STREET.top}" x2="${STREET.right}" y2="${STREET.top}" stroke="${COLOURS.kerb}"/><line x1="${STREET.left}" y1="${STREET.bottom}" x2="${STREET.right}" y2="${STREET.bottom}" stroke="${COLOURS.kerb}"/>`);
  const mid = (STREET.top + STREET.bottom) / 2 + 5;
  parts.push(`<g font-family="${MONO}" font-size="13" letter-spacing="3" fill="${COLOURS.grey}" text-anchor="middle"><text x="${(STREET.left + KING.x) / 2}" y="${mid}">HERETAUNGA STREET WEST</text><text x="${(KING.x + KING.w + STREET.right) / 2}" y="${mid}">HERETAUNGA STREET WEST</text><text x="${KING.x + KING.w / 2}" y="290" transform="rotate(-90 ${KING.x + KING.w / 2} 290)" font-size="13">KING ST</text></g>`);
  parts.push(`<g font-family="${MONO}" font-size="13" fill="${COLOURS.ink}">`);
  for (const p of layout(sites)) {
    const s = p.site;
    const n = numberOf(s);
    const label = planLabel(s);
    /* The name starts with what the bar visibly says, in the order it says
       it, so a voice user can speak the label they see. */
    const seen = p.kind !== 'king' && p.north ? `${label} ${n}` : `${n} ${label}`;
    const a = interactive ? ` class="sp-site" data-no="${esc(s.no)}" tabindex="0" role="link" aria-label="${esc(`${seen}: No. ${s.no}, ${s.address}, ${s.building}, ${s.status}`)}"` : '';
    parts.push(`<g${a}><rect class="sp-bar" x="${p.bar.x.toFixed(1)}" y="${p.bar.y.toFixed(1)}" width="${p.bar.w.toFixed(1)}" height="${p.bar.h.toFixed(1)}" ${STYLE[s.status] ? STYLE[s.status]() : STYLE.proposed()}/>`);
    if (p.kind === 'king') {
      const ty = p.bar.y + 22;
      parts.push(`<text x="${p.bar.x + BAR + 10}" y="${ty}">${n}</text> <text x="${p.bar.x + BAR + 10}" y="${ty + 18}" font-size="13" fill="${COLOURS.grey}">${esc(label)}</text>`);
    } else if (p.north) {
      const base = p.bar.y - 8 - p.tier * 38;
      parts.push(`<text x="${p.cx.toFixed(1)}" y="${base - 18}" text-anchor="middle" font-size="13" fill="${COLOURS.grey}">${esc(label)}</text> <text x="${p.cx.toFixed(1)}" y="${base}" text-anchor="middle">${n}</text>`);
    } else {
      const base = p.bar.y + BAR + 22 + p.tier * 38;
      parts.push(`<text x="${p.cx.toFixed(1)}" y="${base}" text-anchor="middle">${n}</text> <text x="${p.cx.toFixed(1)}" y="${base + 18}" text-anchor="middle" font-size="13" fill="${COLOURS.grey}">${esc(label)}</text>`);
    }
    parts.push('</g>');
  }
  parts.push('</g>');
  /* The legend, top right. */
  const lx = 960;
  parts.push(`<g font-family="${MONO}" font-size="13" fill="${COLOURS.grey}" letter-spacing="2">`
    + `<rect x="${lx}" y="24" width="28" height="12" ${STYLE.installed()}/><text x="${lx + 36}" y="34">INSTALLED</text>`
    + `<rect x="${lx + 134}" y="24" width="28" height="12" ${STYLE.approved()}/><text x="${lx + 170}" y="34">APPROVED</text>`
    + `<rect x="${lx + 258}" y="24" width="28" height="12" ${STYLE.proposed()}/><text x="${lx + 294}" y="34">PROPOSED</text></g>`);
  parts.push('</svg>');
  return parts.join('');
}

/** The register, as rows: every site, plates or not. */
export function registerRows(sites) {
  return sites.slice().sort((a, b) => a.no - b.no).map((s) => ({
    no: String(s.no).padStart(2, '0'), address: s.address, building: s.building, size: known(s.size) || null,
    status: s.status.toUpperCase(),
    specimens: specimensOf(s).map((k) => (k === 'after' && s.specimens.after_is_mockup ? 'AFTER (MOCKUP)' : k.toUpperCase())).join(' · '),
  }));
}

/**
 * The page's behaviour: hover or tap a bar and it lifts, and the plate (or
 * the register row) for that site lights up; click, Enter or Space goes to
 * it. Plates carry data-plate-no, register rows data-site-no.
 */
export function wirePlan(root, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !doc) return;
  const target = (no) => doc.getElementById(`plate-${no}`) || doc.getElementById(`site-${no}`);
  const light = (no, on) => doc.querySelectorAll(`[data-plate-no="${no}"], [data-site-no="${no}"]`).forEach((el) => el.classList.toggle('is-lit', on));
  root.querySelectorAll('.sp-site').forEach((g) => {
    const no = g.getAttribute('data-no');
    const on = () => { g.classList.add('is-lit'); light(no, true); };
    const off = () => { g.classList.remove('is-lit'); light(no, false); };
    const go = () => { const t = target(no); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    g.addEventListener('pointerenter', on);
    g.addEventListener('pointerleave', off);
    g.addEventListener('focus', on);
    g.addEventListener('blur', off);
    g.addEventListener('click', go);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
