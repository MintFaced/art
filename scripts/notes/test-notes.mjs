#!/usr/bin/env node
/* The acceptance cases from docs/ARTWORK-NOTES.md, item 13.
 *
 * The rules and the store code are the real ones out of api/_lib/notes.js. Only
 * Redis is a stand-in ... a few dozen lines implementing the handful of commands
 * the store actually sends, so the pipelines under test are the pipelines that
 * will run. A test that mocks the thing it is testing proves nothing.
 *
 *   node scripts/notes/test-notes.mjs
 */
import {
  notesStore, standing, checkText, checkVisibility, arrange,
  holdersOf, heldSince, noteId, noteMessage,
} from '../../api/_lib/notes.js';

/* ---------- a small Redis, for the commands this store sends ---------- */
function fakeRedis() {
  const str = new Map();
  const z = new Map();                                   // key -> Map(member -> score)
  const zset = (k) => { if (!z.has(k)) z.set(k, new Map()); return z.get(k); };
  const sorted = (k) => [...zset(k).entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case 'SET': str.set(a[0], a[1]); return 'OK';
      case 'GET': return str.has(a[0]) ? str.get(a[0]) : null;
      case 'MGET': return a.map((k) => (str.has(k) ? str.get(k) : null));
      case 'DEL': { const had = str.delete(a[0]); return had ? 1 : 0; }
      case 'INCR': { const v = (Number(str.get(a[0])) || 0) + 1; str.set(a[0], String(v)); return v; }
      case 'EXPIRE': return 1;
      case 'ZADD': zset(a[0]).set(a[2], Number(a[1])); return 1;
      case 'ZREM': return zset(a[0]).delete(a[1]) ? 1 : 0;
      case 'ZCARD': return zset(a[0]).size;
      case 'ZRANGE': {
        const rows = sorted(a[0]).map(([m]) => m);
        const rev = a.includes('REV');
        const list = rev ? rows.slice().reverse() : rows;
        let [start, stop] = [Number(a[1]), Number(a[2])];
        if (start < 0) start = list.length + start;
        if (stop < 0) stop = list.length + stop;
        return list.slice(start, stop + 1);
      }
      case 'ZREMRANGEBYRANK': {
        const rows = sorted(a[0]).map(([m]) => m);
        let [start, stop] = [Number(a[1]), Number(a[2])];
        if (start < 0) start = rows.length + start;
        if (stop < 0) stop = rows.length + stop;
        const gone = rows.slice(Math.max(0, start), stop + 1);
        for (const m of gone) zset(a[0]).delete(m);
        return gone.length;
      }
      default: throw new Error(`the fake store has no ${cmd}`);
    }
  };
  return async (cmds) => cmds.map(run);
}

/* ---------- the cast ---------- */
const ARTIST = '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180';
const OWNER = '0x1111111111111111111111111111111111111111';
const BUYER = '0x2222222222222222222222222222222222222222';
const SENIOR = '0x3333333333333333333333333333333333333333';
const SMALL = '0x4444444444444444444444444444444444444444';

const cfg = {
  artist: { [ARTIST]: 'mintface.eth' },
  senior_tao: 69000, max_chars: 500, per_wallet_per_day: 20, fold_after: 3, index_keep: 200,
};

// the work, held by OWNER since 2022, as data/c/*.json records it
const work = {
  id: 'geodetic-moments-1', title: 'Geodetic Moment #1',
  digital: { chain: 'ethereum', standard: 'ERC-721', contract: '0xabc', token_id: '1' },
  collector: { address: OWNER, ens: 'dsanches-vault.eth', acquired: '2022-03-04T00:00:00.000Z' },
};
// the same work after it sells to BUYER in 2024
const afterSale = {
  ...work,
  collector: { address: BUYER, ens: 'newholder.eth', acquired: '2024-11-02T00:00:00.000Z' },
};

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const pipe = fakeRedis();
const db = notesStore(pipe, cfg);
let clock = Date.parse('2023-06-01T00:00:00.000Z');
const tick = () => { clock += 60000; return new Date(clock).toISOString(); };

/** Everything api/notes.js does for a write, minus the signature and the RPC. */
async function write({ from, tao, text, visibility, on = work, holders }) {
  const set = holders || holdersOf(on);
  const t = checkText(text, cfg);
  if (t.error) return { error: t.error };
  const who = standing({ address: from, cfg, tao, holders: set });
  if (who.error) return { error: who.error };
  const v = checkVisibility({ role: who.role, visibility });
  if (v.error) return { error: v.error };
  const spent = await db.spentToday(from, '2023-06-01');
  if (spent >= cfg.per_wallet_per_day) return { error: 'too many today' };
  const at = tick();
  const note = {
    id: noteId(clock, () => 0.5), work: on.id, collection: 'geodetic-moments',
    address: from, name: who.name || null, role: who.role,
    tao_at_post: who.role === 'senior' ? who.tao : (tao || 0),
    held_since: who.role === 'collector' ? (heldSince(on, from) || at) : null,
    text: t.text, visibility: v.visibility, hidden: false, at, edited_at: null,
  };
  await db.put(note, { count: true, day: '2023-06-01' });
  return { note };
}
const view = async (on, viewer) => arrange(await db.byWork(on.id), {
  holders: holdersOf(on), viewer, isArtist: Boolean(viewer && cfg.artist[viewer]),
  currentAcquired: on.collector.acquired,
});

/* ================= who may write ================= */
head('Who may write');
{
  const a = await write({ from: ARTIST, tao: 0, text: 'Painted on the ferry, badly, and kept.' });
  ok(!a.error && a.note.role === 'artist', 'the artist writes on any work', a.error || `role ${a.note.role}`);

  const c = await write({ from: OWNER, tao: 12000, text: 'It hangs where the afternoon gets in.' });
  ok(!c.error && c.note.role === 'collector', 'the wallet holding it writes on it', c.error);

  const p = await write({ from: OWNER, tao: 12000, text: 'I paid too much and would again.', visibility: 'private' });
  ok(!p.error && p.note.visibility === 'private', 'and may keep a note private', p.error);

  const s = await write({ from: SENIOR, tao: 210000, text: 'The first of these I ever understood.' });
  ok(!s.error && s.note.role === 'senior' && s.note.tao_at_post === 210000,
    'a collector above 69,000 TAO writes on someone else\'s work', s.error);

  const n = await write({ from: SMALL, tao: 4200, text: 'Nice one.' });
  ok(Boolean(n.error) && /69,000/.test(n.error), 'a wallet below the line is refused, and told the line',
    n.error || 'it was allowed');

  const sp = await write({ from: SENIOR, tao: 210000, text: 'Between us.', visibility: 'private' });
  ok(Boolean(sp.error), 'only the holder may write privately, not a senior collector', sp.error || 'it was allowed');

  const ap = await write({ from: ARTIST, tao: 0, text: 'Between us.', visibility: 'private' });
  ok(Boolean(ap.error), 'nor the artist', ap.error || 'it was allowed');
}

/* ================= the note itself ================= */
head('The note itself');
{
  ok(checkText('   ', cfg).error === 'a note needs some words', 'an empty note is refused');
  const long = checkText('x'.repeat(501), cfg);
  ok(Boolean(long.error) && /500/.test(long.error), 'five hundred characters is the limit', long.error);
  ok(!checkText('x'.repeat(500), cfg).error, 'and five hundred exactly is allowed');
  const kept = checkText('one\n\ntwo', cfg);
  ok(kept.text === 'one\n\ntwo', 'line breaks are kept');
  ok(Boolean(checkText('ab', cfg).error), 'control characters are refused');
  const link = checkText('see https://mintface.art/w/x', cfg);
  ok(link.text.includes('https://mintface.art'), 'a pasted link survives as text', link.text);
  ok(noteMessage({ action: 'write', work: 'w', text: 't', visibility: 'public', address: OWNER, issued: 'i' })
    .includes('Signing writes this note. It moves nothing and spends nothing.'),
    'the sentence signed says what it does');
}

/* ================= what the page shows ================= */
head('What the work page shows, while the owner still holds it');
{
  const anon = await view(work, null);
  const owner = await view(work, OWNER);
  const artist = await view(work, ARTIST);

  ok(anon.notes.length === 3 && anon.provenance.length === 0,
    'a stranger sees three notes and no private one', `${anon.notes.length} notes`);
  ok(!anon.notes.some((x) => x.visibility === 'private'), 'the private note is not among them');
  ok(owner.notes.length === 4 && owner.notes.some((x) => x.visibility === 'private'),
    'its author sees their own private note', `${owner.notes.length} notes`);
  ok(!artist.notes.some((x) => x.visibility === 'private'),
    'the artist cannot read a private note either');

  ok(anon.notes[0].kind === 'artist' && anon.notes[0].label === "Artist's note",
    'the artist\'s note comes first, labelled');
  ok(anon.notes[1].kind === 'collector' && anon.notes[1].address === OWNER,
    'then the holder\'s', `${anon.notes[1].label} by ${anon.notes[1].byline}`);
  ok(/^0x1111…1111$/.test(anon.notes[1].byline),
    'an unnamed wallet is shortened rather than shown whole', anon.notes[1].byline);
  const senior = anon.notes.find((x) => x.tao);
  ok(senior && senior.tao === 210000, 'a senior collector\'s note carries their TAO at posting');
  ok(artist.notes.every((x) => x.can_hide), 'the artist can hide any of them');
  ok(anon.notes.every((x) => !x.can_hide && !x.can_edit), 'a stranger can do neither');
}

/* ================= editing, deleting, hiding ================= */
head('Editing, deleting, hiding');
{
  const mine = (await db.byWork(work.id)).find((x) => x.address === OWNER && x.visibility === 'public');
  mine.text = 'It hangs where the afternoon gets in, and the cat sits under it.';
  mine.edited_at = tick();
  await db.save(mine);
  const seen = (await view(work, null)).notes.find((x) => x.id === mine.id);
  ok(seen.edited === true && /cat/.test(seen.text), 'an edit shows quietly as edited');

  const s = (await db.byWork(work.id)).find((x) => x.role === 'senior');
  s.hidden = true;
  await db.save(s);
  const after = await view(work, null);
  ok(!after.notes.some((x) => x.id === s.id), 'a hidden note is gone from the page');
  const asArtist = await view(work, ARTIST);
  const seenHidden = asArtist.notes.find((x) => x.id === s.id);
  ok(Boolean(seenHidden) && seenHidden.hidden === true,
    'the artist still sees it, marked, so it can be put back');
  ok(!(await view(work, OWNER)).notes.some((x) => x.id === s.id),
    'and nobody else does, its author included');
  ok(Boolean(await db.get(s.id)), 'and still in the data');
  ok(!(await db.recent(50)).some((x) => x.id === s.id && !x.hidden),
    'and out of the public stream');
  s.hidden = false;
  await db.save(s);

  const doomed = await write({ from: SENIOR, tao: 210000, text: 'On reflection, no.' });
  await db.remove(doomed.note);
  ok(!(await db.get(doomed.note.id)), 'a deleted note is gone from the data');
  ok(!(await view(work, null)).notes.some((x) => x.id === doomed.note.id), 'and from the page');
}

/* ================= the sale ================= */
head('The work sells, in 2024');
{
  const before = await view(work, OWNER);
  const publicBefore = before.notes.filter((x) => x.address === OWNER && x.visibility === 'public').length;
  const privateBefore = before.notes.filter((x) => x.address === OWNER && x.visibility === 'private').length;

  const seenByAnyone = await view(afterSale, null);
  const seenByFormer = await view(afterSale, OWNER);
  const seenByArtist = await view(afterSale, ARTIST);

  ok(publicBefore === 1 && privateBefore === 1, 'the seller had one public note and one private',
    `${publicBefore} public, ${privateBefore} private`);

  const prov = seenByAnyone.provenance;
  ok(prov.length === 1 && prov[0].address === OWNER,
    'their public note has become provenance', `${prov.length} in the fold`);
  ok(prov[0].label === 'Provenance note' && prov[0].tenure === 'collector 2022–2024',
    'attributed and dated with the tenure it was written in', prov[0] && prov[0].tenure);
  ok(!seenByAnyone.notes.some((x) => x.address === OWNER), 'and out of the live notes');

  ok(!seenByFormer.notes.concat(seenByFormer.provenance).some((x) => x.visibility === 'private'),
    'the private note renders to nobody, its author included');
  ok(!seenByArtist.notes.concat(seenByArtist.provenance).some((x) => x.visibility === 'private'),
    'nor to the artist');
  const stillStored = (await db.byWork(work.id)).some((x) => x.visibility === 'private');
  ok(stillStored, 'though it is still in the data, unrendered');

  ok(seenByAnyone.notes.some((x) => x.kind === 'artist'), 'the artist\'s note is untouched by the sale');
  const seniorAfter = seenByAnyone.notes.find((x) => x.address === SENIOR);
  ok(Boolean(seniorAfter) && seniorAfter.kind === 'collector' && seniorAfter.tao === 210000,
    'so is the senior collector\'s ... their standing was never this work',
    seniorAfter ? `${seniorAfter.label}, ${seniorAfter.tao} TAO` : 'gone');

  const buyer = await write({ from: BUYER, tao: 100, text: 'It arrived on a Tuesday.', on: afterSale });
  ok(!buyer.error && buyer.note.role === 'collector', 'the new holder may write on it now', buyer.error);
  const old = await write({ from: OWNER, tao: 12000, text: 'One more thing.', on: afterSale });
  ok(Boolean(old.error), 'and the seller may not', old.error || 'it was allowed');
}

/* ================= the rate limit ================= */
head('Twenty a day');
{
  const spender = '0x5555555555555555555555555555555555555555';
  let refused = null;
  for (let i = 0; i < 22 && !refused; i++) {
    const r = await write({ from: spender, tao: 90000, text: `Note number ${i + 1}.` });
    if (r.error) refused = { i, error: r.error };
  }
  ok(refused && refused.i === cfg.per_wallet_per_day,
    'the twenty-first is refused', refused ? `refused at ${refused.i}: ${refused.error}` : 'never refused');
  ok((await db.spentToday(spender, '2023-06-01')) === cfg.per_wallet_per_day,
    'and the count is exactly twenty');
}

/* ================= a collector's own line ================= */
head('The line on a collector page');
{
  const rows = await db.byWallet(OWNER, 200);
  const strangerSees = rows.filter((r) => !r.hidden && r.visibility === 'public').length;
  const theySee = rows.filter((r) => !r.hidden).length;
  ok(strangerSees === 1 && theySee === 2,
    'the count a stranger reads leaves the private note out of it',
    `${strangerSees} public of ${theySee} written`);
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
