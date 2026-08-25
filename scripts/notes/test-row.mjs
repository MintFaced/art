#!/usr/bin/env node
/* The Details row, and who is offered a pen.
 *
 * The bug this guards against is the one that shipped: a work with no notes and
 * a wallet that may write on it rendered nothing at all, so the person entitled
 * to write the first note on the site could not see anywhere to do it. The rule
 * has two halves and they pull against each other ... the row is silent when
 * there is nothing to show, and it must appear for anyone who may write. Miss
 * the second and the feature is invisible; miss the first and every work page
 * grows an empty box explaining a thing you cannot do.
 *
 * The script under test is the one in w.html, run as the browser runs it.
 *
 *   node scripts/notes/test-row.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'w.html'), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/* ---------- just enough DOM for the row ---------- */
const cell = () => ({ innerHTML: '' });
const el = (id) => ({
  id, hidden: true, innerHTML: '',
  _th: cell(), _td: cell(),
  querySelector(sel) { return sel === 'th' ? this._th : sel === 'td' ? this._td : null; },
  classList: { toggle() {} },
  matches: () => false,
});
const ntRow = el('ntRow');
const provNotes = el('provNotes');
const nodes = { ntRow, provNotes };
const doc = {
  addEventListener() {},
  getElementById: (id) => nodes[id] || null,
  querySelector: () => null,
  activeElement: null,
  body: { contains: () => true },
};
const win = { addEventListener() {}, confirm: () => true };
const MF = {
  escape: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  STATUS: {}, year: () => null, links: () => [], date: (d) => String(d),
  animationUrl: () => null, zoomable: () => false, thumbUrl: () => null,
  progress: { watch() {} },
  async knownAccount() { return null; },
  async sign() { return '0x'; },
};

const scope = new Function(
  'window', 'document', 'fetch', 'location', 'setTimeout', 'clearTimeout', 'console', 'MF',
  'URLSearchParams', 'Request', 'navigator', 'history',
  `${inline[0]}\n; return { NOTES, drawNotes, byline, noteBlock, detailRows };`,
)(win, doc, async () => ({ ok: false }), { href: 'https://mintface.art/w/x', search: '' },
  setTimeout, clearTimeout, console, MF, URLSearchParams, Request, { userAgent: '' }, { replaceState() {} });

const { NOTES, drawNotes, detailRows } = scope;

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const note = (over = {}) => ({
  id: over.id || 'n1', work: 'w1', text: over.text || 'A note about the work.',
  at: '2026-08-20T00:00:00.000Z', kind: over.kind || 'collector', label: 'Collector\'s note',
  byline: over.byline || 'adacrow.eth', address: over.address || '0xaaa',
  visibility: over.visibility || 'public', mine: Boolean(over.mine),
  can_edit: Boolean(over.mine), can_hide: Boolean(over.can_hide),
  edited: false, ...over,
});
const show = (data, wallet = null) => {
  NOTES.data = data;
  NOTES.wallet = wallet;
  NOTES.writing = null;
  NOTES.open = false;
  NOTES.say = null;
  ntRow.hidden = true;
  ntRow._th.innerHTML = ''; ntRow._td.innerHTML = '';
  provNotes.hidden = true; provNotes.innerHTML = '';
  drawNotes();
  return { hidden: ntRow.hidden, th: ntRow._th.innerHTML, td: ntRow._td.innerHTML };
};
const base = { store: true, fold_after: 3, max_chars: 500, notes: [], provenance: [], me: null };

/* ================= the row is in the table ================= */
head('The row is a row');
{
  const table = detailRows(
    { status: 'available', digital: {}, physical: {} },
    { slug: 'c', physical: false },
  );
  ok(table.includes('<table class="rows">') && table.trim().endsWith('</table>'),
    'the Details table is still a table');
  ok(/<tr class="nt-row" id="ntRow" hidden>[\s\S]*<\/table>$/.test(table.trim()),
    'and the notes row is the last thing in it, hidden until it has something to say');
}

/* ================= absence is silent ================= */
head('Absence is silent');
{
  const r = show({ ...base });
  ok(r.hidden === true && r.td === '', 'nothing written and nobody signed in: the row never appears',
    `hidden ${r.hidden}, ${r.td.length} chars`);

  const r2 = show({ ...base, me: { can_write: false, why: 'A note here is for the artist ...' } }, '0xbbb');
  ok(r2.hidden === true, 'a connected wallet with no right to write is told nothing at all');
  ok(!r2.td.includes('69,000') && r2.td === '', 'and the row does not explain the thing it cannot do');

  const r3 = show({ ...base, store: false });
  ok(r3.hidden === true, 'and with no store behind it the page is the page it always was');
}

/* ================= the affordance, which is the bug ================= */
head('Anyone who may write is offered a pen');
{
  const me = { can_write: true, role: 'artist', tao: 0, can_be_private: false };
  const r = show({ ...base, me }, '0xd40b');
  ok(r.hidden === false, 'a work with no notes and a wallet that may write shows the row', `hidden ${r.hidden}`);
  ok(/data-act="write"/.test(r.th) && /Add a note/.test(r.th),
    'with Add a note beside the label', r.th.replace(/<[^>]+>/g, ' ').trim());
  ok(r.td.includes('nt-say'), 'and somewhere to be told what happened');
  ok(!/<p>/.test(r.td), 'and no note in it, because there are none');

  const mine = note({ id: 'mine', mine: true, address: '0xd40b', kind: 'artist', byline: 'MintFace' });
  const r2 = show({ ...base, me, notes: [mine] }, '0xd40b');
  ok(/data-act="edit"/.test(r2.th) && /Edit/.test(r2.th) && !/Add a note/.test(r2.th),
    'a wallet that has already written sees Edit, not Add',
    r2.th.replace(/<[^>]+>/g, ' ').trim());
}

/* ================= what it shows ================= */
head('The newest note, and a way to the rest');
{
  const four = [
    note({ id: 'a', text: 'Newest.', at: '2026-08-24T00:00:00.000Z' }),
    note({ id: 'b', text: 'Second.', at: '2026-08-23T00:00:00.000Z' }),
    note({ id: 'c', text: 'Third.', at: '2026-08-22T00:00:00.000Z' }),
    note({ id: 'd', text: 'Fourth.', at: '2026-08-21T00:00:00.000Z' }),
  ];
  const r = show({ ...base, notes: four });
  ok(r.hidden === false, 'a public note shows the row to anyone, wallet or no wallet');
  ok(r.td.includes('Newest.') && !r.td.includes('Second.'), 'the latest note is the value');
  ok(/data-act="open"[^>]*>All notes &middot; 4/.test(r.td),
    'with a quiet way to the others', (r.td.match(/All notes[^<]*/) || [])[0]);
  ok(r.th.replace(/<[^>]+>/g, '').trim() === 'Notes', 'and the label is just Notes', r.th);

  NOTES.open = true;
  drawNotes();
  const open = ntRow._td.innerHTML;
  ok(['Newest.', 'Second.', 'Third.', 'Fourth.'].every((t) => open.includes(t)),
    'unfolding shows all of them, in the same row');
  ok(open.indexOf('Newest.') < open.indexOf('Fourth.'), 'newest first');
  ok(/data-act="close"/.test(open), 'and a way to fold it back');

  const one = show({ ...base, notes: [four[0]] });
  ok(!/All notes/.test(one.td), 'one note needs no link to the rest');
}

/* ================= who wrote it ================= */
head('Author and date, in the small mono');
{
  const r = show({ ...base, notes: [note({ kind: 'artist', byline: 'MintFace' })] });
  ok(/nt-by/.test(r.td) && /Artist/.test(r.td), 'the artist reads as Artist', (r.td.match(/nt-by">([^<]*)/) || [])[1]);

  const r2 = show({ ...base, notes: [note({ byline: 'adacrow.eth' })] });
  ok(/adacrow\.eth &middot; Collector &middot; 20 Aug 2026/.test(r2.td),
    'a holder reads as name, Collector, date', (r2.td.match(/nt-by">([^<]*)/) || [])[1]);

  const r3 = show({ ...base, notes: [note({ byline: 'visco.eth', tao: 1493717 })] });
  ok(/Collector &middot; 1\.49M TAO/.test(r3.td),
    'and a collector writing from outside the work carries the figure that lets them',
    (r3.td.match(/nt-by">([^<]*)/) || [])[1]);

  const r4 = show({ ...base, me: { can_write: true }, notes: [note({ mine: true, visibility: 'private' })] }, '0xaaa');
  ok(/Private to you/.test(r4.td), 'a private note says so, to the one person who can see it');
}

/* ================= writing in place ================= */
head('The table is the editor');
{
  const me = { can_write: true, role: 'collector', can_be_private: true };
  NOTES.data = { ...base, me };
  NOTES.wallet = '0xaaa';
  NOTES.writing = { id: null, text: '', visibility: 'public' };
  drawNotes();
  ok(ntRow._td.innerHTML.includes('<textarea'), 'the value becomes an input, in the row');
  ok(/id="ntPriv"/.test(ntRow._td.innerHTML), 'with the private toggle, for a note on your own work');
  ok(/maxlength="540"/.test(ntRow._td.innerHTML) && /0\/500/.test(ntRow._td.innerHTML),
    'and the count against the limit');
  ok(/data-act="cancel"/.test(ntRow._th.innerHTML), 'and a way out beside the label');

  NOTES.data = { ...base, me: { can_write: true, role: 'senior', can_be_private: false } };
  drawNotes();
  ok(!/id="ntPriv"/.test(ntRow._td.innerHTML),
    'a collector writing on somebody else\'s work gets no private toggle');
}

/* ================= provenance goes to provenance ================= */
head('Former collectors keep their tenure, in the fold');
{
  const gone = note({ id: 'p1', kind: 'provenance', byline: 'dsanches-vault.eth', tenure: 'collector 2022–2024' });
  const r = show({ ...base, provenance: [gone] });
  ok(r.hidden === true, 'a work whose only notes are provenance shows no Details row');
  ok(provNotes.hidden === false && provNotes.innerHTML.includes('dsanches-vault.eth'),
    'they are in the provenance fold instead');
  ok(/collector 2022–2024/.test(provNotes.innerHTML), 'dated with the tenure they were written in');
  ok(!ntRow._td.innerHTML.includes('dsanches-vault.eth'), 'and not in the row');

  const both = show({ ...base, notes: [note({ text: 'Living note.' })], provenance: [gone] });
  ok(both.td.includes('Living note.') && !both.td.includes('dsanches-vault.eth'),
    'where a work has both, the row shows the living ones only');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
