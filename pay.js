/* A private offer, from the buyer's side (pay.html). The link carries the key
 * after #k=. It is read once, kept in this browser, and taken out of the
 * address bar, so a screenshot or a shared tab doesn't carry it on. It goes to
 * the server in a header, never in a URL. No amount ever leaves this page.
 */
const KEYS = 'mf_offer_keys';
const STUDIO = 'ryan@mintface.art';
const MSG = {
  someoneElse: 'This link belongs to someone else.',
  ended: 'This offer has ended. Write to the studio.',
  paid: 'Paid. Thank you.',
};

const [, , ID] = location.pathname.split('/');
const keyStore = {
  all() { try { return JSON.parse(localStorage.getItem(KEYS) || '{}'); } catch { return {}; } },
  get(id) { return this.all()[id] || null; },
  set(id, k) { try { localStorage.setItem(KEYS, JSON.stringify({ ...this.all(), [id]: k })); } catch { /* private window: this visit still has it */ } },
};
const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
if (fromHash) {
  keyStore.set(ID, fromHash);
  history.replaceState(null, '', location.pathname + location.search);
}
const KEY = fromHash || keyStore.get(ID);
/* a new link opened in a tab already on this offer changes only the #: reload, so the new key is read */
window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).get('k')) location.reload(); });

const main = document.getElementById('main');
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nz = (n, cents = false) => Number(n).toLocaleString('en-NZ', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 });
const mail = `<a href="mailto:${STUDIO}">${STUDIO}</a>`;

async function view() {
  if (!KEY || !/^OF-\d{4}-\d{4,}$/.test(ID || '')) return { status: 403 };
  const r = await fetch(`/api/offer?id=${encodeURIComponent(ID)}`, { headers: { 'x-offer-key': KEY }, cache: 'no-store' });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

function done(title, body) {
  main.innerHTML = `<div class="po-done"><h1>${e(title)}</h1>${body ? `<p>${body}</p>` : ''}</div>`;
}

function paidPage(o) {
  done(MSG.paid, `${e(o.work.title)} is yours. Your receipt is on its way by email.${o.delivery === 'collect' && o.what !== 'digital' ? ' Ryan will write to arrange collection from The Line.' : ''}`);
}

function offerPage(o) {
  const amount = `NZD ${nz(o.nzd)}${o.gst_inclusive ? ' including GST' : ''}`;
  main.innerHTML = `<div class="po-grid">
    <div class="po-art">${o.work.image ? `<img src="${e(o.work.image)}" alt="${e(o.work.title)}">` : ''}</div>
    <div>
      <h1>${e(o.work.title)}</h1>
      ${o.work.spec_line ? `<p class="po-spec">${e(o.work.spec_line)}</p>` : ''}
      <p class="po-for">For ${e(o.buyer_name)}</p>
      <p class="po-amt">${e(amount)}</p>
      ${o.gst_inclusive ? `<p class="po-gst">GST NZD ${e(nz(o.gst, true))}</p>` : ''}
      <p class="po-del">${e(o.delivery_line)}</p>
      <button type="button" class="po-btn" id="card">Pay by card</button>
      <p class="po-say" id="say" role="status"></p>
      <p class="po-until">This offer is open until ${e(new Date(o.expires).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>
    </div>
  </div>`;
  const btn = document.getElementById('card');
  const say = document.getElementById('say');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    say.textContent = 'Opening the card checkout';
    try {
      const r = await fetch('/api/offer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'card', id: ID, key: KEY }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) { location.href = j.url; return; }
      if (r.status === 403) return done(MSG.someoneElse, `If it was sent to you, write to ${mail}.`);
      if (r.status === 410) return done(MSG.ended, mail);
      if (r.status === 409) return start();
      say.textContent = j.error || 'Something went wrong. Try again in a minute.';
    } catch {
      say.textContent = 'The connection dropped. Try again.';
    }
    btn.disabled = false;
  });
}

/* back from Stripe: the webhook marks it paid, usually within seconds */
async function confirming(first) {
  done('Payment received', 'Confirming it now.');
  let last = first;
  for (let i = 0; i < 15 && last.j && last.j.state !== 'paid'; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    last = await view();
  }
  if (last.j && last.j.state === 'paid') return paidPage(last.j);
  done('Payment received', 'It is still being confirmed. Your receipt will come by email; there is nothing more to do.');
}

async function start() {
  let v;
  try { v = await view(); } catch { return done('Not loading', 'Check the connection and reload this page.'); }
  if (v.status === 403 || v.status === 404) return done(MSG.someoneElse, `If it was sent to you, write to ${mail}.`);
  if (v.status === 410) return done(MSG.ended, mail);
  if (v.status !== 200) return done('Not loading', `Reload this page in a minute, or write to ${mail}.`);
  if (v.j.state === 'paid') return paidPage(v.j);
  if (new URLSearchParams(location.search).has('paid')) return confirming(v);
  offerPage(v.j);
}

start();
