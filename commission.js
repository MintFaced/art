/* The commission page (commission.html, STRIP-CHECKOUT).
 *
 *   /commission/{id}         pay: card or ETH, the details a painting needs
 *   /commission/{id}/paid    "Commissioned."
 *
 * The order is the server's (/api/commission). The page shows it, sends the
 * buyer's details and choices, and never an amount. Changing an order takes
 * the key it was made with, which arrives after a # (never sent anywhere,
 * never in a log) and is kept in this browser.
 */
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = document.getElementById('main');
const KEYS = 'mf_commission_keys';
const STRIP_ETH_NZD = 5000;
const START_AGAIN = '/#stripSection';

const [, , ID, PAID] = location.pathname.split('/');
const keyStore = {
  all() { try { return JSON.parse(localStorage.getItem(KEYS) || '{}'); } catch { return {}; } },
  get(id) { return this.all()[id] || null; },
  set(id, k) { try { localStorage.setItem(KEYS, JSON.stringify({ ...this.all(), [id]: k })); } catch { /* private window: the # keeps it */ } },
};
const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromHash) {
  keyStore.set(ID, fromHash);
  history.replaceState(null, '', location.pathname + location.search);
}
const KEY = fromHash || keyStore.get(ID);

const api = async (body) => {
  const r = await fetch('/api/commission', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ID, key: KEY, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `error ${r.status}`), { status: r.status });
  return j;
};
const view = async () => {
  if (KEY) { try { return { o: await api({ action: 'read' }), mine: true }; } catch (err) { if (err.status !== 403) throw err; } }
  const r = await fetch(`/api/commission?id=${encodeURIComponent(ID)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `error ${r.status}`), { status: r.status });
  return { o: j, mine: false };
};

const nzd = (n) => `NZD ${Number(n).toLocaleString('en-NZ')}`;
const priceLine = (o) => [nzd(o.price.nzd), `${o.price.eth} ETH`, o.price.usd ? `USD ${Number(o.price.usd).toLocaleString('en-US')}` : null].filter(Boolean).join(' · ');
const PAID_STATES = ['paid', 'in_studio', 'painted', 'shipped', 'collected', 'complete'];

/* The painting, from the order's own strips: portrait stands them up,
   landscape lays them from the bottom up, edges rounded once. */
function drawInto(canvas, o, maxW, maxH) {
  const portrait = o.spec.orientation === 'portrait';
  const L = o.spec.length_cm;
  const W = o.spec.width_cm;
  const pw0 = portrait ? W : L;
  const ph0 = portrait ? L : W;
  const k = Math.min(maxW / pw0, maxH / ph0);
  const pw = Math.max(1, Math.round(pw0 * k));
  const ph = Math.max(1, Math.round(ph0 * k));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(pw * dpr);
  canvas.height = Math.round(ph * dpr);
  canvas.style.width = `${pw}px`;
  canvas.style.height = `${ph}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const total = o.strips.reduce((n, s) => n + s.mm, 0) || 1;
  const across = portrait ? pw : ph;
  let mm = 0;
  for (const s of o.strips) {
    const a = Math.round((mm / total) * across);
    const b = Math.round(((mm + s.mm) / total) * across);
    ctx.fillStyle = s.hex;
    if (portrait) ctx.fillRect(a, 0, b - a, ph);
    else ctx.fillRect(0, ph - b, pw, b - a);
    mm += s.mm;
  }
  canvas.setAttribute('aria-label', `The Strip Painting on order ${o.id}: ${o.spec_line}`);
}

function artColumn(o) {
  return `<div class="cm-art">
    <canvas data-art role="img"></canvas>
    <p class="cm-ref">${e(o.id)}</p>
    <p class="cm-line">${e(o.spec_line)}</p>
    <p class="cm-line">${e(priceLine(o))}</p>
  </div>`;
}
function paintArt(o) {
  const c = main.querySelector('[data-art]');
  if (!c) return;
  const box = c.parentElement.clientWidth || 480;
  drawInto(c, o, Math.min(box, 560), window.innerWidth <= 820 ? 360 : 480);
}

/* ---------------------------------------------------------------- states */

function showPaid(o) {
  document.title = `${o.id} commissioned ... MintFace`;
  main.innerHTML = `<div class="cm-grid">${artColumn(o)}
    <div class="cm-done">
      <h1>Commissioned.</h1>
      <p class="cm-line">${o.method === 'eth' ? 'Paid in ETH' : 'Paid by card'}</p>
      <p>Allow ${e(o.lead_weeks)} weeks. We'll send a photograph before it ships.</p>
      <p class="grey">The confirmation, with the painting attached, is on its way to your inbox.</p>
    </div></div>`;
  paintArt(o);
}

function showExpired(o) {
  main.innerHTML = `<div class="cm-grid">${artColumn(o)}
    <div class="cm-done"><h1>Commission.</h1><p>This quote has expired. <a href="${START_AGAIN}">Start again →</a></p></div></div>`;
  paintArt(o);
}

function showElsewhere(o) {
  main.innerHTML = `<div class="cm-grid">${artColumn(o)}
    <div class="cm-done"><h1>Commission.</h1><p>This order was started in another browser. Open its link there, or <a href="${START_AGAIN}">start again →</a></p></div></div>`;
  paintArt(o);
}

async function showConfirming() {
  main.innerHTML = '<p class="mono grey">Confirming the payment</p>';
  for (let i = 0; i < 40; i += 1) {
    const { o } = await view();
    if (PAID_STATES.includes(o.status)) return showPaid(o);
    await new Promise((r) => setTimeout(r, 2000));
  }
  main.innerHTML = `<p>The payment has not been confirmed yet. It can take a minute; this page will say so when it is. If it does not, write to <a href="mailto:art@mintface.art?subject=${encodeURIComponent(ID)}">art@mintface.art</a> with ${e(ID)}.</p>`;
}

/* --------------------------------------------------------------- paying */

function showPay(o) {
  const S = { o, currency: 'NZD', polling: null };
  main.innerHTML = `<div class="cm-grid">${artColumn(o)}
    <div>
      <h1>Commission.</h1>
      <form data-form novalidate>
        <label>Name<input type="text" name="name" autocomplete="name" value="${e(o.name || '')}"></label>
        <label>Email<input type="email" name="email" autocomplete="email" value="${e(o.email || '')}"></label>
        <label data-ship-field ${o.spec.delivery === 'shipped' ? '' : 'hidden'}>Ship to<textarea name="ship_to" autocomplete="street-address" rows="4">${e(o.ship_to || '')}</textarea></label>
        <p class="grey" style="margin:0"><span data-ship-say></span> <button type="button" class="cm-quiet" data-ship></button></p>
        <label class="check"><input type="checkbox" name="mention" ${o.mention ? 'checked' : ''}> Mention me on X</label>
        <label data-handle ${o.mention ? '' : 'hidden'}>X handle<input type="text" name="x_handle" value="${e(o.x_handle ? `@${o.x_handle}` : '')}" placeholder="@"></label>
        <div class="cm-doors" data-doors>
          <button type="button" class="cm-btn" data-card>Pay by card</button>
          <button type="button" class="cm-btn ghost" data-eth>Pay with ETH</button>
        </div>
        <p class="mono grey" data-currency>Card in <button type="button" class="cm-quiet mono" data-cur="NZD" aria-pressed="true">NZD</button> · <button type="button" class="cm-quiet mono" data-cur="USD" aria-pressed="false">USD</button></p>
        <p class="cm-say" data-say role="status" aria-live="polite"></p>
        <div class="cm-eth" data-ethbox hidden></div>
      </form>
    </div></div>`;
  paintArt(o);
  const $ = (s) => main.querySelector(s);
  const say = (msg, err = false) => { const p = $('[data-say]'); p.textContent = msg || ''; p.classList.toggle('err', err); };

  const words = () => {
    const shipped = S.o.spec.delivery === 'shipped';
    $('[data-ship-say]').textContent = shipped ? 'Shipped worldwide, boxed.' : 'Collected from The Line, Hastings.';
    $('[data-ship]').textContent = shipped ? 'Collect from The Line instead →' : 'Ship it worldwide, boxed →';
    $('[data-ship-field]').hidden = !shipped;
    main.querySelectorAll('.cm-line')[0].textContent = S.o.spec_line;
    main.querySelectorAll('.cm-line')[1].textContent = priceLine(S.o);
    for (const b of main.querySelectorAll('[data-cur]')) b.setAttribute('aria-pressed', String(b.dataset.cur === S.currency));
    for (const b of main.querySelectorAll('[data-cur]')) b.style.color = b.dataset.cur === S.currency ? 'var(--ink)' : '';
  };
  words();

  const fields = () => {
    const f = $('[data-form]');
    return { name: f.name.value, email: f.email.value, ship_to: f.ship_to.value, mention: f.mention.checked, x_handle: f.x_handle.value };
  };
  let saving = null;
  const saveNow = async () => {
    clearTimeout(saving);
    try { S.o = await api({ action: 'update', ...fields() }); say(''); return true; } catch (err) { say(err.message, true); return false; }
  };
  $('[data-form]').addEventListener('input', (ev) => {
    if (ev.target.name === 'mention') $('[data-handle]').hidden = !ev.target.checked;
    clearTimeout(saving);
    saving = setTimeout(saveNow, 600);
  });
  $('[data-ship]').addEventListener('click', async () => {
    try {
      S.o = await api({ action: 'update', ...fields(), delivery: S.o.spec.delivery === 'shipped' ? 'collect' : 'shipped' });
      words();
      if (!$('[data-ethbox]').hidden) await openEth(); // the amount moved with the price
    } catch (err) { say(err.message, true); }
  });
  for (const b of main.querySelectorAll('[data-cur]')) b.addEventListener('click', () => { S.currency = b.dataset.cur; words(); });

  $('[data-card]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    if (!(await saveNow())) { btn.disabled = false; return; }
    try {
      say('Opening the card checkout');
      const { url } = await api({ action: 'card', currency: S.currency });
      location.href = url;
    } catch (err) { say(err.message, true); btn.disabled = false; }
  });

  async function openEth() {
    if (!(await saveNow())) return;
    try { S.o = await api({ action: 'eth' }); } catch (err) { say(err.message, true); return; }
    const x = S.o.eth;
    if (!x) { say('This order is not waiting on ETH any more.', true); return; }
    const box = $('[data-ethbox]');
    box.hidden = false;
    box.innerHTML = `
      <p class="amount">${e(x.amount)} ETH</p>
      <p class="mono grey">at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH · holds until ${e(new Date(S.o.expires_at).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
      <div class="cm-doors"><button type="button" class="cm-btn" data-send>Pay from a connected wallet</button></div>
      <p class="grey" style="margin:0">Or send exactly that amount from any wallet, an exchange or a Ledger to ${e(x.ens)}. This page watches for it.</p>
      <div class="cm-addr"><span data-addr>${e(x.address)}</span><button type="button" class="cm-quiet" data-copy>Copy</button></div>
      <div class="cm-qr" aria-label="QR code for ${e(x.amount)} ETH to ${e(x.address)}" role="img">${x.qr}</div>
      <p class="mono" data-got></p>`;
    $('[data-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(x.address); say('Address copied'); } catch { say('Could not reach the clipboard', true); } });
    $('[data-send]').addEventListener('click', sendFromWallet);
    received();
    poll();
  }
  $('[data-eth]').addEventListener('click', openEth);

  function received() {
    const x = S.o.eth;
    const p = $('[data-got]');
    if (!x || !p) return;
    if (x.pending_tx) p.textContent = 'Transaction sent · waiting for two confirmations';
    else if (Number(x.received) > 0) p.textContent = `${x.received} of ${x.amount} ETH received · ${x.remaining} to go`;
    else p.textContent = 'Waiting for the payment';
  }

  function poll() {
    clearInterval(S.polling);
    S.polling = setInterval(async () => {
      try {
        const { o: fresh } = await view();
        if (PAID_STATES.includes(fresh.status)) { clearInterval(S.polling); history.replaceState(null, '', `/commission/${ID}/paid`); showPaid(fresh); return; }
        if (fresh.status === 'expired') { clearInterval(S.polling); showExpired(fresh); return; }
        S.o = fresh;
        received();
      } catch { /* a missed poll is caught by the next */ }
    }, 10000);
  }

  async function sendFromWallet(ev) {
    const btn = ev.currentTarget;
    const x = S.o.eth;
    if (!window.MF || !MF.connect) { say('No wallet connection here; send from any wallet instead.', true); return; }
    btn.disabled = true;
    try {
      say('Connecting your wallet');
      const from = await MF.connect(null, { onState: (s) => say(s === 'slow' ? 'Still connecting...' : 'Connecting your wallet') });
      const provider = MF._wallet && MF._wallet.provider;
      if (!provider) throw new Error('No wallet answered');
      const chain = await provider.request({ method: 'eth_chainId' }).catch(() => '0x1');
      if (String(chain).toLowerCase() !== '0x1') throw new Error('Switch your wallet to Ethereum mainnet, then try again');
      say('Confirm the payment in your wallet');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from, to: x.address, value: `0x${BigInt(x.wei).toString(16)}`, data: x.data }] });
      S.o = await api({ action: 'eth-tx', hash });
      say('Sent. Waiting for two confirmations; this page will move on by itself.');
      received();
    } catch (err) {
      say(err && err.code === 4001 ? 'Cancelled in the wallet.' : (err.message || 'The wallet did not send it'), true);
    } finally { btn.disabled = false; }
  }

  /* An order already waiting on ETH opens with its panel up. */
  if (o.eth) openEth();
}

/* ----------------------------------------------------------------- start */

(async () => {
  if (!/^SP-\d{4}-\d{4,}$/.test(ID || '')) { main.innerHTML = `<p>No such commission. <a href="${START_AGAIN}">Start one →</a></p>`; return; }
  try {
    const { o, mine } = await view();
    if (PAID_STATES.includes(o.status)) return showPaid(o);
    if (PAID === 'paid') return showConfirming();
    if (o.status === 'expired') return showExpired(o);
    if (o.status !== 'pending_payment') return showPaid(o);
    if (!mine) return showElsewhere(o);
    showPay(o);
  } catch (err) {
    main.innerHTML = err.status === 404
      ? `<p>No such commission. <a href="${START_AGAIN}">Start one →</a></p>`
      : `<p>The commission could not be loaded. Try again in a moment, or write to <a href="mailto:art@mintface.art">art@mintface.art</a>.</p>`;
  }
})();
