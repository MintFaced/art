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
    core: ['pixelarcade', 'artificial-flowers', 'patrimora', 'frogdna', 'two-burdens', 'recursive-mind', 'hidden-landscapes', 'roads-and-rivers'],
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

  collectorName(collector) {
    if (!collector) return null;
    return collector.display_name || collector.ens || this.shortAddress(collector.address);
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

  escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};

window.MF = MF;
