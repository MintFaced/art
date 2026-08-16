/* mintface.art shared runtime. No build step, no dependencies. */

/* ─────────────────────────────────────────────────────────────
   ASSET BASE URL ... change this one line when storage moves
   ───────────────────────────────────────────────────────────── */
const ASSETS_BASE = 'https://pub-40b0b488cd5b4b6597427eb295d7ca63.r2.dev/assets';

/* ─────────────────────────────────────────────────────────────
   THUMBNAIL SOURCE ... change this one line when R2 holds thumbs
   '' turns proxying off and grids load the full master files
   ───────────────────────────────────────────────────────────── */
const THUMB_PROXY = 'https://images.weserv.nl/?url={url}&w={w}&output=webp&q=80';

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
  imageUrl(work) {
    if (work.assets && work.assets.image) return `${ASSETS_BASE}/${work.assets.image}`;
    return work.digital?.image_source || work.digital?.image || work.image || null;
  },
  // hosts that already serve sized images, or that the proxy cannot reach
  THUMB_BYPASS: ['i.seadn.io', 'lh3.googleusercontent.com', 'highlight-creator-assets.highlight.xyz'],

  // grids ask for a width, masters are far too heavy to browse
  thumbUrl(work, width) {
    if (work.assets && work.assets.thumb) return `${ASSETS_BASE}/${work.assets.thumb}`;
    const url = this.imageUrl(work);
    if (!url) return null;
    if (!THUMB_PROXY || url.startsWith('data:') || url.startsWith('/')) return url;
    if (this.THUMB_BYPASS.some((h) => url.includes(h))) return url;
    return THUMB_PROXY
      .replace('{url}', encodeURIComponent(url.replace(/^https?:\/\//, '')))
      .replace('{w}', String(width || 600));
  },

  isSVG(url) {
    return typeof url === 'string' && /\.svg(\?|#|$)/i.test(url);
  },

  // an <img> that falls back to the master if the thumbnail source fails
  img(work, width, opts) {
    const o = opts || {};
    const thumb = this.thumbUrl(work, width);
    if (!thumb) return '';
    // The animated version is the work, so the work page loads the SVG itself and
    // lets its own stylesheet run. If that source is unreachable, the browser
    // renders the child instead: a proxied still, which is the fallback, not the
    // default.
    if (o.live && this.isSVG(this.imageUrl(work))) {
      const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
      const ratio = work.digital && work.digital.aspect_ratio;
      return `<object type="image/svg+xml" data="${this.escape(this.imageUrl(work))}" aria-label="${alt}" class="live"${ratio ? ` style="aspect-ratio:${this.escape(ratio)}"` : ''}>`
        + `<img src="${this.escape(thumb)}" alt="${alt}" loading="eager" decoding="async" onload="this.classList.add('in')">`
        + `</object>`;
    }
    const master = this.imageUrl(work);
    const alt = this.escape(o.alt != null ? o.alt : work.title || 'Work by MintFace');
    const fallback = master && master !== thumb ? ` data-fallback="${this.escape(master)}"` : '';
    return `<img src="${this.escape(thumb)}" alt="${alt}"${fallback}`
      + ` loading="${o.eager ? 'eager' : 'lazy'}" decoding="async"`
      + (o.eager ? ' fetchpriority="high"' : '')
      + ` onload="this.classList.add('in')" onerror="MF.imgFallback(this)"${o.cls ? ` class="${o.cls}"` : ''}>`;
  },

  imgFallback(el) {
    const fb = el.getAttribute('data-fallback');
    if (fb && !el.src.endsWith(fb)) {
      el.removeAttribute('data-fallback');
      el.src = fb;
      return;
    }
    const shot = el.parentElement;
    el.remove();
    if (shot && shot.classList.contains('shot')) shot.classList.add('empty');
  },

  animationUrl(work) {
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
    if (currency === 'NZD') return '$' + Math.round(nzd).toLocaleString('en-NZ');
    if (currency === 'USD') return fx.usd ? 'US$' + Math.round(nzd * fx.usd).toLocaleString('en-US') : null;
    if (currency === 'ETH') return fx.eth ? (nzd * fx.eth).toFixed(2) + ' ETH' : null;
    return null;
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
  ROUTES: { genesis: '/genesis', '2022-10k': '/10k', 'the-vault': '/vault' },

  collectionHref(c) {
    return this.ROUTES[c.slug] || `/c/${encodeURIComponent(c.slug)}`;
  },

  collectionCard(c) {
    const e = this.escape;
    const cover = c.cover && c.cover.image ? { digital: { image: c.cover.image }, title: c.title } : null;
    const n = c.counts.works || c.counts.child_works || 0;
    const bits = [c.year, `${n} ${n === 1 ? 'work' : 'works'}`].filter(Boolean);
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

  // groups, in the order the catalog gives them, with the locked geodetic run
  groupOrder: {
    core: ['pixelarcade', 'artificial-flowers', 'patrimora', 'frogdna', 'id-please', 'two-burdens', 'recursive-mind', 'hidden-landscapes', 'roads-and-rivers'],
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

  escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};

window.MF = MF;
