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
};

window.MF = MF;

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
  sentence({ action, text, target, address, issued, until, reply, emoji, domain }) {
    return [
      'MintFace ... Studio',
      '',
      `Action: ${action}`,
      ...(domain ? [`Domain: ${domain}`] : []),
      ...(text != null ? [`Message: ${text}`] : []),
      ...(reply != null && reply !== '' ? [`Replying to: ${reply}`] : []),
      ...(emoji ? [`Reaction: ${emoji}`] : []),
      ...(target ? [`Subject: ${target}`] : []),
      `Wallet: ${address}`,
      ...(until ? [`Until: ${until}`] : []),
      `Issued: ${issued}`,
      '',
      ...(action === 'sign in'
        ? ['Signing opens Studio until the date above. It moves nothing and spends nothing.',
          'Until then this browser can speak here without asking again.']
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

    this.el.innerHTML = `
      <a class="wordmark" href="${MF.ART || '/'}" aria-label="MintFace"><img
        src="${MF.ART}/assets/MintFace-Logo-Black.png" alt="MintFace" width="1450" height="380"></a>
      <a href="${MF.ART}/collections"${on('/collections')}>Collections</a>
      <a href="${MF.PEOPLE || '/'}"${AT_PEOPLE && here === '' ? ' aria-current="page"' : ''}>Collectors</a>
      <a href="${MF.ART}/studio"${on('/studio')}>Studio</a>
      <span class="right">${this.cherry()}${right}</span>`;
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
    });
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => MF.nav.mount());
  else MF.nav.mount();
}
