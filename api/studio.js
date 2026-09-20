import { STUDIO_PATH, studioConfigured } from './_lib/studio.js';

// The studio page is served from here rather than sitting in the static tree,
// so an unknown path returns nothing at all. The password is still the lock;
// this only keeps the door from being found.
export async function GET(request) {
  // Reachable two ways: /s/{path} explicitly, and a bare /{path}, which is the
  // address a person actually types. The bare form is a catch-all, so anything
  // that is not the secret has to leave here as a plain 404.
  const pathname = new URL(request.url).pathname;
  const m = pathname.match(/^\/s\/(.+?)\/?$/) || pathname.match(/^\/([^/]+?)\/?$/);
  const key = decodeURIComponent((m || [])[1] || '');
  if (!studioConfigured() || !key || key !== STUDIO_PATH) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Studio</title>
<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/mintface.css">
<style>
body{padding:0 0 60px}
.wrap{max-width:560px;margin:0 auto;padding:26px 20px}
h1{font-family:var(--font-sans);font-weight:400;font-size:30px;letter-spacing:-.03em;margin:0 0 4px}
.sub{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:26px}
label{display:block;margin:18px 0 0}
.lab{font-family:var(--font-sans);font-weight:500;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
input,select,textarea,button{font-family:var(--font-sans);font-size:16px;color:var(--ink)}
.sec{font-family:var(--font-sans);font-weight:500;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);margin:38px 0 14px;padding-top:26px;border-top:1px solid var(--rule)}
.nudge{border-bottom:1px solid var(--rule);padding:0 0 18px;margin-bottom:18px}
.nudge h3{font-family:var(--font-sans);font-weight:400;font-size:17px;letter-spacing:-.01em;margin:0 0 6px}
.nudge .meta,.nudge .bar-l{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--faint)}
.nudge .meter{height:1px;background:var(--rule);margin:5px 0 11px;position:relative}
.nudge .meter i{position:absolute;left:0;top:0;height:1px;background:var(--ink);display:block}
.nudge .meter.met i{background:var(--dot-available)}
.swatches{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.sw{display:flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:11px;
  background:none;border:1px solid var(--rule);border-radius:0;padding:6px 9px;width:auto;cursor:pointer}
.sw[aria-pressed="true"]{border-color:var(--ink)}
.sw b{width:13px;height:13px;display:inline-block;border:1px solid rgba(0,0,0,.14)}
.confirm{border:1px solid var(--ink);padding:14px;margin:14px 0}
.confirm .willsay{font-family:var(--font-mono);font-size:11px;letter-spacing:.13em;
  text-transform:uppercase;line-height:1.55;color:var(--ink)}
.confirm .cap{font-family:var(--font-sans);font-weight:500;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);margin:0 0 8px}
details summary{font-family:var(--font-sans);font-weight:500;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--muted);cursor:pointer;margin-top:8px}
input,select,textarea{
  width:100%;background:none;border:0;border-bottom:1px solid var(--rule);
  padding:9px 0;border-radius:0;-webkit-appearance:none;
}
input:focus,select:focus,textarea:focus{outline:0;border-bottom-color:var(--ink)}
input[type=number]{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.row{display:flex;gap:14px}
.row label{flex:1}
.btn{
  width:100%;margin-top:26px;background:var(--ink);color:var(--paper);border:0;cursor:pointer;
  padding:16px;font-weight:500;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
}
.btn[disabled]{opacity:.35;cursor:default}
.btn.quiet{background:none;color:var(--muted);border:1px solid var(--rule)}
.note{font-size:13px;color:var(--muted);line-height:1.6;margin:14px 0 0}
.bad{color:#8b3a2a}
.ok{color:var(--dot-available)}
.shot{margin-top:14px;border:1px solid var(--rule);padding:8px}
.shot img{width:100%;height:auto;display:block}
.list{margin-top:44px;border-top:1px solid var(--ink);padding-top:14px}
.item{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:13px 0;border-bottom:1px solid var(--rule)}
.item .t{font-size:15px}
.item .s{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.item button{background:none;border:0;cursor:pointer;font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:0}
.hidden{display:none}
.row-toggle{display:flex;align-items:center;gap:10px;margin-top:22px}
.row-toggle input{width:auto;-webkit-appearance:checkbox;appearance:checkbox}
.row-toggle .lab{margin:0}
</style>
</head>
<body>
<div class="wrap">

<div id="gate">
  <h1>Studio</h1>
  <div class="sub">MintFace</div>
  <label><span class="lab">Password</span>
    <input type="password" id="pw" autocomplete="current-password" enterkeyhint="go"></label>
  <button class="btn" id="in">Enter</button>
  <p class="note" id="gateSay"></p>
</div>

<div id="app" class="hidden">
  <h1 id="mode">New work</h1>
  <div class="sub">Recent Work</div>

  <label><span class="lab">Photograph</span>
    <input type="file" id="photo" accept="image/*" capture="environment"></label>
  <div class="shot hidden" id="shot"><img id="shotImg" alt=""></div>
  <p class="note" id="upSay"></p>

  <label><span class="lab">Title</span><input id="title" enterkeyhint="next"></label>

  <div class="row">
    <label><span class="lab">W cm</span><input type="number" id="dw" inputmode="decimal"></label>
    <label><span class="lab">H cm</span><input type="number" id="dh" inputmode="decimal"></label>
    <label><span class="lab">D cm</span><input type="number" id="dd" inputmode="decimal"></label>
  </div>

  <div class="row">
    <label><span class="lab">Digital NZD</span><input type="number" id="pDigital" inputmode="numeric"></label>
    <label><span class="lab">Painting NZD</span><input type="number" id="pPainting" inputmode="numeric"></label>
    <label><span class="lab">Both NZD</span><input type="number" id="pBoth" inputmode="numeric"></label>
  </div>
  <p class="note">Leave a price blank to hide that option. All three blank reads as Enquire.</p>

  <label><span class="lab">Statement</span>
    <textarea id="statement" rows="3" placeholder="Optional. Shown under Description on the work page."></textarea></label>

  <label><span class="lab">Medium</span><input id="medium" value="Acrylic on timber"></label>

  <label><span class="lab">Edition</span>
    <select id="editionKind">
      <option value="1/1">1/1</option>
      <option value="edition">Edition of N</option>
      <option value="other">Other</option>
    </select></label>
  <label class="hidden" id="editionOfWrap"><span class="lab">Edition of</span>
    <input type="number" id="editionOf" inputmode="numeric" min="2" placeholder="25"></label>
  <label class="hidden" id="editionFreeWrap"><span class="lab">Edition detail</span><input id="editionFree"></label>

  <label class="row-toggle"><input type="checkbox" id="hidden">
    <span class="lab">Hide from the site</span></label>

  <label><span class="lab">Year</span><input id="year" inputmode="numeric"></label>
  <label><span class="lab">Notes, private</span><textarea id="notes" rows="2"></textarea></label>

  <button class="btn" id="pub" disabled>Publish</button>
  <button class="btn quiet hidden" id="cancel">New work instead</button>
  <p class="note" id="say"></p>

  <div class="list" id="list"></div>

  <!-- The round, run from the phone. Ten of these remain in the series and
       each one used to be a directive: numbers read by hand, a file edited by
       somebody else. -->
  <section id="nudges" class="nudges-admin">
    <h2 class="sec">Nudges</h2>
    <div id="nudgeOpen" class="note">Loading</div>

    <details id="newNudge">
      <summary>New nudge</summary>
      <label><span class="lab">Question</span><input id="nqQ" enterkeyhint="next"></label>
      <label><span class="lab">Note</span><textarea id="nqNote" rows="3"></textarea></label>
      <label><span class="lab">Closes</span><input type="date" id="nqCloses"></label>
      <p class="note" id="nqPrefill"></p>
      <button class="btn" id="nqGo">Open nudge</button>
      <p class="note" id="nqSay"></p>
    </details>
  </section>
</div>

</div>
<script>
const $ = (id) => document.getElementById(id);
const api = (q, body) => fetch('/api/studio-api?do=' + q, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));

let IMAGE = null;
let EDITING = null;

$('in').addEventListener('click', async () => {
  $('gateSay').textContent = 'Checking...';
  const r = await api('login', { password: $('pw').value });
  if (!r.ok) { $('gateSay').textContent = r.body.error || 'No.'; $('gateSay').className = 'note bad'; return; }
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('year').value = String(new Date().getFullYear());
  loadList();
  loadNudges();
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('in').click(); });

/* ------------------------------------------------------------ the round
 *
 * What is open and how far it is, a close that shows exactly what it will
 * write, and a form for the next one. The confirm step is the point of this:
 * an artist locking a colour against the thresholds is making a public
 * statement about their own power, and they should read the sentence that
 * statement will be before it exists, not a description of it.
 */
let NUDGES = null;
let PICKED = {};

const esc2 = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nnum = (n) => Math.round(Number(n) || 0).toLocaleString('en-NZ');
const dayOf = (d) => { const x = new Date(d); return x.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }).toUpperCase(); };

async function loadNudges() {
  $('nudgeOpen').textContent = 'Loading';
  const r = await api('nudge-state', {});
  if (!r.ok) { $('nudgeOpen').textContent = r.body.error || 'Could not read the nudges.'; return; }
  NUDGES = r.body;
  drawNudges();
  prefill();
}

function meter(label, at, of) {
  const met = at >= of;
  const pct = Math.max(0, Math.min(100, of ? (at / of) * 100 : 0));
  return '<div class="bar-l">' + esc2(label) + ' ' + nnum(at) + ' of ' + nnum(of) + (met ? ' &middot; met' : '') + '</div>'
    + '<div class="meter' + (met ? ' met' : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
}

function drawNudges() {
  const open = (NUDGES && NUDGES.open) || [];
  if (!open.length) { $('nudgeOpen').textContent = 'Nothing open.'; return; }
  $('nudgeOpen').className = '';
  $('nudgeOpen').innerHTML = open.map((n) => {
    const p = n.progress || { voters: { at: 0, of: 0 }, tao: { at: 0, of: 0 } };
    const picked = PICKED[n.id] || (n.leader ? n.leader.hex : null);
    const sw = (n.candidates || []).map((c) =>
      '<button type="button" class="sw" data-pick="' + esc2(n.id) + '" data-hex="' + esc2(c.hex) + '"'
      + ' aria-pressed="' + String(c.hex === picked) + '">'
      + '<b style="background:' + esc2(c.hex) + '"></b>' + esc2(c.hex) + ' &middot; ' + nnum(c.total) + ' &middot; ' + c.voters + '</button>').join('');
    return '<div class="nudge" data-n="' + esc2(n.id) + '">'
      + '<div class="meta">Nudge #' + n.number + ' &middot; closes ' + dayOf(n.closes)
      + (n.slot ? ' &middot; colour ' + n.slot + ' of ' + ((NUDGES.series && Number(NUDGES.series.slots)) || 12) : '') + '</div>'
      + '<h3>' + esc2(n.question) + '</h3>'
      + '<div class="meta">' + n.collectors + ' collectors &middot; ' + nnum(n.total) + ' TAO weighed</div>'
      + meter('Voters on the leader', p.voters.at, p.voters.of)
      + meter('TAO on the leader', p.tao.at, p.tao.of)
      + '<div class="swatches">' + sw + '</div>'
      + '<button class="btn" data-close="' + esc2(n.id) + '">Close &amp; lock</button>'
      + '<div data-confirm="' + esc2(n.id) + '"></div>'
      + '</div>';
  }).join('');
}

/* One delegated listener: the list is redrawn whole after every act, and
   handlers bound to the old nodes would be handlers bound to nothing. */
$('nudgeOpen').addEventListener('click', async (ev) => {
  const pick = ev.target.closest('[data-pick]');
  if (pick) { PICKED[pick.dataset.pick] = pick.dataset.hex; drawNudges(); return; }

  const close = ev.target.closest('[data-close]');
  if (close) {
    const id = close.dataset.close;
    const n = (NUDGES.open || []).find((x) => x.id === id);
    const hex = PICKED[id] || (n && n.leader ? n.leader.hex : null);
    if (!hex) { alert('Nothing on the board to lock.'); return; }
    const slot = $('nudgeOpen').querySelector('[data-confirm="' + id + '"]');
    slot.innerHTML = '<p class="note">Reading the board&hellip;</p>';
    const r = await api('nudge-close', { id, lock: true, hex, preview: true });
    if (!r.ok) { slot.innerHTML = '<p class="note bad">' + esc2(r.body.error || 'No.') + '</p>'; return; }
    /* The sentence, not a summary of it. This is the card. */
    slot.innerHTML = '<div class="confirm">'
      + '<p class="cap">The banked card will say</p>'
      + '<p class="willsay">' + esc2(r.body.line) + '</p>'
      + (r.body.closed_early ? '<p class="note">Closing early &mdash; it was due ' + dayOf(r.body.closed_early) + '.</p>' : '')
      + (r.body.locked_by === 'artist' && r.body.met && !(r.body.met.voters && r.body.met.tao)
        ? '<p class="note">This is your lock, not the thresholds’. The shortfall stays on the card.</p>' : '')
      + ((r.body.dropped || []).length ? '<p class="note">' + esc2(r.body.dropped.join('; ')) + '</p>' : '')
      + '<button class="btn" data-do="' + esc2(id) + '" data-hex="' + esc2(hex) + '">Yes, bank it</button> '
      + '<button class="btn quiet" data-cancel="' + esc2(id) + '">Not yet</button>'
      + '</div>';
    return;
  }

  const cancel = ev.target.closest('[data-cancel]');
  if (cancel) { $('nudgeOpen').querySelector('[data-confirm="' + cancel.dataset.cancel + '"]').innerHTML = ''; return; }

  const go = ev.target.closest('[data-do]');
  if (go) {
    go.disabled = true;
    const r = await api('nudge-close', { id: go.dataset.do, lock: true, hex: go.dataset.hex });
    if (!r.ok) { go.disabled = false; alert(r.body.error || 'No.'); return; }
    await loadNudges();
  }
});

/* The next nudge fills in its own constraint and numbering. A colour nudge in
   a series is the same question every time with one number changed, and a
   number typed by hand is a number that will one day be typed wrong. */
function prefill() {
  const s = NUDGES && NUDGES.series;
  if (!s) { $('nqPrefill').textContent = ''; return; }
  /* seriesState: `slots` is the count, `board` is the twelve, `locked` is what
     has settled. */
  const board = s.board || [];
  const count = Number(s.slots) || 12;
  const filled = s.locked || [];
  const open = board.filter((x) => x && x.state === 'open');
  const slot = (board.find((x) => x && x.state === 'empty') || {}).slot || null;
  const nth = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'][slot] || ('colour ' + slot);
  if (!slot) { $('nqPrefill').textContent = 'The palette is full.'; return; }
  if (open.length) { $('nqPrefill').textContent = 'Nudge #' + open[0].number + ' is still asking for colour ' + open[0].slot + '.'; }
  $('nqQ').value = 'Weigh in on the ' + nth + ' colour.';
  const hexes = filled.map((f) => f.hex);
  $('nqNote').value = hexes.length === 1
    ? 'Colour one is locked and sits beside every candidate here. This one has to stand clear of it ... the picker will not take a colour that does not. Propose one, or put your TAO behind one already on the board. Weighed TAO is never spent and never moves.'
    : 'The colours already locked sit beside every candidate here: ' + hexes.join(', ')
      + '. This one has to stand clear of all of them ... the picker will not take a colour that does not. Propose one, or put your TAO behind one already on the board. Weighed TAO is never spent and never moves.';
  const d = new Date(Date.now() + 8 * 86400000);
  $('nqCloses').value = d.toISOString().slice(0, 10);
  $('nqPrefill').textContent = 'Slot ' + slot + ' of ' + (s.count || 12) + ' · nudge #' + (NUDGES.next_number || '?')
    + ' · clear of ' + (hexes.length ? hexes.join(', ') : 'nothing yet')
    + ' · thresholds carried from the series.';
  $('nqGo').dataset.slot = String(slot);
  $('nqGo').dataset.series = s.id || '';
}

$('nqGo').addEventListener('click', async () => {
  $('nqSay').textContent = 'Opening...';
  const r = await api('nudge', {
    question: $('nqQ').value,
    note: $('nqNote').value,
    closes: new Date($('nqCloses').value + 'T00:00:00Z').toISOString(),
    kind: 'candidates',
    series: $('nqGo').dataset.series || null,
    slot: Number($('nqGo').dataset.slot) || null,
    promise: 'MintFace will paint the colour this locks. A nudge steers; this one decides.',
    publish: true,
  });
  if (!r.ok) { $('nqSay').textContent = r.body.error || 'No.'; $('nqSay').className = 'note bad'; return; }
  $('nqSay').textContent = 'Nudge #' + r.body.number + ' is open.';
  $('nqSay').className = 'note';
  await loadNudges();
});


$('editionKind').addEventListener('change', () => {
  const k = $('editionKind').value;
  $('editionOfWrap').classList.toggle('hidden', k !== 'edition');
  $('editionFreeWrap').classList.toggle('hidden', k !== 'other');
  check();
});

// resize on the phone, so a 12MP photograph does not travel at full size
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const long = Math.max(img.width, img.height);
      const scale = long > 2400 ? 2400 / long : 1;
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read that photograph')); };
    img.src = url;
  });
}

$('photo').addEventListener('change', async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  $('upSay').className = 'note';
  $('upSay').textContent = 'Resizing...';
  try {
    const data = await shrink(file);
    $('shotImg').src = data;
    $('shot').classList.remove('hidden');
    $('upSay').textContent = 'Uploading...';
    const slug = ($('title').value || 'work') + '-' + Date.now().toString(36);
    const r = await api('upload', { data, slug });
    if (!r.ok) throw new Error(r.body.error || 'upload refused');
    IMAGE = r.body.url;
    $('upSay').className = 'note ok';
    $('upSay').textContent = 'Photograph stored.';
  } catch (err) {
    IMAGE = null;
    $('upSay').className = 'note bad';
    $('upSay').textContent = err.message;
  }
  check();
});

const num = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };

function problems() {
  const bad = [];
  if (!$('title').value.trim()) bad.push('a title');
  if (!(num('dw') > 0) || !(num('dh') > 0)) bad.push('width and height');
  if (!IMAGE) bad.push('a photograph');
  if ($('editionKind').value === 'edition' && !(num('editionOf') > 1)) bad.push('how many in the edition');
  if ($('editionKind').value === 'other' && !$('editionFree').value.trim()) bad.push('the edition detail');
  const d = num('pDigital'), p = num('pPainting'), b = num('pBoth');
  for (const [k, v] of [['digital', d], ['painting', p], ['both', b]]) {
    if (v != null && !(v > 0)) bad.push('a sensible ' + k + ' price');
  }
  if (b != null) {
    const floor = Math.max(d || 0, p || 0);
    if (floor && b < floor) bad.push('both at least the dearer single option');
    if (d != null && p != null && b > d + p) bad.push('both no more than the two added up');
  }
  return bad;
}

function check() {
  const bad = problems();
  $('pub').disabled = bad.length > 0;
  $('say').className = 'note';
  $('say').textContent = bad.length ? 'Still needs ' + bad.join(', ') + '.' : '';
}
['title', 'dw', 'dh', 'dd', 'pDigital', 'pPainting', 'pBoth', 'editionOf', 'editionFree'].forEach((id) =>
  $(id).addEventListener('input', check));

$('pub').addEventListener('click', async () => {
  $('pub').disabled = true;
  $('say').className = 'note';
  $('say').textContent = 'Publishing...';
  const kind = $('editionKind').value;
  const edition = kind === '1/1' ? '1/1'
    : kind === 'edition' ? 'Edition of ' + num('editionOf')
    : ($('editionFree').value.trim() || 'Edition');
  const work = {
    id: EDITING,
    title: $('title').value.trim(),
    year: $('year').value.trim(),
    medium: $('medium').value.trim(),
    edition,
    hidden: $('hidden').checked,
    statement: $('statement').value.trim() || null,
    dimensions: { w: num('dw'), h: num('dh'), d: num('dd') },
    pricing_nzd: { digital: num('pDigital'), painting: num('pPainting'), both: num('pBoth') },
    image: IMAGE,
    notes: $('notes').value.trim() || null,
  };
  const r = await api('publish', { work });
  if (!r.ok) {
    $('say').className = 'note bad';
    $('say').textContent = r.body.error || 'Refused.';
    $('pub').disabled = false;
    return;
  }
  // clear the form first: reset revalidates, and would write over this
  reset();
  $('say').className = 'note ok';
  $('say').innerHTML = 'Published, live shortly at <a href="' + r.body.url + '">' + r.body.url + '</a>';
  setTimeout(loadList, 1500);
});

$('cancel').addEventListener('click', () => reset());

function reset() {
  EDITING = null;
  IMAGE = null;
  $('mode').textContent = 'New work';
  $('cancel').classList.add('hidden');
  $('shot').classList.add('hidden');
  $('upSay').textContent = '';
  ['title', 'dw', 'dh', 'dd', 'pDigital', 'pPainting', 'pBoth', 'notes', 'statement', 'editionFree', 'editionOf'].forEach((id) => { $(id).value = ''; });
  $('hidden').checked = false;
  $('medium').value = 'Acrylic on timber';
  $('editionKind').value = '1/1';
  $('editionFreeWrap').classList.add('hidden');
  $('editionOfWrap').classList.add('hidden');
  check();
}

async function loadList() {
  const r = await fetch('/api/studio-api').then((x) => x.json()).catch(() => ({ works: [] }));
  const works = r.works || [];
  $('list').innerHTML = works.length
    ? works.map((w) => \`<div class="item">
        <span class="t">\${esc(w.title)}</span>
        <span class="s">\${esc(w.hidden ? 'hidden' : (w.status || 'available'))}</span>
        <button data-id="\${esc(w.id)}">Edit</button>
      </div>\`).join('')
    : '<p class="note">Nothing published yet.</p>';
  $('list').querySelectorAll('button[data-id]').forEach((b) =>
    b.addEventListener('click', () => edit(works.find((w) => w.id === b.dataset.id))));
}

function edit(w) {
  if (!w) return;
  EDITING = w.id;
  IMAGE = w.image || null;
  $('mode').textContent = 'Editing';
  $('cancel').classList.remove('hidden');
  $('title').value = w.title || '';
  $('year').value = w.year || '';
  $('medium').value = w.medium || 'Acrylic on timber';
  $('statement').value = w.statement || '';
  const d = w.dimensions || {};
  $('dw').value = d.w ?? ''; $('dh').value = d.h ?? ''; $('dd').value = d.d ?? '';
  const p = w.pricing_nzd || {};
  $('pDigital').value = p.digital ?? ''; $('pPainting').value = p.painting ?? ''; $('pBoth').value = p.both ?? '';
  $('notes').value = w.notes || '';
  const of = /^Edition of (\d+)$/.exec(w.edition || '');
  if (of) {
    $('editionKind').value = 'edition';
    $('editionOfWrap').classList.remove('hidden');
    $('editionOf').value = of[1];
  } else if (w.edition && w.edition !== '1/1') {
    $('editionKind').value = 'other';
    $('editionFreeWrap').classList.remove('hidden');
    $('editionFree').value = w.edition;
  }
  $('hidden').checked = w.hidden === true;
  if (w.image) { $('shotImg').src = w.image; $('shot').classList.remove('hidden'); }
  check();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
</script>
</body>
</html>`;
