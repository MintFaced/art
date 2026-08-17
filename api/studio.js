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

  <label><span class="lab">Medium</span><input id="medium" value="Acrylic on canvas"></label>

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
});
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('in').click(); });

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
  ['title', 'dw', 'dh', 'dd', 'pDigital', 'pPainting', 'pBoth', 'notes', 'editionFree', 'editionOf'].forEach((id) => { $(id).value = ''; });
  $('hidden').checked = false;
  $('medium').value = 'Acrylic on canvas';
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
  $('medium').value = w.medium || 'Acrylic on canvas';
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
