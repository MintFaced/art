/* mintface.art shared runtime. No build step, no dependencies. */

/* ─────────────────────────────────────────────────────────────
   ASSET BASE URL ... change this one line when storage moves
   ───────────────────────────────────────────────────────────── */
const ASSETS_BASE = 'https://assets.mintface.art';

/* ─────────────────────────────────────────────────────────────
   THUMBNAIL SOURCE ... change this one line when R2 holds thumbs
   '' turns proxying off and grids load the full master files
   ───────────────────────────────────────────────────────────── */
// n=-1 keeps every frame, so an animated source stays animated. It costs a
// still image nothing: the bytes come back byte for byte the same.
const THUMB_PROXY = 'https://images.weserv.nl/?url={url}&w={w}&output=webp&q=80&n=-1';

const MF = {
  ASSETS_BASE,
  THUMB_PROXY,

  /* ---------- data ---------- */
  _index: null,
  _collections: {},
  _state: null,

  // What has happened since the last catalog rebuild: sales, holds, releases.
  // Written by the functions in api/ and committed back to the repo.
  async state() {
    if (this._state) return this._state;
    this._state = await fetch('/data/state.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { works: {} }))
      .catch(() => ({ works: {} }));
    return this._state;
  },

  applyState(work, state) {
    const s = state && state.works && state.works[work.id];
    if (!s) return work;
    const out = { ...work, status: s.status || work.status };
    if (s.reserve) out.reserve = { expires: s.reserve.expires };
    if (s.pending) out.pending = { expires: s.pending.expires };
    if (s.collector) {
      out.collector = {
        address: s.collector.address || null,
        ens: s.collector.ens || null,
        display_name: s.collector.display_name || null,
        note: s.collector.note || null,
        acquired: s.collector.acquired || null,
      };
    }
    if (s.status === 'available') { out.reserve = null; out.pending = null; out.collector = null; }

    // A work that has sold, been reserved or gone to the vault is not on offer,
    // whatever the catalog said when it was built. An edition is the exception:
    // one copy going does not close the rest.
    const closed = ['acquired', 'vaulted', 'reserved', 'pending'].includes(out.status);
    const isEdition = work.edition && work.edition.type === 'edition';
    if (closed && (!isEdition || s.sold_out)) {
      out.offers = { digital: false, painting: false, both: false };
    } else if (closed && isEdition && s.what === 'painting') {
      out.offers = { ...(work.offers || {}), painting: false, both: false };
    }
    return out;
  },

  async index() {
    if (!this._index) this._index = await fetch('/data/index.json').then((r) => r.json());
    return this._index;
  },

  // Recent Work is not on chain and there is no build step, so the file the
  // studio writes is the file the site reads. Everything else comes from the
  // split, which is generated from the chain.
  shapeRecent(src, index) {
    const col = { ...(src.collection || {}), slug: 'recent-work' };
    const meta = (index && index.collections || []).find((c) => c.slug === 'recent-work') || {};
    const works = (src.works || [])
      .filter((w) => w.hidden !== true)
      .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')))
      .map((w) => {
        const p = w.pricing_nzd || {};
        const offers = {
          digital: p.digital != null && p.digital > 0,
          painting: p.painting != null && p.painting > 0,
          both: p.both != null && p.both > 0,
        };
        return {
          id: w.id,
          collection: 'recent-work',
          title: w.title,
          group: w.group || 'painting',
          aspect: w.aspect || null,
          orientation: w.orientation || null,
          year: w.year || null,
          medium: w.medium || col.medium || null,
          statement: w.statement || null,
          status: w.status || 'available',
          pricing_nzd: p,
          offers,
          // the details table reads width_cm and height_cm, so the studio's
          // w/h/d is unpacked here rather than left nested where nothing looks
          physical: {
            exists: true,
            width_cm: w.dimensions?.w ?? null,
            height_cm: w.dimensions?.h ?? null,
            depth_cm: w.dimensions?.d ?? null,
          },
          digital: { minted: false, chain: 'ethereum', standard: 'ERC-721', image: w.image || null },
          edition: w.edition && w.edition !== '1/1' ? { type: 'edition', label: w.edition } : null,
          notes_internal: undefined,
          added: w.added || null,
        };
      });
    const cfg = (index && index.config) || {};
    return {
      ...meta, ...col, works,
      ...(meta.framing ? { framing: true, framing_fee_nzd: cfg.framing_fee_nzd, framing_fee_quoted: cfg.framing_fee_quoted } : {}),
    };
  },

  async collection(slug) {
    if (slug === 'recent-work' && !this._collections[slug]) {
      const [src, index, state] = await Promise.all([
        fetch('/data/source/recent-work.json').then((r) => r.json()),
        this.index(),
        this.state(),
      ]);
      const col = this.shapeRecent(src, index);
      col.works = col.works.map((w) => this.applyState(w, state));
      this._collections[slug] = col;
      return col;
    }
    if (!this._collections[slug]) {
      const [col, state] = await Promise.all([
        fetch(`/data/c/${slug}.json`).then((r) => r.json()),
        this.state(),
      ]);
      col.works = (col.works || []).map((w) => this.applyState(w, state));
      if (col.children) {
        for (const ch of col.children) ch.works = (ch.works || []).map((w) => this.applyState(w, state));
      }
      this._collections[slug] = col;
    }
    return this._collections[slug];
  },

  async work(id) {
    const idx = await this.index();
    let slug = idx.work_index[id];
    // a work published from the studio is not in the generated index yet
    if (!slug) {
      const recent = await this.collection('recent-work').catch(() => null);
      const hit = recent && (recent.works || []).find((w) => w.id === id);
      if (hit) return { work: hit, collection: recent };
      return null;
    }
    const col = await this.collection(slug);
    let work = (col.works || []).find((w) => w.id === id);
    if (!work && col.children) {
      for (const ch of col.children) {
        const hit = (ch.works || []).find((w) => w.id === id);
        if (hit) { work = hit; work._child = ch; break; }
      }
    }
    return work ? { work, collection: col } : null;
  },

  /* ---------- assets ---------- */
  // local assets win when present, chain metadata is the fallback
  // R2 first when it holds the master, then a reliable mirror of the same bytes,
  // then whatever the chain metadata points at
  // A raw hash inside a data URI is read as a fragment, so the browser throws
  // away everything after it and the picture never arrives. Costly to find, so
  // it gets caught here rather than trusted upstream.
  safeData(url) {
    if (typeof url !== 'string' || !url.startsWith('data:')) return url;
    const comma = url.indexOf(',');
    if (comma < 0) return url;
    return url.slice(0, comma + 1) + url.slice(comma + 1).replace(/#/g, '%23');
  },

  imageUrl(work) {
    if (work.assets && work.assets.image) return `${ASSETS_BASE}/${work.assets.image}`;
    // image_source is a URL to the same bytes somewhere more reliable; anything
    // that is not a URL is a credit and must not be treated as one
    const src = work.digital?.image_source;
    if (typeof src === 'string' && /^(https?:)?\/\//.test(src)) return src;
    return work.digital?.image || work.image || null;
  },
  // where the bytes actually live according to the chain, ignoring our mirror.
  // R2 is a convenience; this is the work.
  originUrl(work) {
    const src = work.digital?.image_source;
    if (typeof src === 'string' && /^(https?:)?\/\//.test(src)) return src;
    return this.safeData(work.digital?.image || work.image || null);
  },

  originAnimationUrl(work) {
    return work.digital?.animation || null;
  },

  // hosts that already serve sized images, or that the proxy cannot reach
  THUMB_BYPASS: ['lh3.googleusercontent.com', 'highlight-creator-assets.highlight.xyz'],

  // grids ask for a width, masters are far too heavy to browse
  thumbUrl(work, width) {
    // a display copy is already the right size, sending it through a resizer
    // would only add a hop
    if (work.assets && work.assets.display) return `${ASSETS_BASE}/${work.assets.display}`;
    if (work.assets && work.assets.thumb) return `${ASSETS_BASE}/${work.assets.thumb}`;
    const url = this.imageUrl(work);
    if (!url) return null;
    if (!THUMB_PROXY || url.startsWith('data:') || url.startsWith('/')) return url;
    if (this.isVideo(url)) return url;   // a proxy cannot make a still of a film
    if (this.THUMB_BYPASS.some((h) => url.includes(h))) return url;
    return THUMB_PROXY
      .replace('{url}', encodeURIComponent(url.replace(/^https?:\/\//, '')))
      .replace('{w}', String(width || 600));
  },

  isVideo(url) {
    return typeof url === 'string' && /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
  },

  isSVG(url) {
    if (typeof url !== 'string') return false;
    return /\.svg(\?|#|$)/i.test(url) || url.startsWith('data:image/svg+xml');
  },

  // The hero should show a work the way its own page does: a living SVG plays,
  // a film plays, and everything else is a picture. Otherwise the front page
  // advertises a still of something that moves.
  heroMedia(work, opts) {
    const o = opts || {};
    const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
    const anim = this.animationUrl(work);
    const master = this.imageUrl(work);
    // a film that is not already what imageUrl returns still belongs on the hero
    if (anim && this.isVideo(anim) && !this.isVideo(master)) {
      const origin = this.originAnimationUrl(work);
      const chain = [this.masterAnimationUrl(work), origin]
        .filter((u, i, a) => u && u !== anim && a.indexOf(u) === i);
      return `<video src="${this.escape(anim)}" aria-label="${alt}" class="in"`
        + (chain.length ? ` data-fallback="${this.escape(chain.join(' | '))}"` : '')
        + ` autoplay muted loop playsinline preload="metadata" onerror="MF.mediaFallback(this)"></video>`;
    }
    return this.img(work, o.width || 1600, { ...o, eager: true, live: true, alt: o.alt });
  },

  /* ---------- packing ----------
     Justified rows fill greedily in order, which always leaves the last row
     short. Given that the order of a wall is a composition rather than a
     chronology, the works are dealt into rows instead: pick how many rows the
     set wants at the target height, then balance the ratios across them so
     every row fills the measure. Chronology yields to composition. */
  pack(items, width, opts) {
    const o = opts || {};
    const target = o.target || 340;
    const gutter = o.gutter == null ? 10 : o.gutter;
    const maxPerRow = o.maxPerRow || 5;
    const list = items.map((it, i) => ({ ...it, _i: i, _a: it.aspect > 0 ? it.aspect : 1 }));
    if (!list.length) return [];

    const totalAspect = list.reduce((n, it) => n + it._a, 0);
    // a row of aspect sum s sits at height (width - gutters) / s, so the set
    // wants about this many rows to land near the target height
    let rowCount = Math.max(1, Math.round((totalAspect * target) / width));
    rowCount = Math.min(rowCount, Math.ceil(list.length / 1), Math.max(1, Math.ceil(list.length / 1)));
    // never ask for more rows than there are works, or fewer than fit per row
    rowCount = Math.max(rowCount, Math.ceil(list.length / maxPerRow));
    rowCount = Math.min(rowCount, list.length);

    // deal the widest first into whichever row is currently narrowest, which
    // balances the ratio sums and so evens the heights
    const rows = Array.from({ length: rowCount }, () => ({ items: [], sum: 0 }));
    for (const it of [...list].sort((a, b) => b._a - a._a)) {
      const open = rows.filter((r) => r.items.length < maxPerRow);
      const into = (open.length ? open : rows).reduce((a, b) => (a.sum <= b.sum ? a : b));
      into.items.push(it);
      into.sum += it._a;
    }

    const packed = rows.filter((r) => r.items.length).map((r) => {
      // within a row keep the order the works came in, so it is not sorted by
      // shape on the page
      const inRow = r.items.sort((a, b) => a._i - b._i);
      const height = (width - gutter * (inRow.length - 1)) / r.sum;
      return { items: inRow, height, sum: r.sum };
    });
    // rows in the order their earliest work came in
    packed.sort((a, b) => a.items[0]._i - b.items[0]._i);

    return packed.map((r) => {
      // a row that would have to be wildly taller or shorter than the rest is
      // not worth forcing to the full width; it keeps the target and centres
      const wild = r.height > target * 1.7 || r.height < target * 0.55;
      const height = wild ? Math.min(target, r.height) : r.height;
      return {
        items: r.items.map((it) => ({ ...it, w: it._a * height, h: height })),
        height,
        centre: wild,
      };
    });
  },

  /* ---------- justified rows ----------
     Cropping a painting to a square is a decision about the painting. These
     rows keep every ratio and solve for a shared height instead: fill a row
     until it is wide enough, then scale that row to the exact width. */
  justify(items, width, opts) {
    const o = opts || {};
    const target = o.target || 340;
    const gutter = o.gutter == null ? 10 : o.gutter;
    const maxPerRow = o.maxPerRow || 5;
    const rows = [];
    let row = [];
    let sum = 0;
    for (const it of items) {
      const a = it.aspect > 0 ? it.aspect : 1;
      row.push(it);
      sum += a;
      const height = (width - gutter * (row.length - 1)) / sum;
      if (height <= target || row.length >= maxPerRow) {
        // A row of one would otherwise be stretched to the full measure, which
        // for a portrait work means something taller than the screen.
        rows.push({ items: row, height: o.capHeight ? Math.min(target, height) : height });
        row = [];
        sum = 0;
      }
    }
    // a last short row keeps the target height rather than stretching to fill,
    // which would blow one painting up to twice the size of its neighbours
    if (row.length) {
      const height = Math.min(target, (width - gutter * (row.length - 1)) / sum);
      rows.push({ items: row, height, partial: true });
    }
    return rows.map((r) => ({
      ...r,
      items: r.items.map((it) => ({ ...it, w: (it.aspect > 0 ? it.aspect : 1) * r.height, h: r.height })),
    }));
  },

  /* ---------- a composed block ----------
     One primary on the left carrying the full height, a column of works
     stacked on its right whose heights sum to the same. Solved rather than
     guessed: with primary ratio p, gutter g and column ratios a[], the column
     width r satisfies r * sum(1/a) = H - g*(n-1), and p*H + g + r = W. */
  composed(primary, supporting, width, opts) {
    const o = opts || {};
    const g = o.gutter == null ? 10 : o.gutter;
    const p = primary.aspect > 0 ? primary.aspect : 1;
    const a = supporting.map((s) => (s.aspect > 0 ? s.aspect : 1));
    const k = a.reduce((n, x) => n + 1 / x, 0);
    const gaps = g * (a.length - 1);
    let H = (width - g + (gaps * 1) / k) / (p + 1 / k);
    if (o.maxHeight && H > o.maxHeight) H = o.maxHeight;
    const r = (H - gaps) / k;
    return {
      height: H,
      primary: { ...primary, w: p * H, h: H },
      column: supporting.map((s, i) => ({ ...s, w: r, h: r / a[i] })),
      width: p * H + g + r,
      gutter: g,
    };
  },

  // the block as markup, with a stacked fallback the CSS takes over on a phone
  paintComposed(el, primary, supporting, opts) {
    if (!el || !primary) return;
    const o = opts || {};
    const draw = () => {
      const cs = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      if (!(width > 0)) return;
      const stack = width < (o.stackBelow || 760);
      if (stack) {
        el.classList.add('block-stacked');
        el.innerHTML = [primary, ...supporting].map((it) => this.blockItem(it, null, width)).join('');
      } else {
        el.classList.remove('block-stacked');
        const b = this.composed(primary, supporting, width, o);
        el.innerHTML = `<div class="cblock" style="gap:${b.gutter}px">`
          + `<div class="cprimary">${this.blockItem(b.primary, b.primary.w, b.primary.h)}</div>`
          + `<div class="ccol" style="gap:${b.gutter}px">`
          + b.column.map((it) => this.blockItem(it, it.w, it.h)).join('')
          + `</div></div>`;
      }
      this.progress.watch(el);
    };
    draw();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  },

  blockItem(it, w, h) {
    const title = this.escape(it.title || 'Untitled');
    const href = it.id ? `/w/${encodeURIComponent(it.id)}` : null;
    const size = w ? ` style="width:${w.toFixed(2)}px"` : '';
    const shot = w
      ? `<div class="jshot" style="width:${w.toFixed(2)}px;height:${h.toFixed(2)}px">`
      : `<div class="jshot" style="aspect-ratio:${it.aspect > 0 ? it.aspect : 1}">`;
    const inner = `${shot}${this.img(it, Math.round((w || 900) * 2), { alt: it.title })}</div>`
      + `<div class="jcap">${title}</div>`;
    return href
      ? `<a class="jitem"${size} href="${href}">${inner}</a>`
      : `<div class="jitem"${size}>${inner}</div>`;
  },

  // Four works from the vault, no two the same piece. The vault holds editions,
  // so without the same collapse the page shows one artwork four times.
  async vaultPreview(n) {
    const col = await fetch('/data/c/the-vault.json').then((r) => r.json()).catch(() => null);
    if (!col) return [];
    const norm = (t) => (t || '').replace(/\s*#\s*\d+(\s*\/\s*\d+)?\s*$/, '').trim().toLowerCase();
    const want = n || 4;
    const seenPiece = new Set();
    const seenImage = new Set();
    const seenSet = new Set();
    const first = [];
    const rest = [];
    for (const w of col.works || []) {
      const image = w.assets && (w.assets.display || w.assets.image) ? (w.assets.display || w.assets.image) : w.image;
      if (!image) continue;
      const piece = `${norm(w.display_title || w.title)}|${w.image || ''}`;
      if (seenPiece.has(piece) || seenImage.has(image)) continue;
      seenPiece.add(piece);
      seenImage.add(image);
      // a preview of a vault should look like a vault, not like one collection
      // three times over
      const set = String(w.id || '').replace(/-\d+$/, '') || 'other';
      if (!seenSet.has(set)) { seenSet.add(set); first.push(w); }
      else rest.push(w);
    }
    return [...first, ...rest].slice(0, want);
  },

  // Paint a set of works as justified rows into an element, and keep them
  // justified when the window changes.
  paintRows(el, works, opts) {
    if (!el) return;
    const o = opts || {};
    const draw = () => {
      // the box has padding, and the rows are laid out inside it, so solving
      // for clientWidth overshoots by exactly that padding
      const cs = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      if (!(width > 0)) return;
      const gutter = o.gutter == null ? 10 : o.gutter;
      const target = width < 700 ? (o.targetSmall || 200) : (o.target || 340);
      // packing is the rule: rows are filled by composition rather than by the
      // order works happen to have been added
      const rows = o.mode === 'justify'
        ? this.justify(works, width, { ...o, target, gutter })
        : this.pack(works, width, { ...o, target, gutter });
      el.innerHTML = rows.map((r) => `<div class="jrow${o.center || r.centre ? ' jcentre' : ''}" style="gap:${gutter}px">`
        + r.items.map((it) => {
          const href = it.id ? `/w/${encodeURIComponent(it.id)}` : null;
          const title = this.escape(it.title || 'Untitled');
          const inner = `<div class="jshot" style="width:${it.w.toFixed(2)}px;height:${it.h.toFixed(2)}px">`
            + this.img(it, Math.round(it.w * 2), { alt: it.title })
            + `</div><div class="jcap">${title}</div>`;
          return href
            ? `<a class="jitem" style="width:${it.w.toFixed(2)}px" href="${href}">${inner}</a>`
            : `<div class="jitem" style="width:${it.w.toFixed(2)}px">${inner}</div>`;
        }).join('')
        + '</div>').join('');
      this.progress.watch(el);
    };
    draw();
    // rows are solved for a width, so they have to be solved again when it moves
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  },

  /* The site designs, painted as the horizontal bands they are.
     A strip painting is a wall's width of colour and nothing else, so it takes
     the full measure and stacks, rather than being packed into a row beside
     photographs of rooms. The caption under each one is its spec, in mono. */
  stripBands(el, works, opts) {
    if (!el) return;
    const o = opts || {};
    el.innerHTML = (works || []).map((w) => {
      const ratio = w.aspect > 0 ? w.aspect : 4;
      const href = w.id && o.link !== false ? `/w/${encodeURIComponent(w.id)}` : null;
      const cap = this.escape(w.caption || w.title || '');
      const inner = `<div class="bshot" style="aspect-ratio:${ratio}">`
        + this.img(w, o.width || 2000, { alt: w.title })
        + `</div>${cap ? `<div class="bcap">${cap}</div>` : ''}`;
      return href
        ? `<a class="band" href="${href}">${inner}</a>`
        : `<div class="band">${inner}</div>`;
    }).join('');
    this.progress.watch(el);
  },

  // one tile of a vaulted work, which is a record rather than an offer
  vaultTile(w) {
    const title = (w.display_title || w.title || 'Untitled').trim();
    const shaped = { digital: { image: w.image }, assets: w.assets, title };
    const href = w.id ? `/w/${encodeURIComponent(w.id)}` : '/vault';
    return `<a class="card" href="${href}">
      <div class="shot">${this.img(shaped, 600, { alt: title })}</div>
      <div class="t">${this.escape(title)}</div>
      <div class="m"><span><span class="dot vaulted"></span> Vaulted</span></div>
    </a>`;
  },

  // an <img> that falls back to the master if the thumbnail source fails
  img(work, width, opts) {
    const o = opts || {};
    const thumb = this.thumbUrl(work, width);
    if (!thumb) return '';
    const master = this.imageUrl(work);
    // The animated version is the work, so the work page loads the SVG itself and
    // lets its own stylesheet run. If that source is unreachable, the browser
    // renders the child instead: a proxied still, which is the fallback, not the
    // default.
    // some works are a video rather than a picture of one
    if (this.isVideo(master)) {
      const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
      const light = work.assets && work.assets.animation_display
        ? `${ASSETS_BASE}/${work.assets.animation_display}` : master;
      const vChain = [master, this.masterAnimationUrl(work), this.originAnimationUrl(work), this.originUrl(work)]
        .filter((u, i, a) => u && u !== light && a.indexOf(u) === i);
      const vFallback = vChain.length ? ` data-fallback="${this.escape(vChain.join(' | '))}"` : '';
      return `<video src="${this.escape(light)}" aria-label="${alt}" class="in"${vFallback}`
        + ` controls playsinline loop preload="metadata"${o.eager ? ' autoplay muted' : ''}`
        + ` onerror="MF.mediaFallback(this)"></video>`;
    }
    if (o.live && this.isSVG(master)) {
      const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
      const ratio = work.digital && work.digital.aspect_ratio;
      const svgOrigin = this.originUrl(work);
      const inner = svgOrigin && svgOrigin !== master
        ? `<object type="image/svg+xml" data="${this.escape(svgOrigin)}" aria-label="${alt}" class="live">`
          + `<img src="${this.escape(thumb)}" alt="${alt}" loading="eager" decoding="async" onload="this.classList.add('in')">`
          + `</object>`
        : `<img src="${this.escape(thumb)}" alt="${alt}" loading="eager" decoding="async" onload="this.classList.add('in')">`;
      return `<object type="image/svg+xml" data="${this.escape(master)}" aria-label="${alt}" class="live"${ratio ? ` style="aspect-ratio:${this.escape(ratio)}"` : ''}>`
        + inner
        + `</object>`;
    }
    const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
    // display copy, then the master we mirrored, then wherever the chain says
    // it lives. Losing R2 should cost speed, not the picture.
    const chain = [master, this.originUrl(work)]
      .filter((u, i, a) => u && u !== thumb && a.indexOf(u) === i);
    const fallback = chain.length ? ` data-fallback="${this.escape(chain.join(' | '))}"` : '';
    return `<img src="${this.escape(thumb)}" alt="${alt}"${fallback}`
      + ` loading="${o.eager ? 'eager' : 'lazy'}" decoding="async"`
      + (o.eager ? ' fetchpriority="high"' : '')
      + ` onload="this.classList.add('in')" onerror="MF.imgFallback(this)"${o.cls ? ` class="${o.cls}"` : ''}>`;
  },

  // walks the chain one step at a time, so each source gets its own attempt
  nextSource(el) {
    const left = (el.getAttribute('data-fallback') || '').split(' | ').filter(Boolean);
    const next = left.shift();
    if (!next) { el.removeAttribute('data-fallback'); return null; }
    if (left.length) el.setAttribute('data-fallback', left.join(' | '));
    else el.removeAttribute('data-fallback');
    return next;
  },

  mediaFallback(el) {
    const next = this.nextSource(el);
    if (next) el.src = next;
  },

  imgFallback(el) {
    const next = this.nextSource(el);
    if (next) {
      el.src = next;
      return;
    }
    const shot = el.parentElement;
    el.remove();
    if (shot && shot.classList.contains('shot')) shot.classList.add('empty');
  },

  animationUrl(work) {
    // the transcoded copy starts playing straight away, the master does not
    if (work.assets && work.assets.animation_display) return `${ASSETS_BASE}/${work.assets.animation_display}`;
    if (work.assets && work.assets.animation) return `${ASSETS_BASE}/${work.assets.animation}`;
    return work.digital?.animation || null;
  },

  // the master film, for the fallback chain
  masterAnimationUrl(work) {
    if (work.assets && work.assets.animation) return `${ASSETS_BASE}/${work.assets.animation}`;
    return work.digital?.animation || null;
  },

  /* ---------- zoom ----------
     A painting is brushwork, and a 700px thumbnail is not the work. Clicking
     the art opens it on the same paper the site is made of: no dark overlay,
     no chrome, no caption. The image, and the room it needs. */
  zoom: {
    el: null, img: null, work: null,
    scale: 1, min: 1, max: 8, x: 0, y: 0,
    _drag: null, _pinch: null, _lastTap: 0, _lastAt: null, _moved: false,

    // the largest copy worth sending. A master can be ninety megabytes, so its
    // size is asked for before it is fetched.
    CAP_BYTES: 24 * 1024 * 1024,

    mount() {
      if (this.el) return this.el;
      const d = document.createElement('div');
      d.className = 'zoom';
      d.setAttribute('aria-hidden', 'true');
      d.innerHTML = '<img alt="">';
      document.body.appendChild(d);
      this.el = d;
      this.img = d.querySelector('img');
      this.wire();
      return d;
    },

    /* A picture that is not a work.
       The lightbox was built for the catalogue, where an image is one of many
       sizes of a known thing. A photograph somebody put in the room is one
       size of an unknown thing, and it opens the same way on the same paper,
       because that is what the lightbox is for. */
    show(src, alt) {
      this.mount();
      this.work = null;
      this.scale = 1; this.x = 0; this.y = 0;
      this.img.src = src;
      this.img.alt = alt || '';
      this.apply();
      this.el.classList.add('on');
      this.el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('zooming');
      document.body.style.overflow = 'hidden';
    },

    async open(work, from) {
      this.mount();
      this.work = work;
      this.scale = 1; this.x = 0; this.y = 0;
      // whatever is already on screen shows instantly, from cache
      this.img.src = from || MF.thumbUrl(work, 1600) || MF.imageUrl(work);
      this.img.alt = work.title || 'Work by MintFace';
      this.apply();
      this.el.classList.add('on');
      this.el.setAttribute('aria-hidden', 'false');
      /* The nav goes with it. The work is the whole screen in here, and the one
         thing a bar that is always present must never do is sit over art. It is
         held in place rather than removed, so nothing reflows underneath while
         the page is covered. */
      document.body.classList.add('zooming');
      document.body.style.overflow = 'hidden';
      const big = this.best(work);
      // still the same work, and worth swapping for
      if (big && this.el.classList.contains('on') && this.work === work && big !== this.img.src) {
        const pre = new Image();
        pre.onload = () => {
          if (this.el.classList.contains('on') && this.work === work) this.img.src = big;
        };
        pre.src = big;
      }
    },

    /* The biggest copy worth sending, decided without asking the bucket
       anything: assets.mintface.art answers no CORS headers, so a HEAD from
       here is refused and an image load is not.

       A work photographed for the studio has one file in R2 and it is already
       web sized, so it is sent whole. A work mirrored from chain has its master
       there, and a master can be ninety megabytes, so its detail comes through
       the resizer at a size a screen can use. */
    best(work) {
      const a = work.assets || {};
      if (a.image) {
        const master = `${ASSETS_BASE}/${a.image}`;
        if (MF.isVideo(master) || MF.isSVG(master)) return null;
        return MF.thumbUrl({ ...work, assets: { ...a, display: null, thumb: null } }, 3000);
      }
      const own = MF.imageUrl(work);
      if (!own || own.startsWith('data:') || MF.isVideo(own) || MF.isSVG(own)) return null;
      return own;
    },

    close() {
      if (!this.el) return;
      this.el.classList.remove('on', 'zoomed');
      this.el.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('zooming');
      document.body.style.overflow = '';
      this.work = null;
      // back to rest, so the next work does not open half zoomed and off centre
      this.scale = 1; this.x = 0; this.y = 0;
      this.img.style.transform = '';
      this.img.removeAttribute('src');
    },

    apply() {
      this.img.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
      this.el.classList.toggle('zoomed', this.scale > 1.01);
    },

    // zoom about a point, so the thing under the finger stays under the finger
    to(scale, cx, cy) {
      const next = Math.max(this.min, Math.min(this.max, scale));
      const r = this.el.getBoundingClientRect();
      const px = cx - r.width / 2 - this.x;
      const py = cy - r.height / 2 - this.y;
      const k = next / this.scale;
      this.x -= px * (k - 1);
      this.y -= py * (k - 1);
      this.scale = next;
      if (this.scale <= 1.01) { this.x = 0; this.y = 0; this.scale = 1; }
      this.apply();
    },

    wire() {
      const el = this.el;

      // a click on the ground closes; a drag that happens to end on the ground
      // is not a click, and closing on it would make panning unusable
      el.addEventListener('click', (ev) => {
        if (this._moved) { this._moved = false; return; }
        if (ev.target === el) this.close();
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && this.el && this.el.classList.contains('on')) this.close();
      });

      el.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        this.to(this.scale * (ev.deltaY < 0 ? 1.14 : 1 / 1.14), ev.clientX, ev.clientY);
      }, { passive: false });

      el.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'touch') return;
        this._drag = { x: ev.clientX, y: ev.clientY, ox: this.x, oy: this.y, moved: false };
        el.setPointerCapture(ev.pointerId);
      });
      el.addEventListener('pointermove', (ev) => {
        if (ev.pointerType === 'touch') return;
        if (!this._drag) return;
        const dx = ev.clientX - this._drag.x;
        const dy = ev.clientY - this._drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { this._drag.moved = true; this._moved = true; }
        if (this.scale > 1.01) { this.x = this._drag.ox + dx; this.y = this._drag.oy + dy; this.apply(); }
      });
      el.addEventListener('pointerup', (ev) => {
        // touch has its own handlers below. Without this the pointer path
        // consumes the drag that touchstart set and zooms in, and the double
        // tap that follows then zooms straight back out.
        if (ev.pointerType === 'touch') return;
        const d = this._drag;
        this._drag = null;
        // a click on the picture that was not a drag closes at rest, zooms otherwise
        if (d && !d.moved && ev.target === this.img && this.scale <= 1.01) {
          this.to(2.4, ev.clientX, ev.clientY);
        }
      });

      // touch: pinch to zoom, one finger to pan, double tap to zoom to a point
      el.addEventListener('touchstart', (ev) => {
        if (ev.touches.length === 2) {
          const [a, b] = ev.touches;
          this._pinch = {
            d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            s: this.scale,
            cx: (a.clientX + b.clientX) / 2,
            cy: (a.clientY + b.clientY) / 2,
          };
        } else if (ev.touches.length === 1) {
          const t = ev.touches[0];
          this._drag = { x: t.clientX, y: t.clientY, ox: this.x, oy: this.y, moved: false };
          // a double tap is two taps close in time and in place. Three
          // hundred milliseconds is tighter than a thumb, and without the
          // distance check two taps at opposite corners would count as one.
          const now = Date.now();
          const near = this._lastAt
            && Math.hypot(t.clientX - this._lastAt.x, t.clientY - this._lastAt.y) < 44;
          if (now - this._lastTap < 400 && near) {
            ev.preventDefault();
            this.to(this.scale > 1.01 ? 1 : 2.6, t.clientX, t.clientY);
            this._lastTap = 0;
            this._lastAt = null;
            this._drag = null;
          } else {
            this._lastTap = now;
            this._lastAt = { x: t.clientX, y: t.clientY };
          }
        }
      }, { passive: false });

      el.addEventListener('touchmove', (ev) => {
        if (this._pinch && ev.touches.length === 2) {
          ev.preventDefault();
          const [a, b] = ev.touches;
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          this.to(this._pinch.s * (d / this._pinch.d), this._pinch.cx, this._pinch.cy);
        } else if (this._drag && ev.touches.length === 1 && this.scale > 1.01) {
          ev.preventDefault();
          const t = ev.touches[0];
          this.x = this._drag.ox + (t.clientX - this._drag.x);
          this.y = this._drag.oy + (t.clientY - this._drag.y);
          this._drag.moved = true;
          this.apply();
        }
      }, { passive: false });

      el.addEventListener('touchend', (ev) => {
        if (!ev.touches.length) { this._pinch = null; this._drag = null; }
      });
    },
  },

  // A still can be looked into. A film or a living SVG is already doing
  // something, and taking it over would take that away.
  zoomable(work) {
    const url = this.imageUrl(work);
    if (!url) return false;
    if (this.isVideo(url) || this.isSVG(url)) return false;
    if (this.animationUrl(work) && this.isVideo(this.animationUrl(work))) return false;
    return true;
  },

  /* ---------- money ---------- */
  FX_TTL: 60 * 60 * 1000,

  async fx() {
    const cached = JSON.parse(localStorage.getItem('mf_fx') || 'null');
    if (cached && Date.now() - cached.at < this.FX_TTL) return cached;
    const out = { at: Date.now(), usd: null, eth: null };
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/NZD').then((r) => r.json());
      out.usd = r?.rates?.USD || null;
    } catch (e) { /* offline, fall through */ }
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/ETH-NZD/spot').then((r) => r.json());
      const amount = Number(r?.data?.amount);
      if (amount > 0) out.eth = 1 / amount;
    } catch (e) { /* offline, fall through */ }
    if (out.usd || out.eth) localStorage.setItem('mf_fx', JSON.stringify(out));
    return cached && !out.usd && !out.eth ? cached : out;
  },

  money(nzd, currency, fx) {
    if (nzd == null) return null;
    const f = fx || {};
    if (currency === 'NZD') return 'NZ$' + Math.round(nzd).toLocaleString('en-NZ');
    if (currency === 'USD') return f.usd ? 'US$' + Math.round(nzd * f.usd).toLocaleString('en-US') : null;
    if (currency === 'ETH') {
      if (!f.eth) return null;
      const eth = nzd * f.eth;
      // two decimals hides a nine thousandth of an ether, which is a real price here
      const dp = eth >= 1 ? 2 : eth >= 0.1 ? 3 : 4;
      return Number(eth.toFixed(dp)) + ' ETH';
    }
    return null;
  },

  /* ---------- what the viewer is shown ----------
     NZD is what everything is stored and settled in. This is only the currency
     a price is read in, and it follows the viewer from page to page. */
  CURRENCIES: ['USD', 'NZD', 'ETH'],
  DEFAULT_CURRENCY: 'USD',

  currency() {
    try {
      const c = localStorage.getItem('mf_cur');
      return this.CURRENCIES.includes(c) ? c : this.DEFAULT_CURRENCY;
    } catch { return this.DEFAULT_CURRENCY; }
  },

  setCurrency(c) {
    if (!this.CURRENCIES.includes(c)) return;
    try { localStorage.setItem('mf_cur', c); } catch { /* private window, this page only */ }
    window.dispatchEvent(new CustomEvent('mf:currency', { detail: c }));
  },

  // the control itself, so every page offers the same one
  currencyBar(id) {
    const c = this.currency();
    return `<div class="cur" id="${id || 'cur'}" role="group" aria-label="Currency">`
      + this.CURRENCIES.map((x) =>
        `<button data-c="${x}" aria-pressed="${x === c}">${x}</button>`).join('')
      + '</div>';
  },

  // repaint anything carrying a stored NZD figure
  async paintPrices(root) {
    const fx = await this.fx();
    const c = this.currency();
    for (const el of (root || document).querySelectorAll('[data-nzd]')) {
      const nzd = Number(el.dataset.nzd);
      const out = this.money(nzd, c, fx);
      if (out) el.textContent = out;
    }
    return { fx, currency: c };
  },

  // one wiring for every currency control on a page
  wireCurrencyBar(el, after) {
    if (!el) return;
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      this.setCurrency(b.dataset.c);
    });
    window.addEventListener('mf:currency', async (ev) => {
      for (const bar of document.querySelectorAll('.cur')) {
        for (const x of bar.querySelectorAll('button')) {
          x.setAttribute('aria-pressed', String(x.dataset.c === ev.detail));
        }
      }
      await this.paintPrices();
      if (after) after(ev.detail);
    });
  },

  /* ---------- display ---------- */
  STATUS: {
    available: { label: 'Available', dot: 'available' },
    reserved: { label: 'Reserved', dot: 'reserved' },
    pending: { label: 'At the checkout', dot: 'reserved' },
    acquired: { label: 'Collected', dot: 'acquired' },
    vaulted: { label: 'Vaulted', dot: 'vaulted' },
    sold_out: { label: 'Sold out', dot: 'acquired' },
    uninscribed: { label: 'Not yet inscribed', dot: 'uninscribed' },
    // On record, not on offer. No dot: the dots are the site's one green
    // and they say what a work costs to want. This one costs nothing yet.
    not_tokenized: { label: 'Not yet tokenized', dot: '' },
    burned: { label: 'Burned', dot: 'burned' },
  },

  // a release can be sold out and still have works back with the artist
  availability(collection) {
    const c = collection.counts || {};
    const available = c.available || 0;
    const badge = collection.sold_out ? (available ? 'Mint sold out' : 'Sold out') : null;
    return { badge, available };
  },

  // features and the vault have their own pages, everything else is a grid
  ROUTES: { genesis: '/genesis', '2022-10k': '/10k', 'the-vault': '/vault', frogdna: '/c/frogdna' },

  collectionHref(c) {
    return this.ROUTES[c.slug] || `/c/${encodeURIComponent(c.slug)}`;
  },

  collectionCard(c) {
    const e = this.escape;
    // the card is the whole page's weight, so it reads from the mirror too
    const cover = c.cover && (c.cover.image || c.cover.assets)
      ? { digital: { image: c.cover.image }, assets: c.cover.assets || null, title: c.title }
      : null;
    const n = c.counts.works || c.counts.child_works || 0;
    const bits = [c.year, c.genre, `${n} ${n === 1 ? 'work' : 'works'}`].filter(Boolean);
    if (c.counts.editions_minted) bits.push(`${c.counts.editions_minted} editions`);
    const a = this.availability(c);
    return `<a class="card" href="${this.collectionHref(c)}">
      <div class="shot">${cover ? this.img(cover, 600) : ''}</div>
      <div class="t">${e(c.title)}</div>
      <div class="m">
        ${bits.map((b) => `<span>${e(b)}</span>`).join('')}
        ${a.badge ? `<span class="badge">${e(a.badge)}</span>` : ''}
        ${a.available ? `<span><span class="dot available"></span> ${a.available} available</span>` : ''}
      </div>
      ${c.card_statement || c.statement ? `<div class="s">${e(c.card_statement || c.statement)}</div>` : ''}
    </a>`;
  },

  // The record so far, kept here rather than in the page so one edit changes it
  // everywhere it is quoted.
  // non-breaking inside each figure, so a line only ever breaks at a separator
  SALES_LINE: [
    'ATH digital sale 8.2 ETH (328 ed.)',
    'ATH painting sale $5,000 NZD',
    'av. edition 0.03 ETH',
    'av. 1/1 0.3 ETH',
  ].map((s) => s.replace(/ /g, '\u00a0')).join(' \u00b7 '),

  // groups, in the order the catalog gives them, with the locked geodetic run
  groupOrder: {
    core: ['pixelarcade', 'strip-paintings', 'artificial-flowers', 'patrimora', 'frogdna', 'two-burdens', 'recursive-mind', 'hidden-landscapes', 'roads-and-rivers'],
    archive: ['seize-and-share', 'id-please'],
    geodetic: ['geodetic-onchain', 'geodetic-world', 'geodetica', 'geodetic-moments', 'geodetic-home', 'geodetic-memory'],
    studies: ['visual-language', 'panoptic', 'wallet', 'geodetic-illusions'],
    feature: ['genesis', '2022-10k'],
  },

  sortGroup(id, list) {
    const order = this.groupOrder[id];
    if (!order) return list;
    return [...list].sort((a, b) => {
      const ia = order.indexOf(a.slug), ib = order.indexOf(b.slug);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  },

  // The studies were split across two groups for no reason a reader would know.
  // They are four studies.
  STUDIES: { into: 'studies', title: 'Studies', from: ['ai-studies', 'geodetic-studies'] },

  groupsWithCollections(idx) {
    const by = {};
    for (const c of idx.collections) {
      // collector-tracked but not site canon: enumerated into the catalogue so
      // the collector register and the nightly sweep see it, never shown here
      if (c.display === false) continue;
      if (!(c.counts.works || c.counts.child_works)) continue;
      const g = this.STUDIES.from.includes(c.group) ? this.STUDIES.into : c.group;
      (by[g] = by[g] || []).push(c);
    }
    const groups = idx.groups.filter((g) => !this.STUDIES.from.includes(g.id));
    // the merged group sits where the first of its parts used to
    const at = idx.groups.findIndex((g) => this.STUDIES.from.includes(g.id));
    const merged = { id: this.STUDIES.into, title: this.STUDIES.title };
    if (at >= 0) {
      const before = idx.groups.slice(0, at).filter((g) => !this.STUDIES.from.includes(g.id)).length;
      groups.splice(before, 0, merged);
    } else {
      groups.push(merged);
    }
    return groups
      .map((g) => ({ ...g, collections: this.sortGroup(g.id, by[g.id] || []) }))
      .filter((g) => g.collections.length);
  },

  /* ---------- collectors ----------
     A small address -> slug map, so an attribution can link to the collector's
     page without loading the whole collector index to find out whether one
     exists. Someone below the threshold, or on the private list, simply has no
     entry and the name renders as plain text. */
  async collectorSlugs() {
    if (this._slugs !== undefined) return this._slugs;
    try {
      const r = await fetch('/data/collector-slugs.json');
      this._slugs = r.ok ? (await r.json()).slugs || {} : {};
    } catch (e) { this._slugs = {}; }
    return this._slugs;
  },

  collectorUrl(collector, slugs) {
    const a = collector && collector.address;
    const map = slugs || this._slugs;
    if (!a || !map) return null;
    const slug = map[a.toLowerCase()];
    return slug ? `https://collectors.mintface.art/${encodeURIComponent(slug)}` : null;
  },

  /* Names chosen since the catalogue was last built.
   *
   * The catalogue and the register are nightly files, and a name is not a
   * nightly thing: a collector sets one and expects to see it. So the ones set
   * since are published on their own ... a few kilobytes, cached at the edge
   * for half a minute ... and laid over the record the way the live TAO board
   * already is on a collector page.
   *
   * A page that cannot reach it shows the name the record was built with. A
   * little behind, and never wrong in kind. */
  async names() {
    if (this._names !== undefined) return this._names;
    try {
      const r = await fetch('https://mintface.art/api/names', { headers: { accept: 'application/json' } });
      this._names = r.ok ? (await r.json()).names || {} : {};
    } catch (e) { this._names = {}; }
    return this._names;
  },

  /**
   * What to call a collector.
   * The order is the register's, and it is the same everywhere: the name Ryan
   * wrote down, then the name they chose, then their ENS, then the address.
   * @param names  MF.names(), where the caller has awaited it
   */
  collectorName(collector, names) {
    if (!collector) return null;
    const chosen = (names || this._names || {})[String(collector.address || '').toLowerCase()];
    return collector.display_name || chosen || collector.ens || this.shortAddress(collector.address);
  },

  shortAddress(a) {
    return a ? a.slice(0, 6) + '...' + a.slice(-4) : null;
  },

  date(ts, opts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('en-NZ', opts || { day: 'numeric', month: 'long', year: 'numeric' });
  },

  year(work, collection) {
    if (work.year) return String(work.year);
    const m = work.minted_onchain || work.minted || work.digital?.genesis_timestamp;
    if (m) { const y = new Date(m).getFullYear(); if (!isNaN(y)) return String(y); }
    return collection?.year || null;
  },

  /* ---------- live listings ---------- */
  // The listing is the price. Where a work is listed on chain that figure wins
  // over the catalogue's NZD: the catalogue records what a work was offered at,
  // the listing is what someone can actually pay for it this minute. Written by
  // scripts/sync-listings.mjs. A missing or stale file is not an error, the page
  // simply falls back to the catalogue.
  async listings() {
    if (this._listings !== undefined) return this._listings;
    try {
      const r = await fetch('/data/listings.json');
      this._listings = r.ok ? await r.json() : null;
    } catch (e) { this._listings = null; }
    return this._listings;
  },

  listingFor(work, listings) {
    const L = listings || this._listings;
    if (!L || !L.works || !work) return null;
    return L.works[work.id] || null;
  },

  // listings are denominated in ETH; everything downstream thinks in NZD, so the
  // conversion happens once here and the rest of the money code is untouched
  listingNzd(listing, fx) {
    if (!listing || listing.price_eth == null) return null;
    const f = fx || {};
    if (!f.eth) return null;
    return listing.price_eth / f.eth;
  },

  /* ---------- marketplace marks ---------- */
  // The fine-print row at the foot of a work page: collect it where it trades,
  // verify it on chain. Ethereum only, because Etherscan is, and only once
  // there is a token to point at ... an unminted work has nothing to link to.
  marks(work) {
    const d = work.digital || {};
    if (d.chain !== 'ethereum' || !d.contract) return null;
    const isSet = work.token_ids && work.token_ids.length > 1;
    /* A lazy-minted work has no token on chain yet, but it does have a real
       item page: that page is where it is bought, and buying it is what mints
       it. So OpenSea still stands and Etherscan does not ... there is nothing
       there to verify until someone collects it. */
    const unminted = d.minted === false;
    return {
      // a set has no single item page, so both marks fall back to the contract
      opensea: isSet
        ? `https://opensea.io/assets/ethereum/${d.contract}`
        : (d.token_id != null ? `https://opensea.io/item/ethereum/${d.contract}/${d.token_id}` : null),
      etherscan: unminted ? null : (isSet
        ? `https://etherscan.io/token/${d.contract}`
        : `https://etherscan.io/token/${d.contract}?a=${d.token_id}`),
    };
  },

  /* ---------- chain links ---------- */
  links(work) {
    const d = work.digital || {};
    const out = [];
    const isSet = work.token_ids && work.token_ids.length > 1;
    if (d.chain === 'ethereum' && d.contract) {
      out.push(['Etherscan', isSet
        ? `https://etherscan.io/token/${d.contract}`
        : `https://etherscan.io/token/${d.contract}?a=${d.token_id}`]);
      out.push(['OpenSea', isSet
        ? `https://opensea.io/assets/ethereum/${d.contract}`
        : `https://opensea.io/item/ethereum/${d.contract}/${d.token_id}`]);
    }
    if (work.links && work.links.site) out.push(['Project site', work.links.site]);
    if (d.chain === 'bitcoin' && d.inscription_id) {
      out.push(['Ordinals', `https://ordinals.com/inscription/${d.inscription_id}`]);
      out.push(['Gamma', `https://gamma.io/inscription/${d.inscription_id}`]);
    }
    if (d.chain === 'bitcoin' && d.asset) {
      out.push(['Tokenscan', `https://cp20.tokenscan.io/asset/${d.asset}`]);
    }
    if (work.wrapped && work.wrapped.links) {
      if (work.wrapped.links.opensea) out.push(['OpenSea, wrapped', work.wrapped.links.opensea]);
      if (work.wrapped.links.emblem) out.push(['EmblemVault', work.wrapped.links.emblem]);
    }
    if (work.mint_tx && !isSet) out.push(['Mint transaction', `https://etherscan.io/tx/${work.mint_tx}`]);
    return out;
  },

  /* ---------- loading ---------- */
  // A hairline across the top and a small percentage. It counts the artwork,
  // not the page: images are what people wait for here.
  progress: {
    el: null, total: 0, done: 0,

    mount() {
      if (this.el) return this.el;
      const d = document.createElement('div');
      d.className = 'progress';
      d.innerHTML = '<div class="fill"></div><div class="pct"></div>';
      document.body.appendChild(d);
      this.el = d;
      return d;
    },

    watch(root) {
      const imgs = [...(root || document).querySelectorAll('img, object.live, video')];
      // Two things never resolve and would hold the bar open forever: a lazy
      // tile that is not scrolled to yet, and the still inside an <object>,
      // which a browser only loads if the object itself fails.
      const pending = imgs.filter((n) => {
        if (n.loading === 'lazy') return false;
        // anything nested inside an <object> is that object's fallback, and a
        // browser only loads fallback content when the object itself fails
        if (n.parentElement && n.parentElement.closest('object')) return false;
        return !(n.tagName === 'IMG' && n.complete);
      });
      if (!pending.length) return;
      this.mount().classList.add('on');
      this.total = pending.length;
      this.done = 0;
      this.paint();
      for (const n of pending) {
        const tick = () => this.tick();
        n.addEventListener('load', tick, { once: true });
        n.addEventListener('error', tick, { once: true });
        if (n.tagName === 'VIDEO') n.addEventListener('loadeddata', tick, { once: true });
      }
      // never leave the bar hanging on a source that answers slowly
      clearTimeout(this._giveUp);
      this._giveUp = setTimeout(() => this.finish(), 8000);
    },

    tick() {
      this.done += 1;
      this.paint();
      if (this.done >= this.total) setTimeout(() => this.finish(), 260);
    },

    paint() {
      if (!this.el) return;
      const pct = this.total ? Math.min(100, Math.round((this.done / this.total) * 100)) : 0;
      this.el.querySelector('.fill').style.width = pct + '%';
      this.el.querySelector('.pct').textContent = pct + '%';
    },

    finish() {
      clearTimeout(this._giveUp);
      if (!this.el) return;
      this.el.querySelector('.fill').style.width = '100%';
      this.el.querySelector('.pct').textContent = '';
      this.el.classList.remove('on');
      this.total = this.done = 0;
    },
  },


  /* ---------- wallet signing ----------
     Three features on this site ask a wallet to sign a sentence: the nudges,
     the notes and the room. They all come through here, because everything
     that goes wrong with signing goes wrong the same way for all three.

     Two things this does that a bare request does not.

     The message is hex-encoded first. personal_sign is specified to take hex,
     and MetaMask happens to accept a UTF-8 string and convert it, which is why
     handing it one appears to work. Anything relaying the call rather than
     handling it ... WalletConnect, a hardware bridge, a wallet behind another
     wallet ... is under no obligation to guess, and a request that cannot be
     decoded is a request that never reaches the device. The bytes signed are
     identical either way, so nothing the server verifies changes.

     And it says when it is waiting. A hardware wallet can sit on a request for
     half a minute, or forever if its prompt opened behind something, and a
     button that has gone quiet is indistinguishable from a button that is
     broken. The caller is told the moment the request goes out, told again if
     the wallet has said nothing for a while, and told exactly what happened if
     it refuses. */
  toHex(text) {
    const bytes = new TextEncoder().encode(String(text));
    let out = '0x';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  },

  /* ---------- saying how it went ----------
   *
   * Every wallet step reports its outcome, and a failure may never leave the
   * page looking exactly as it did before. That rule is written here because
   * three separate features broke it in the same way and each looked like a
   * different bug: Studio's artist gate, a room that could not read a wallet's
   * standing, and "Is this you?" on a collector page ... which set its reason
   * into a line that only exists while the name editor is open, and threw it
   * away every other time. What a person sees in all three is a button that
   * does nothing, so they press it again. That is the loop.
   *
   * The hole was always the same shape: a page holding a message with nowhere
   * to put it. So the line is not something a page may forget to draw. Draw one
   * and this writes into it; draw none and this puts one where the message
   * belongs. A page chooses where its reasons appear, never whether they do.
   *
   * @param host  the element the line lives in, or its id
   * @param text  what happened, in one line. Empty clears it.
   */
  say(host, text, bad) {
    if (typeof document === 'undefined') return false;
    const at = typeof host === 'string' ? document.getElementById(host) : host;
    if (!at) return false;
    let el = at.matches && at.matches('[data-say]') ? at : at.querySelector('[data-say]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-say', '');
      at.appendChild(el);
    }
    el.textContent = text || '';
    el.className = `said${bad ? ' bad' : ''}`;
    el.hidden = !text;
    return true;
  },

  /**
   * @param message  the sentence, as the server will rebuild it
   * @param address  the wallet, lowercased
   * @param onState  (state, detail) => void ... 'requested' | 'slow' | 'signed' | 'failed'
   */
  async sign(message, address, onState = () => {}) {
    /* The provider we connected through, not whatever holds window.ethereum by
       now. With two extensions installed those are routinely not the same
       object, and a signature sent to the one that does not hold the account is
       a request that goes out and never comes back. */
    const provider = (this._wallet && this._wallet.provider) || (typeof window !== 'undefined' ? window.ethereum : null);
    if (!provider) {
      const e = new Error('No wallet is answering in this browser.');
      onState('failed', e.message);
      throw e;
    }
    const data = this.toHex(message);
    onState('requested');
    // a hardware wallet is slow, and a prompt that opened behind the window is
    // slower still. Say so rather than letting it read as a dead button.
    const slow = setTimeout(() => onState('slow'), 12000);
    try {
      const signature = await provider.request({ method: 'personal_sign', params: [data, address] });
      if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
        const e = new Error('The wallet answered without a signature.');
        e.code = 'no-signature';
        throw e;
      }
      onState('signed');
      return signature;
    } catch (err) {
      // EIP-1193 says what happened; wallets are inconsistent about the text
      const code = err && (err.code ?? (err.data && err.data.code));
      const why = code === 'no-signature' ? err.message
        : code === 4001 ? 'Signature refused in the wallet.'
        : code === -32002 ? 'The wallet already has a request waiting. Open it and answer that one first.'
          : code === 4900 || code === 4100 ? 'The wallet is not connected to this site. Reconnect and try again.'
            : `The wallet could not sign: ${String((err && err.message) || err).slice(0, 160)}`;
      onState('failed', why);
      const out = new Error(why);
      out.code = code;
      throw out;
    } finally {
      clearTimeout(slow);
    }
  },

  /* ---------- finding the wallet ----------
     window.ethereum is a single slot and every extension wants it. Install two
     and they fight: one wins, one wraps the other, and the loser's accounts are
     unreachable through a name that looks like it should work. A request sent
     to the wrong provider does not error ... it goes somewhere and never comes
     back, which is exactly what a dead button looks like.

     EIP-6963 exists for this. Instead of reading the slot, we ask the page and
     every wallet that is listening announces itself, so two wallets are two
     entries rather than one collision. window.ethereum stays as the fallback
     for anything too old to answer, and if nothing answers at all we can say
     that plainly rather than guessing. */
  _found: null,

  listenForWallets() {
    if (this._found) return this._found;
    const found = new Map();
    this._found = found;
    try {
      window.addEventListener('eip6963:announceProvider', (ev) => {
        const d = ev && ev.detail;
        if (d && d.info && d.provider) found.set(d.info.uuid || d.info.rdns, d);
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch (e) { /* an old browser, or none of this exists ... the fallback covers it */ }
    return found;
  },

  /** What an injected provider calls itself, for a legible choice. */
  walletName(p) {
    if (!p) return 'a wallet';
    if (p.isRabby) return 'Rabby';
    if (p.isMetaMask) return 'MetaMask';
    if (p.isCoinbaseWallet) return 'Coinbase Wallet';
    if (p.isBraveWallet) return 'Brave Wallet';
    if (p.isRainbow) return 'Rainbow';
    if (p.isTrust || p.isTrustWallet) return 'Trust';
    if (p.isFrame) return 'Frame';
    if (p.isPhantom) return 'Phantom';
    return 'an injected wallet';
  },

  /** Every wallet that answered, newest standard first, the old slot last. */
  async wallets() {
    const found = this.listenForWallets();
    // announcements arrive on the next turn, and a slow extension on the one
    // after that
    await new Promise((r) => setTimeout(r, 150));
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* fine */ }
    await new Promise((r) => setTimeout(r, 150));
    const list = [...found.values()];
    if (list.length) return list;
    const slot = typeof window !== 'undefined' ? window.ethereum : null;
    if (!slot) return [];
    /* Some extensions stack themselves under window.ethereum.providers rather
       than announcing. It is the older convention and worth reading. */
    const stacked = Array.isArray(slot.providers) ? slot.providers : [slot];
    return stacked.map((p, i) => ({
      info: { uuid: `injected-${i}`, rdns: 'window.ethereum', name: this.walletName(p) },
      provider: p,
    }));
  },

  /* Who is here, without asking anybody anything.
     eth_accounts prompts nothing: a wallet already connected to this site
     answers, and one that is not returns an empty list. It is the only way a
     page can know whether to offer a writer their pen before they have said
     they want it ... and offering it only to people who can use it is the
     difference between an affordance and an advertisement. */
  async knownAccount() {
    try {
      const list = await this.wallets();
      for (const w of list) {
        try {
          const accounts = await w.provider.request({ method: 'eth_accounts' });
          if (accounts && accounts[0]) { this._wallet = w; return String(accounts[0]).toLowerCase(); }
        } catch (e) { /* a provider that will not answer is not the one */ }
      }
    } catch (e) { /* no wallet here at all */ }
    return null;
  },

  /** What this browser looks like, in words a person can read back to us. */
  async walletReport() {
    const list = await this.wallets();
    const slot = typeof window !== 'undefined' ? window.ethereum : null;
    return {
      announced: list.filter((w) => w.info.rdns !== 'window.ethereum').map((w) => `${w.info.name} (${w.info.rdns})`),
      injected: Boolean(slot),
      injectedName: slot ? this.walletName(slot) : null,
      stacked: slot && Array.isArray(slot.providers) ? slot.providers.length : 0,
      secure: typeof window === 'undefined' || window.isSecureContext !== false,
      count: list.length,
    };
  },

  /**
   * Who is already here, without asking anybody anything.
   *
   * eth_accounts prompts nothing and opens nothing: it answers only where this
   * site has already been authorised, and answers empty otherwise. That is
   * exactly the question a page wants when it is deciding whether to offer
   * somebody an edit on their own record ... asking a wallet to unlock so the
   * page can decide whether to show a button would be the wrong way round.
   *
   * @returns the lowercased address, or null
   */
  async quiet() {
    const list = await this.wallets().catch(() => []);
    for (const w of list) {
      try {
        const accounts = await w.provider.request({ method: 'eth_accounts' });
        if (accounts && accounts[0]) { this._wallet = w; return String(accounts[0]).toLowerCase(); }
      } catch (e) { /* a provider that will not answer is not the one */ }
    }
    return null;
  },

  /**
   * eth_requestAccounts, on a provider we chose on purpose.
   * @param choice  uuid or rdns from wallets(), or nothing for the only one
   */
  async connect(choice) {
    const list = await this.wallets();
    if (!list.length) {
      const e = new Error('No wallet is answering in this browser. If an extension is installed, it may be switched off for this site, or this may be a browser without one.');
      e.code = 'no-provider';
      throw e;
    }
    const hit = choice ? list.find((w) => w.info.uuid === choice || w.info.rdns === choice) : null;
    if (choice && !hit) throw new Error('That wallet is no longer answering. Try again.');
    /* More than one answering and no choice made. Before asking a person to
       pick, ask the wallets: eth_accounts is silent, prompts nothing, and says
       which of them already has this site authorised. One does, almost always,
       and that one is the answer. Only a genuine tie is worth a question. */
    let chosen = hit;
    if (!chosen && list.length > 1) {
      const live = [];
      for (const w of list) {
        try {
          const accounts = await w.provider.request({ method: 'eth_accounts' });
          if (accounts && accounts.length) live.push(w);
        } catch (e) { /* a provider that will not answer is not the one */ }
      }
      if (live.length === 1) chosen = live[0];
      else {
        const e = new Error(`More than one wallet is answering: ${list.map((w) => w.info.name).join(', ')}. Choose one.`);
        e.code = 'many-providers';
        e.wallets = list.map((w) => ({ uuid: w.info.uuid, rdns: w.info.rdns, name: w.info.name }));
        throw e;
      }
    }
    if (!chosen) chosen = list[0];
    this._wallet = chosen;
    try {
      const accounts = await chosen.provider.request({ method: 'eth_requestAccounts' });
      const a = accounts && accounts[0];
      if (!a) throw new Error('the wallet returned no account');
      return String(a).toLowerCase();
    } catch (err) {
      const code = err && err.code;
      const out = new Error(code === 4001 ? `Connection refused in ${chosen.info.name}.`
        : code === -32002 ? `${chosen.info.name} already has a request waiting. Open it and answer that one first.`
          : `${chosen.info.name} did not connect: ${String((err && err.message) || err).slice(0, 160)}`);
      out.code = code;
      throw out;
    }
  },

  escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /* ---------- colour, as the eye reads it ----------
   *
   * The collectors' palette is chosen twelve times over, and each colour has
   * to stand clear of the ones already locked. "Clear" is a perceptual
   * distance, in OKLab, on a scale where black to white is exactly 1 ... naive
   * RGB would refuse a plainly different colour and pass a barely different
   * one, which is not a thing to get approximately right on a rule that turns
   * somebody's proposal away.
   *
   * The same arithmetic runs on the server, in api/_lib/palette.js, and that
   * is the copy that decides. This one is here so the picker can say no before
   * anybody signs, which is the difference between a constraint and a refusal.
   */
  colour: {
    _lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); },
    oklab(hex) {
      const h = String(hex).replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => this._lin(parseInt(h.slice(i, i + 2), 16) / 255));
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
      ];
    },
    oklch(hex) {
      const [L, a, b] = this.oklab(hex);
      return { l: L, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
    },
    deltaE(a, b) {
      const x = this.oklab(a);
      const y = this.oklab(b);
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    },
    /* The distance that counts: to the nearest one. A colour is only as
       distinct as its closest neighbour on the wall. */
    nearest(hex, against) {
      let best = null;
      for (const other of against || []) {
        const d = this.deltaE(hex, other);
        if (!best || d < best.distance) best = { hex: String(other).toUpperCase(), distance: d };
      }
      return best;
    },
    inSpace(hex, space) {
      const s = space || { l: [0.2, 0.9], chroma: 0.18 };
      const { l, c } = this.oklch(hex);
      if (l < s.l[0]) return { ok: false, why: 'darker than anything on these walls' };
      if (l > s.l[1]) return { ok: false, why: 'lighter than anything on these walls' };
      if (c > s.chroma) return { ok: false, why: 'more saturated than a streetscape colour' };
      return { ok: true };
    },
    /* Whether a colour may go on a constrained board, and what to say if not.
       The wording matches the server's, so a picker that says yes and a route
       that says no cannot disagree about why. */
    check(hex, bound) {
      const h = String(hex).toUpperCase();
      if (!bound) return { ok: true, hex: h };
      const hexOf = (a) => String(typeof a === 'string' ? a : a.hex).toUpperCase();
      /* Named is what may be said back: the community's colours. Clearance is
         what the floor is actually measured from, which also holds the red
         line. The two differ so the picker can refuse exactly what the route
         refuses without ever naming the studio's constant ... a picker that
         said yes where the route says no is the one thing this must not be. */
      const named = (bound.against || []).map(hexOf);
      const against = (bound.clearance || []).map(hexOf);
      const all = against.length ? against : named;
      const place = this.inSpace(h, bound.space);
      if (!place.ok) {
        return { ok: false, hex: h, why: `${h} is ${place.why}. The palette is sampled from the street, so it stays in that range.` };
      }
      const near = this.nearest(h, all);
      const floor = Number(bound.floor) || 0;
      const sayable = named.includes(near && near.hex);
      if (near && near.distance < floor) {
        return { ok: false, hex: h, nearest: sayable ? near.hex : null, distance: near.distance,
          why: sayable
            ? `${h} is ${near.distance.toFixed(2)} from ${near.hex}, and a colour here has to stand `
              + `${floor.toFixed(2)} clear of everything already locked.`
            : `${h} is too close to a colour these paintings already carry. A colour here has to stand `
              + `${floor.toFixed(2)} clear.` };
      }
      const say = this.nearest(h, named);
      return { ok: true, hex: h, nearest: say ? say.hex : null, distance: say ? say.distance : null };
    },
  },
};

window.MF = MF;

/* ---------- a colour, named ----------
 *
 * A hex is exact and unsayable. Twelve of them in a row is a palette nobody
 * can talk about, and these colours go on a wall by people who have to refer
 * to them out loud ... so every swatch carries the nearest name in a system a
 * painter or a printer already holds: Pantone solid coated first, the CSS
 * names after it for the ground the Pantone set does not reach.
 *
 * Nearest is measured the way everything else here is, in OKLab, because the
 * nearest name in RGB is regularly not the one the eye would pick.
 *
 * The Pantone values are the published sRGB renderings, which are themselves
 * an approximation of an ink under a light. So the name is offered as the
 * closest one and marked with a ≈ unless the hex is that colour exactly. A
 * reference said as though it were exact is worse than no reference.
 */
MF.colour.NAMES = [
  ['#DA291C', 'Pantone 485 C'], ['#E03C31', 'Pantone 179 C'], ['#C8102E', 'Pantone 186 C'],
  ['#A6192E', 'Pantone 187 C'], ['#9D2235', 'Pantone 201 C'], ['#862633', 'Pantone 202 C'],
  ['#EF3340', 'Pantone Red 032 C'], ['#F9423A', 'Pantone Warm Red C'], ['#D22630', 'Pantone 1795 C'],
  ['#CB333B', 'Pantone 1797 C'], ['#7C2529', 'Pantone 188 C'], ['#6C1D45', 'Pantone 229 C'],
  ['#FE5000', 'Pantone Orange 021 C'], ['#FF6A13', 'Pantone 165 C'], ['#E35205', 'Pantone 166 C'],
  ['#FA4616', 'Pantone 172 C'], ['#CF4520', 'Pantone 173 C'], ['#963821', 'Pantone 174 C'],
  ['#E87722', 'Pantone 158 C'], ['#FF8200', 'Pantone 151 C'], ['#ED8B00', 'Pantone 144 C'],
  ['#FFA300', 'Pantone 137 C'], ['#F2A900', 'Pantone 130 C'], ['#FFC72C', 'Pantone 123 C'],
  ['#FFCD00', 'Pantone 116 C'], ['#FFD100', 'Pantone 109 C'], ['#FEDD00', 'Pantone Yellow C'],
  ['#F3E500', 'Pantone 3945 C'], ['#D0DF00', 'Pantone 388 C'], ['#97D700', 'Pantone 375 C'],
  ['#78BE20', 'Pantone 368 C'], ['#43B02A', 'Pantone 361 C'], ['#009639', 'Pantone 355 C'],
  ['#00843D', 'Pantone 348 C'], ['#046A38', 'Pantone 349 C'], ['#007A53', 'Pantone 341 C'],
  ['#00594C', 'Pantone 335 C'], ['#154734', 'Pantone 3435 C'], ['#658D1B', 'Pantone 370 C'],
  ['#7A9A01', 'Pantone 377 C'], ['#A8AD00', 'Pantone 383 C'], ['#C4D600', 'Pantone 397 C'],
  ['#00B08B', 'Pantone 339 C'], ['#00A499', 'Pantone 326 C'], ['#007672', 'Pantone 322 C'],
  ['#007377', 'Pantone 315 C'], ['#00677F', 'Pantone 308 C'], ['#00838F', 'Pantone 3145 C'],
  ['#006269', 'Pantone 3165 C'], ['#008C95', 'Pantone 314 C'], ['#00A3E0', 'Pantone 299 C'],
  ['#41B6E6', 'Pantone 298 C'], ['#71C5E8', 'Pantone 297 C'], ['#0072CE', 'Pantone 285 C'],
  ['#0033A0', 'Pantone 286 C'], ['#003087', 'Pantone 287 C'], ['#002D72', 'Pantone 288 C'],
  ['#002B5C', 'Pantone 289 C'], ['#003057', 'Pantone 2955 C'], ['#003865', 'Pantone 540 C'],
  ['#003DA5', 'Pantone 541 C'], ['#005EB8', 'Pantone 300 C'], ['#004B87', 'Pantone 301 C'],
  ['#1D4F91', 'Pantone 7687 C'], ['#001489', 'Pantone Reflex Blue C'], ['#10069F', 'Pantone Blue 072 C'],
  ['#500778', 'Pantone 2735 C'], ['#440099', 'Pantone Violet C'], ['#5F259F', 'Pantone 267 C'],
  ['#582C83', 'Pantone 268 C'], ['#512D6D', 'Pantone 269 C'], ['#702F8A', 'Pantone 526 C'],
  ['#9B26B6', 'Pantone 254 C'], ['#CE0058', 'Pantone Rubine Red C'], ['#D0006F', 'Pantone 226 C'],
  ['#E10098', 'Pantone Rhodamine Red C'], ['#DA1884', 'Pantone 219 C'], ['#F04E98', 'Pantone 212 C'],
  ['#E31C79', 'Pantone 1915 C'], ['#F1B2DC', 'Pantone 516 C'],
  ['#4E3629', 'Pantone 476 C'], ['#623B2A', 'Pantone 477 C'], ['#72351C', 'Pantone 478 C'],
  ['#693F23', 'Pantone 469 C'], ['#5C4830', 'Pantone 462 C'], ['#6E4C1E', 'Pantone 463 C'],
  ['#653024', 'Pantone 483 C'], ['#9A3324', 'Pantone 484 C'], ['#56342B', 'Pantone 4695 C'],
  ['#7A5647', 'Pantone 4705 C'], ['#653819', 'Pantone 168 C'], ['#603D20', 'Pantone 161 C'],
  ['#E56A54', 'Pantone 7416 C'], ['#E04E39', 'Pantone 7417 C'], ['#E8927C', 'Pantone 486 C'],
  ['#FF8D6D', 'Pantone 163 C'], ['#A45248', 'Pantone 7522 C'], ['#C08A3E', 'Pantone 7510 C'],
  ['#B9975B', 'Pantone 465 C'], ['#C6AA76', 'Pantone 466 C'], ['#D3BC8D', 'Pantone 467 C'],
  ['#DDCBA4', 'Pantone 468 C'], ['#D3BF96', 'Pantone 7502 C'], ['#A79D96', 'Pantone 7503 C'],
  ['#D6D2C4', 'Pantone 7527 C'], ['#B7B09C', 'Pantone 7530 C'], ['#63513D', 'Pantone 7532 C'],
  ['#473729', 'Pantone 7533 C'], ['#B7A99A', 'Pantone 7535 C'], ['#A69F88', 'Pantone 7536 C'],
  ['#D9D9D6', 'Pantone Cool Gray 1 C'], ['#D0D0CE', 'Pantone Cool Gray 2 C'],
  ['#C8C9C7', 'Pantone Cool Gray 3 C'], ['#BBBCBC', 'Pantone Cool Gray 4 C'],
  ['#B1B3B3', 'Pantone Cool Gray 5 C'], ['#A7A8AA', 'Pantone Cool Gray 6 C'],
  ['#97999B', 'Pantone Cool Gray 7 C'], ['#888B8D', 'Pantone Cool Gray 8 C'],
  ['#75787B', 'Pantone Cool Gray 9 C'], ['#63666A', 'Pantone Cool Gray 10 C'],
  ['#53565A', 'Pantone Cool Gray 11 C'], ['#D7D2CB', 'Pantone Warm Gray 1 C'],
  ['#BFB8AF', 'Pantone Warm Gray 3 C'], ['#ACA39A', 'Pantone Warm Gray 5 C'],
  ['#968C83', 'Pantone Warm Gray 7 C'], ['#8C8279', 'Pantone Warm Gray 8 C'],
  ['#83786F', 'Pantone Warm Gray 9 C'], ['#796E65', 'Pantone Warm Gray 10 C'],
  ['#6E6259', 'Pantone Warm Gray 11 C'], ['#2D2926', 'Pantone Black C'],
  ['#212322', 'Pantone Black 3 C'], ['#31261D', 'Pantone Black 4 C'], ['#101820', 'Pantone Black 6 C'],
  ['#231F20', 'Pantone Process Black C'], ['#333F48', 'Pantone 432 C'], ['#1D252D', 'Pantone 433 C'],
  ['#425563', 'Pantone 7545 C'], ['#98A4AE', 'Pantone 7543 C'], ['#8DB9CA', 'Pantone 549 C'],
  ['#7BAFD4', 'Pantone 542 C'], ['#9BB8D3', 'Pantone 645 C'], ['#C6DAE7', 'Pantone 290 C'],
  ['#A4BCC2', 'Pantone 5445 C'], ['#7C9BA6', 'Pantone 5435 C'], ['#4F758B', 'Pantone 5405 C'],
  ['#5B7F95', 'Pantone 5415 C'], ['#2C5234', 'Pantone 5535 C'], ['#93B1A7', 'Pantone 5575 C'],
  ['#B5C9C3', 'Pantone 5595 C'], ['#A2AAAD', 'Pantone 429 C'],
  ['#F0F8FF', 'Alice Blue'], ['#FAEBD7', 'Antique White'], ['#00FFFF', 'Aqua'], ['#7FFFD4', 'Aquamarine'],
  ['#F0FFFF', 'Azure'], ['#F5F5DC', 'Beige'], ['#FFE4C4', 'Bisque'], ['#000000', 'Black'],
  ['#FFEBCD', 'Blanched Almond'], ['#0000FF', 'Blue'], ['#8A2BE2', 'Blue Violet'], ['#A52A2A', 'Brown'],
  ['#DEB887', 'Burlywood'], ['#5F9EA0', 'Cadet Blue'], ['#7FFF00', 'Chartreuse'], ['#D2691E', 'Chocolate'],
  ['#FF7F50', 'Coral'], ['#6495ED', 'Cornflower Blue'], ['#FFF8DC', 'Cornsilk'], ['#DC143C', 'Crimson'],
  ['#00008B', 'Dark Blue'], ['#008B8B', 'Dark Cyan'], ['#B8860B', 'Dark Goldenrod'], ['#A9A9A9', 'Dark Gray'],
  ['#006400', 'Dark Green'], ['#BDB76B', 'Dark Khaki'], ['#8B008B', 'Dark Magenta'],
  ['#556B2F', 'Dark Olive Green'], ['#FF8C00', 'Dark Orange'], ['#9932CC', 'Dark Orchid'],
  ['#8B0000', 'Dark Red'], ['#E9967A', 'Dark Salmon'], ['#8FBC8F', 'Dark Sea Green'],
  ['#483D8B', 'Dark Slate Blue'], ['#2F4F4F', 'Dark Slate Gray'], ['#00CED1', 'Dark Turquoise'],
  ['#9400D3', 'Dark Violet'], ['#FF1493', 'Deep Pink'], ['#00BFFF', 'Deep Sky Blue'], ['#696969', 'Dim Gray'],
  ['#1E90FF', 'Dodger Blue'], ['#B22222', 'Firebrick'], ['#FFFAF0', 'Floral White'],
  ['#228B22', 'Forest Green'], ['#DCDCDC', 'Gainsboro'], ['#FFD700', 'Gold'], ['#DAA520', 'Goldenrod'],
  ['#808080', 'Gray'], ['#008000', 'Green'], ['#ADFF2F', 'Green Yellow'], ['#F0FFF0', 'Honeydew'],
  ['#FF69B4', 'Hot Pink'], ['#CD5C5C', 'Indian Red'], ['#4B0082', 'Indigo'], ['#FFFFF0', 'Ivory'],
  ['#F0E68C', 'Khaki'], ['#E6E6FA', 'Lavender'], ['#FFF0F5', 'Lavender Blush'], ['#7CFC00', 'Lawn Green'],
  ['#FFFACD', 'Lemon Chiffon'], ['#ADD8E6', 'Light Blue'], ['#F08080', 'Light Coral'],
  ['#E0FFFF', 'Light Cyan'], ['#FAFAD2', 'Light Goldenrod Yellow'], ['#D3D3D3', 'Light Gray'],
  ['#90EE90', 'Light Green'], ['#FFB6C1', 'Light Pink'], ['#FFA07A', 'Light Salmon'],
  ['#20B2AA', 'Light Sea Green'], ['#87CEFA', 'Light Sky Blue'], ['#778899', 'Light Slate Gray'],
  ['#B0C4DE', 'Light Steel Blue'], ['#FFFFE0', 'Light Yellow'], ['#00FF00', 'Lime'],
  ['#32CD32', 'Lime Green'], ['#FAF0E6', 'Linen'], ['#FF00FF', 'Magenta'], ['#800000', 'Maroon'],
  ['#66CDAA', 'Medium Aquamarine'], ['#0000CD', 'Medium Blue'], ['#BA55D3', 'Medium Orchid'],
  ['#9370DB', 'Medium Purple'], ['#3CB371', 'Medium Sea Green'], ['#7B68EE', 'Medium Slate Blue'],
  ['#00FA9A', 'Medium Spring Green'], ['#48D1CC', 'Medium Turquoise'], ['#C71585', 'Medium Violet Red'],
  ['#191970', 'Midnight Blue'], ['#F5FFFA', 'Mint Cream'], ['#FFE4E1', 'Misty Rose'], ['#FFE4B5', 'Moccasin'],
  ['#FFDEAD', 'Navajo White'], ['#000080', 'Navy'], ['#FDF5E6', 'Old Lace'], ['#808000', 'Olive'],
  ['#6B8E23', 'Olive Drab'], ['#FFA500', 'Orange'], ['#FF4500', 'Orange Red'], ['#DA70D6', 'Orchid'],
  ['#EEE8AA', 'Pale Goldenrod'], ['#98FB98', 'Pale Green'], ['#AFEEEE', 'Pale Turquoise'],
  ['#DB7093', 'Pale Violet Red'], ['#FFEFD5', 'Papaya Whip'], ['#FFDAB9', 'Peach Puff'], ['#CD853F', 'Peru'],
  ['#FFC0CB', 'Pink'], ['#DDA0DD', 'Plum'], ['#B0E0E6', 'Powder Blue'], ['#800080', 'Purple'],
  ['#663399', 'Rebecca Purple'], ['#FF0000', 'Red'], ['#BC8F8F', 'Rosy Brown'], ['#4169E1', 'Royal Blue'],
  ['#8B4513', 'Saddle Brown'], ['#FA8072', 'Salmon'], ['#F4A460', 'Sandy Brown'], ['#2E8B57', 'Sea Green'],
  ['#FFF5EE', 'Seashell'], ['#A0522D', 'Sienna'], ['#C0C0C0', 'Silver'], ['#87CEEB', 'Sky Blue'],
  ['#6A5ACD', 'Slate Blue'], ['#708090', 'Slate Gray'], ['#FFFAFA', 'Snow'], ['#00FF7F', 'Spring Green'],
  ['#4682B4', 'Steel Blue'], ['#D2B48C', 'Tan'], ['#008080', 'Teal'], ['#D8BFD8', 'Thistle'],
  ['#FF6347', 'Tomato'], ['#40E0D0', 'Turquoise'], ['#EE82EE', 'Violet'], ['#F5DEB3', 'Wheat'],
  ['#FFFFFF', 'White'], ['#F5F5F5', 'White Smoke'], ['#FFFF00', 'Yellow'], ['#9ACD32', 'Yellow Green'],
];

MF.colour._named = new Map();

/**
 * The nearest name to a colour, and how near it is.
 *
 * `label` is the thing to print: the name on its own where the hex is that
 * colour exactly, and "≈ Pantone 485 C" everywhere else, because everywhere
 * else it is the closest one rather than the one.
 */
MF.colour.name = function name(hex) {
  const h = String(hex || '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(h)) return null;
  if (this._named.has(h)) return this._named.get(h);
  let best = null;
  for (const [ref, nm] of this.NAMES) {
    const d = this.deltaE(h, ref);
    if (!best || d < best.distance) best = { name: nm, hex: ref, distance: d };
  }
  const label = best.hex === h ? best.name : `≈ ${best.name}`;
  const out = best && {
    ...best,
    exact: best.hex === h,
    label,
    /* The same thing in the width a swatch caption has. PMS is what a printer
       and a signwriter both call it out loud anyway, and a caption that wraps
       a lone "C" onto its own line is a caption nobody reads twice. */
    short: label.replace('Pantone ', 'PMS '),
  };
  this._named.set(h, out);
  return out;
};

/* ---------- the collectors' palette, drawn ----------
 *
 * One component, one order, every surface that draws the strip: /studio, the
 * Strip Paintings collection page and the maker. It is here rather than in
 * three pages because the order is the meaning, and three copies of a meaning
 * is a meaning that drifts.
 *
 * The order is the arc's own: slot 1 is the colour Nudge #1 locked, slots 2
 * to 12 fill as the series runs, empty ones drawn rather than hidden because
 * three swatches would read as a palette of three.
 *
 * Twelve, and nothing else. The red line was drawn here once, set apart at
 * the end, and even set apart it read as a thirteenth thing the collectors
 * had a say in. They do not: it is the artist's constant, sixteen strips up
 * on every one of these paintings, and its home is the Strip Painting Maker
 * and the paintings. It still holds the clash floor, silently, where the
 * arithmetic is ... it is simply not part of this conversation.
 */
MF.palette = {
  /* The twelve, in slot order, whatever order they arrived in. Sorted here
     rather than trusted, because a lineup that depends on a route staying
     polite about ordering is a lineup that will quietly stop being one. */
  slots(series) {
    const s = series || {};
    const count = Math.max(0, Math.floor(Number(s.slots) || 12));
    const by = new Map();
    for (const v of s.board || []) {
      const n = Math.floor(Number(v.slot) || 0);
      if (n >= 1 && n <= count) by.set(n, v);
    }
    /* A caller holding the locked colours but not a board ... the maker asks
       for the series, not for a drawing of it ... still gets the twelve in
       this order rather than a row of whatever it happens to hold. */
    for (const v of s.locked || []) {
      const n = Math.floor(Number(v.slot) || 0);
      if (n >= 1 && n <= count && !by.has(n)) by.set(n, { ...v, state: 'locked' });
    }
    const out = [];
    for (let i = 1; i <= count; i += 1) out.push(by.get(i) || { slot: i, state: 'empty' });
    return out;
  },

  /* Where a slot points. The strip is drawn on three pages and the nudge it
     leads to lives on one of them. */
  href(v, opts) {
    const o = opts || {};
    if (o.link === false || !v.nudge) return null;
    return `${o.base || ''}#nudge-${encodeURIComponent(v.nudge)}`;
  },

  cell(v, opts) {
    const e = MF.escape;
    const n = String(v.slot).padStart(2, '0');
    const hex = v.hex ? String(v.hex).toUpperCase() : null;
    const nm = hex ? MF.colour.name(hex) : null;
    /* A slot says its number first and the nudge that answered it second. The
       number is the part that was going missing: it is what makes the twelve
       a sequence rather than a row, and the reason the red could pass for the
       second of them. */
    const inner = v.state === 'empty'
      ? `<span class="pal-band"></span>
        <span class="pal-lab">${n}</span>
        <span class="pal-hex">&mdash;</span>`
      : `<span class="pal-band"${hex ? ` style="background:${e(hex)}"` : ''}></span>
        <span class="pal-lab">${n} &middot; Nudge #${e(v.number)}</span>
        <span class="pal-hex">${hex ? e(hex) : 'Open'}</span>
        ${nm ? `<span class="pal-name">${e(nm.short)}</span>` : ''}`;
    /* Settled, being asked, or waiting. */
    const cls = `pal-slot ${{ locked: 'filled', open: 'live' }[v.state] || 'empty'}`;
    const href = this.href(v, opts);
    const title = hex ? ` title="Slot ${n} &middot; ${e(hex)}${nm ? ` &middot; ${e(nm.label)}` : ''}"` : '';
    return href
      ? `<a class="${cls}" href="${e(href)}"${title}>${inner}</a>`
      : `<span class="${cls}"${title}>${inner}</span>`;
  },

  /* The whole strip: the twelve, and only the twelve. */
  strip(series, opts) {
    return `<div class="pal-strip">${this.slots(series || {}).map((v) => this.cell(v, opts)).join('')}</div>`;
  },

  /* What a colour is drawn against, in the strip's order: the community's
     slots locked before it, lowest first. The route sends only those; they
     are put in order again here so one component owns the order rather than
     two of them agreeing about it. */
  against(constraint) {
    return ((constraint || {}).against || []).map((a) => {
      const hex = String(a.hex).toUpperCase();
      const slot = Math.floor(Number(a.slot) || 0);
      return {
        ...a,
        hex,
        slot: slot || null,
        name: MF.colour.name(hex),
        caption: `${slot ? `${String(slot).padStart(2, '0')} · ` : ''}${a.label || 'Locked'}`,
      };
    }).sort((a, b) => (a.slot || 0) - (b.slot || 0));
  },

  /* The same lineup as slivers, beside a candidate, so the pair is read as a
     pair rather than as two swatches in different parts of the page. */
  slivers(constraint) {
    const e = MF.escape;
    return this.against(constraint).map((a) =>
      `<span class="lk" style="background:${e(a.hex)}"
        title="${e(a.caption)} &middot; ${e(a.hex)}${a.name ? ` &middot; ${e(a.name.label)}` : ''}"></span>`).join('');
  },
};

/* ═════════════════════════════════════════════════════════════
   THE SESSION, AND THE NAV
   One component, two deploys. mintface.art and collectors.mintface.art load
   this file and mintface.css, so the bar at the top of both is the same bar
   and changing it is one edit in one place.
   ═════════════════════════════════════════════════════════════ */

/* Where the room is, from wherever this page is served.
 *
 * On mintface.art and on any preview of it these stay relative, so a preview
 * talks to its own API and links to its own pages. On collectors they become
 * absolute, because the room and the catalogue live on the other deploy. */
const AT_PEOPLE = location.hostname === 'collectors.mintface.art';
MF.ART = AT_PEOPLE ? 'https://mintface.art' : '';
MF.PEOPLE = AT_PEOPLE ? '' : 'https://collectors.mintface.art';

/* ---------- the session ----------
 *
 * One signature says this browser may speak as you until a stated date, and
 * the sentence approved in the wallet says exactly that. It opened as the
 * room's own rig; it is the site's now, because the nav signs in with it and
 * the nav is on every page.
 *
 * It is one sign-in across both hosts. The token is a cookie scoped to
 * .mintface.art, which the two of them share, so signing in on the catalogue
 * signs you in on the register and the other way about. Same registrable
 * domain, so SameSite=Lax carries it and nothing here is a third-party cookie.
 *
 * The token itself is HttpOnly and this file never sees it again ... which is
 * a straight improvement on the localStorage it replaces, where any script on
 * the page could read a month of somebody's session. What is left readable is
 * a companion cookie carrying the two public facts the nav needs to draw
 * itself: which wallet, and until when.
 */
MF.session = {
  OLD_KEY: 'mintface.room.session',
  WHO: 'mf_who',
  api() { return `${MF.ART}/api/chat`; },

  cookie(name) {
    const raw = document.cookie || '';
    for (const bit of raw.split(';')) {
      const s = bit.trim();
      if (s.startsWith(`${name}=`)) return decodeURIComponent(s.slice(name.length + 1));
    }
    return null;
  },

  /** The session this browser holds, or nothing. A month that has run out is
      nothing, and the credential behind this is the server's business. */
  current() {
    /* A session from before the cookie existed is in localStorage, on one host
       only, and cannot be moved to the other without a signature anyway. It is
       dropped rather than half-honoured: one re-login, and then it follows you
       across both. */
    try { if (localStorage.getItem(this.OLD_KEY)) localStorage.removeItem(this.OLD_KEY); }
    catch (err) { /* storage switched off, nothing to clear */ }
    const v = this.cookie(this.WHO);
    if (!v) return null;
    const cut = v.lastIndexOf('|');
    const address = (cut < 0 ? v : v.slice(0, cut)).toLowerCase();
    const until = cut < 0 ? null : v.slice(cut + 1);
    if (!/^0x[0-9a-f]{40}$/.test(address)) return null;
    if (until && Date.parse(until) < Date.now()) return null;
    return { address, until };
  },
  /* Signing out is the server's to do: it holds the token and it is the only
     thing that can unset an HttpOnly cookie. This is only for a browser that
     could not reach it. */
  forget() {
    const dead = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
    try {
      document.cookie = `${this.WHO}=; ${dead}`;
      document.cookie = `${this.WHO}=; Domain=.mintface.art; ${dead}`;
    } catch (err) { /* nothing to do */ }
  },

  /** The sentence a wallet signs. The same one api/_lib/chat.js builds, to the
      character ... which is why it is written once here rather than in every
      page that needs to sign something. */
  sentence({ action, text, target, address, issued, until, reply, emoji, domain, image }) {
    return [
      'MintFace ... Studio',
      '',
      `Action: ${action}`,
      ...(domain ? [`Domain: ${domain}`] : []),
      ...(text != null ? [`Message: ${text}`] : []),
      ...(reply != null && reply !== '' ? [`Replying to: ${reply}`] : []),
      ...(image ? [`Picture: ${image}`] : []),
      ...(emoji ? [`Reaction: ${emoji}`] : []),
      ...(target ? [`Subject: ${target}`] : []),
      `Wallet: ${address}`,
      ...(until ? [`Until: ${until}`] : []),
      `Issued: ${issued}`,
      '',
      ...(action === 'sign in'
        ? ['Signing opens Studio until the date above. It moves nothing and spends nothing.',
          'Until then this browser can speak here, and weigh your TAO on the',
          "studio's nudges, without asking again."]
        : action === 'react'
          ? ['Signing leaves a reaction in Studio. It moves nothing and spends nothing.']
          : ['Signing speaks in Studio. It moves nothing and spends nothing.']),
    ].join('\n');
  },

  async post(body) {
    const r = await fetch(this.api(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      /* The cookie rides along, which on the register means a cross-origin
         request that is not a cross-site one. The room answers those with its
         own origin echoed rather than a wildcard, because a wildcard and
         credentials are not allowed together and should not be. */
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.error || 'that did not go through'); err.expired = Boolean(j.expired); throw err; }
    return j;
  },

  /** Who the room says you are, and what waited for you. No messages: a nav
      does not need a page of the log to put a name in a corner. */
  async who(address) {
    const q = new URLSearchParams({ me: '1' });
    if (address) q.set('viewer', address);
    const r = await fetch(`${this.api()}?${q}`,
      { headers: { accept: 'application/json' }, credentials: 'include' });
    return r.ok ? r.json() : null;
  },

  /** The one signature. It names the site it was asked on, so a signature
      collected somewhere else cannot be spent here. */
  async open(address, days, onState = () => {}) {
    const issued = new Date().toISOString();
    const domain = location.hostname;
    const until = new Date(Date.parse(issued) + Number(days) * 86400000).toISOString();
    const signature = await MF.sign(
      this.sentence({ action: 'sign in', address, issued, until, domain }), address, onState);
    // the cookies come back on this answer; nothing is kept here
    return this.post({ action: 'sign in', address, issued, until, domain, signature });
  },

  async close() {
    try { await this.post({ action: 'sign out' }); } catch (err) { /* say so anyway */ }
    this.forget();
  },
};

/* ---------- a picture, made fit to send ----------
 *
 * Everything here happens before a single byte leaves the browser, and the
 * order of it is the point. The file is decoded, drawn onto a canvas at the
 * size the room wants, and re-encoded off that canvas ... and a canvas has no
 * idea what EXIF is. So the resize IS the strip: the GPS coordinates a phone
 * writes into every photograph never leave the phone, not because anything
 * went looking for them but because nothing carried them across.
 *
 * The orientation is the one piece of that metadata that has to survive, and
 * it survives by being applied rather than copied: the bitmap is decoded with
 * the rotation already baked in, so a photograph taken sideways arrives the
 * way up it was taken and nothing downstream has to know why.
 */
MF.picture = {
  LONG_EDGE: 2000,
  TYPES: ['image/webp', 'image/jpeg'],

  /** A file from a phone or a desktop, as the room will take it. */
  async ready(file, { longEdge = this.LONG_EDGE, maxBytes = 1200 * 1024 } = {}) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('that is not an image');
    const bitmap = await this.decode(file);
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();

    /* WebP where the browser has it and JPEG where it does not, and then down
       the quality rather than down the size: a photograph that has already
       been made small should lose a little sharpness before it loses its
       shape. Five steps, and if the fifth is still too big the picture is
       genuinely too big and is said to be. */
    let type = (await this.encodesWebp()) ? 'image/webp' : 'image/jpeg';
    for (const q of [0.84, 0.76, 0.68, 0.58, 0.46]) {
      let blob = await this.encode(canvas, type, q);
      /* A browser that says it can encode WebP and then does not.
         The feature test is a single pixel, which some engines answer from a
         trivial path they never take for a real image ... and a composer that
         sits on "Reading the picture" forever because an encoder never called
         back is worse than a slightly larger JPEG. So the first one that does
         not come back settles the format for the rest of this picture. */
      if (blob === null && type === 'image/webp') {
        this._webp = false;
        type = 'image/jpeg';
        blob = await this.encode(canvas, type, q);
      }
      if (blob === null) throw new Error('this browser would not encode that picture');
      if (blob.size <= maxBytes) return { blob, type, w, h, data: await this.base64(blob) };
    }
    throw new Error('that picture will not come down to a size the room can keep');
  },

  /* Decoded with the rotation applied. createImageBitmap does it properly and
     everywhere that matters; the <img> fallback is for a browser that has no
     createImageBitmap, which by now also has no EXIF orientation problem. */
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (err) { /* an option it does not know: fall through */ }
      try { return await createImageBitmap(file); } catch (err) { /* and fall further */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('that image would not open'));
        el.src = url;
      });
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  },

  /* toBlob, with a limit on how long it may say nothing.
     It has no failure path of its own: an encoder that cannot do the job
     simply never calls back, and the page waits for it forever. */
  ENCODE_MS: 15000,
  encode(canvas, type, quality) {
    return new Promise((res) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; res(v); } };
      setTimeout(() => finish(null), this.ENCODE_MS);
      try { canvas.toBlob((b) => finish(b || null), type, quality); }
      catch (err) { finish(null); }
    });
  },

  /* Asked of a single pixel, and asked once.
     This used to encode the whole resized photograph just to find out whether
     the browser could encode it, which is two full encodes of a two-thousand
     pixel image to produce one ... on a phone, which is where the pictures
     come from, that is the difference between a moment and a wait. */
  _webp: null,
  async encodesWebp() {
    if (this._webp !== null) return this._webp;
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.8));
      this._webp = Boolean(blob && blob.type === 'image/webp');
    } catch (err) { this._webp = false; }
    return this._webp;
  },

  async base64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  },

  /* The same fingerprint api/_lib/images.js computes, so a wallet signing
     words with a picture attached is signing both. */
  async fingerprint(blob) {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  },
};

/* ---------- day and night ----------
 *
 * One choice, two deploys, and it has to be settled before the first pixel.
 *
 * Most of that does not happen here. The stylesheet's own default is
 * prefers-color-scheme, so a browser that has never been told anything gets
 * night out of CSS alone, on the first paint, with no script anywhere in the
 * path. What this adds is the override: a reader who wants day on a dark
 * machine, or the other way about.
 *
 * The override is written twice. A cookie on .mintface.art, because that is
 * the one thing mintface.art and collectors.mintface.art both read, and it is
 * where the session already lives ... so the one choice follows you across.
 * And localStorage, because a browser with cookies switched off should still
 * keep its own preference on its own site.
 *
 * Reading it back before paint is four lines inline in every page's head,
 * which is the only place it can sit and still beat the first pixel. It sets
 * data-theme on <html> and stops. Everything below is what happens after.
 */
MF.theme = {
  KEY: 'mf_theme',
  DARK: '(prefers-color-scheme: dark)',
  watchers: [],

  /** The choice somebody made, or nothing, which means follow the machine. */
  saved() {
    const c = MF.session.cookie(this.KEY);
    if (c === 'day' || c === 'night') return c;
    try {
      const v = localStorage.getItem(this.KEY);
      if (v === 'day' || v === 'night') return v;
    } catch (err) { /* storage switched off, and the cookie already said no */ }
    return null;
  },

  system() {
    try { return matchMedia(this.DARK).matches ? 'night' : 'day'; }
    catch (err) { return 'day'; }
  },

  /** What is actually on the screen. */
  current() { return this.saved() || this.system(); },

  set(theme) {
    const t = theme === 'night' ? 'night' : 'day';
    /* A year, on the registrable domain when we are really on it. A preview
       deploy or a localhost would have Domain=.mintface.art rejected outright,
       so there it stays host-only and simply does not travel. */
    const shared = /(^|\.)mintface\.art$/.test(location.hostname);
    const bits = [`${this.KEY}=${t}`, 'Path=/', 'Max-Age=31536000', 'SameSite=Lax'];
    if (shared) bits.push('Domain=.mintface.art');
    if (location.protocol === 'https:') bits.push('Secure');
    try { document.cookie = bits.join('; '); } catch (err) { /* nothing to do */ }
    try { localStorage.setItem(this.KEY, t); } catch (err) { /* nothing to do */ }
    this.apply();
  },

  /** Put what is stored onto the page. No attribute means follow the machine,
      which is what the stylesheet does on its own. */
  apply() {
    const t = this.saved();
    const root = document.documentElement;
    if (t) root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    /* the chrome around the page too, or a phone is left with one white band
       at the top of a dark screen */
    const ground = this.current() === 'night' ? '#1a1814' : '#faf9f6';
    let m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', ground);
    for (const fn of this.watchers) {
      try { fn(this.current()); } catch (err) { /* a watcher is not the theme's problem */ }
    }
  },

  /** Told whenever what is on the screen changes, for whatever reason. */
  onChange(fn) { this.watchers.push(fn); },

  start() {
    this.apply();
    /* the machine changing its mind, while nobody has overruled it */
    try {
      const mq = matchMedia(this.DARK);
      const react = () => { if (!this.saved()) this.apply(); };
      if (mq.addEventListener) mq.addEventListener('change', react);
      else if (mq.addListener) mq.addListener(react);
    } catch (err) { /* no matchMedia, no machine preference to follow */ }
    /* and another tab on this origin choosing. The other deploy finds out on
       its next navigation, out of the cookie, which is as live as a cookie
       gets and is the right liveness for a reading preference. */
    try {
      addEventListener('storage', (ev) => { if (ev.key === this.KEY) this.apply(); });
    } catch (err) { /* nothing to do */ }
  },
};

/* ---------- the nav ----------
 *
 * A rule with words on it. The mark, two places to go, and then who you are
 * and what waited for you. Sticky, slim, no shadow, nothing about it changing
 * on scroll: it is always there and it is never an event.
 *
 * The cherry used to live in the room's own header, which meant being named
 * only reached you if you were already in the room. It lives here now, so a
 * mention finds you halfway down a collection page and takes you to it.
 */
MF.nav = {
  el: null,
  me: null,
  days: 30,
  unseen: 0,
  next: null,
  busy: null,          // the label to show while a wallet is being asked
  /* A page may take the cherry for itself. The room does: it is already
     showing the messages, so it scrolls to the mention rather than reloading
     the page it is on. Everywhere else the cherry is a link into the room. */
  onCherry: null,

  mount() {
    /* No body, nothing to mount into. That happens where this file is read
       rather than served ... a harness evaluating it to get at MF.sign ... and
       it would happen for real if the script were ever moved into the head. */
    if (typeof document === 'undefined' || !document.body) return null;
    if (document.body.dataset.nav === 'off') return null;
    let el = document.querySelector('header.nav');
    if (!el) {
      el = document.createElement('header');
      el.className = 'nav';
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.id = el.id || 'nav';
    this.el = el;
    this.draw();
    this.wire();
    this.refresh();
    return el;
  },

  /* Drawn from what is known now, and drawn again when the room answers. A
     browser holding a session knows its own address before anything is asked,
     so somebody signed in never sees CONNECT flash in their own nav. */
  draw() {
    if (!this.el) return;
    const e = MF.escape;
    // /collections and /collections.html are the same page wearing two names
    const here = location.pathname.replace(/\.html$/, '').replace(/\/$/, '');
    const on = (path) => (!AT_PEOPLE && here === path ? ' aria-current="page"' : '');
    const s = MF.session.current();
    const name = this.me && this.me.name ? this.me.name
      : (s ? MF.shortAddress(s.address) : null);
    const url = this.me && this.me.url ? this.me.url : null;

    let right;
    if (this.busy) right = `<button type="button" data-nav="wait" disabled>${e(this.busy)}</button>`;
    else if (!s) right = '<button type="button" data-nav="connect">Connect</button>';
    else if (url) right = `<a class="you" href="${e(url)}">${e(name)}</a>`;
    else right = `<span class="you">${e(name)}</span>`;
    /* AMBIENT DISCOVERY. Plenty of collectors delegated to their hot wallet
       years ago, for some other project, and have never heard of this feature.
       Their COMBO simply forms, and the bar says so once, quietly, beside
       their name ... and leads to the page that explains what it is. Nobody is
       asked to opt in to something they already did. */
    const combo = this.me && this.me.combo;
    if (s && combo) {
      right += `<a class="combo" href="${MF.ART}/combo" title="What is this?">${e(combo.mark)}</a>`;
    }

    this.el.innerHTML = `
      <a class="wordmark" href="${MF.ART || '/'}" aria-label="MintFace"
        ><img class="mark-day" src="${MF.ART}/assets/MintFace-Logo-Black.png"
          alt="MintFace" width="1450" height="380"
        ><img class="mark-night" src="${MF.ART}/assets/MintFace-Logo-White.png"
          alt="" aria-hidden="true" width="1450" height="380"></a>
      <a href="${MF.ART}/collections"${on('/collections')}>Collections</a>
      <a href="${MF.PEOPLE || '/'}"${AT_PEOPLE && here === '' ? ' aria-current="page"' : ''}>Collectors</a>
      <a href="${MF.ART}/studio"${on('/studio')}>Studio</a>
      <span class="right">${this.brightness()}${this.cherry()}${right}</span>`;
  },

  /* One mark, beside the cherry, showing the ground you are going to rather
     than the one you are in ... which is the only reading that makes a single
     control unambiguous. A moon while it is day, a sun while it is night.
     Not a lit-and-unlit pair. Two words in a bar this full were a fifth label
     to read every time you looked at it, and the whole point of this control
     is that most readers should never notice it. It is set as text rather
     than emoji so it takes the ink of everything else here and stays quiet
     next to the cherry, which is the one thing in this bar allowed colour.
     The word is in the title and the accessible name, where it belongs. */
  brightness() {
    const night = MF.theme.current() === 'night';
    const to = night ? 'day' : 'night';
    /* U+FE0E holds these to their text shapes. Without it a platform is free
       to hand back a full colour sun, which is the one thing this is not. */
    const glyph = night ? '\u2600\uFE0E' : '\u263E\uFE0E';
    return `<button type="button" class="theme" data-nav="${to}"
      aria-label="Read this in ${to}" title="Read this in ${to}">${glyph}</button>`;
  },

  /* Dormant it is not a button at all: there is nowhere for it to take you,
     and a control that does nothing is worse than a mark that says nothing. */
  cherry() {
    const n = this.unseen || 0;
    const fruit = '<span class="fruit" aria-hidden="true">&#127826;</span>';
    if (!n) {
      const why = MF.session.current()
        ? 'Nobody has said your name in Studio since you last looked.'
        : 'Studio tells you here when somebody says your name.';
      return `<span class="cherry" title="${why}">${fruit}</span>`;
    }
    return `<button type="button" class="cherry" data-nav="cherry"
      title="Go to the first of them in Studio"
      aria-label="${n} unread mention${n === 1 ? '' : 's'} in Studio. Go to the first of them.">${fruit}<span class="n">${n}</span></button>`;
  },

  wire() {
    if (this._wired) return;
    this._wired = true;
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-nav]');
      if (!b || !this.el || !this.el.contains(b)) return;
      if (b.dataset.nav === 'connect') { ev.preventDefault(); this.connect(); }
      if (b.dataset.nav === 'cherry') { ev.preventDefault(); this.toMention(); }
      if (b.dataset.nav === 'day' || b.dataset.nav === 'night') {
        ev.preventDefault(); MF.theme.set(b.dataset.nav);
      }
    });
    /* which mark is showing follows the theme however it changed ... this bar,
       the other tab, or the machine at sunset */
    MF.theme.onChange(() => this.draw());
  },

  /** What the room says about the wallet this browser is signed in as. */
  async refresh() {
    const s = MF.session.current();
    if (!s) { this.me = null; this.unseen = 0; this.next = null; this.draw(); return; }
    let d = null;
    try { d = await MF.session.who(s.address); } catch (err) { d = null; }
    if (!d) return;                       // the nav stands with what it had
    if (d.session_days) this.days = d.session_days;
    this.me = d.me || null;
    const m = (d.me && d.me.mentions) || null;
    this.unseen = m ? (m.unseen || 0) : 0;
    this.next = m ? m.next : null;
    this.draw();
  },

  /** Set from outside, by a page that is watching the room in real time. */
  mentions(unseen, next) {
    this.unseen = Math.max(0, Number(unseen) || 0);
    this.next = next == null ? null : Number(next);
    this.draw();
  },

  toMention() {
    const n = this.next;
    if (this.onCherry) { this.onCherry(n); return; }
    location.href = n == null ? `${MF.ART}/studio` : `${MF.ART}/studio#m-${n}`;
  },

  /* Connecting, and then the one signature. The happy path happens here,
     because making somebody leave the page they are on to say who they are is
     the seam this bar exists to remove. Anything that needs more than a
     sentence to explain ... two wallets answering at once, nothing answering
     at all ... is handed to the room, where that apparatus already lives. */
  async connect() {
    const say = (label) => { this.busy = label; this.draw(); };
    say('Connecting');
    let address;
    try {
      address = await MF.connect();
    } catch (err) {
      this.busy = null;
      if (err && err.code === 'many-providers') { location.href = `${MF.ART}/studio`; return; }
      say(String((err && err.message) || err).slice(0, 40));
      setTimeout(() => { this.busy = null; this.draw(); }, 4000);
      return;
    }
    try {
      const d = await MF.session.who(address);
      if (d && d.session_days) this.days = d.session_days;
      await MF.session.open(address, this.days, (state) => {
        if (state === 'requested') say('Check your wallet');
        if (state === 'slow') say('Still waiting');
        if (state === 'signed') say('Signing in');
      });
      this.busy = null;
      await this.refresh();
    } catch (err) {
      this.busy = null;
      say(String((err && err.message) || err).slice(0, 40));
      setTimeout(() => { this.busy = null; this.draw(); }, 4000);
    }
  },
};

if (typeof document !== 'undefined') {
  /* The head script already set the attribute; this reconciles the rest of it
     (the chrome colour, the listeners) and is harmless if it agrees. */
  MF.theme.start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => MF.nav.mount());
  else MF.nav.mount();
}
