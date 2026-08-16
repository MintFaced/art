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

  async collection(slug) {
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
    const slug = idx.work_index[id];
    if (!slug) return null;
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
      ${c.statement ? `<div class="s">${e(c.statement)}</div>` : ''}
    </a>`;
  },

  // The record so far, kept here rather than in the page so one edit changes it
  // everywhere it is quoted.
  SALES_LINE: 'Highest sale 8.2 ETH (328 ed.) \u00b7 av. edition 0.03 ETH \u00b7 av. 1/1 0.3 ETH',

  // groups, in the order the catalog gives them, with the locked geodetic run
  groupOrder: {
    core: ['pixelarcade', 'artificial-flowers', 'patrimora', 'frogdna', 'two-burdens', 'recursive-mind', 'hidden-landscapes', 'roads-and-rivers'],
    archive: ['seize-and-share', 'id-please'],
    geodetic: ['geodetic-onchain', 'geodetic-world', 'geodetica', 'geodetic-moments', 'geodetic-home', 'geodetic-memory'],
    'ai-studies': ['visual-language', 'panoptic', 'wallet'],
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

  groupsWithCollections(idx) {
    const by = {};
    for (const c of idx.collections) {
      if (!(c.counts.works || c.counts.child_works)) continue;
      (by[c.group] = by[c.group] || []).push(c);
    }
    return idx.groups
      .map((g) => ({ ...g, collections: this.sortGroup(g.id, by[g.id] || []) }))
      .filter((g) => g.collections.length);
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
