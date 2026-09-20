/* Two kinds of alive.
 *
 * The register can say what somebody holds and what it is worth, and nothing
 * at all about whether they are still there. Two different questions hide
 * inside that, and they want different answers from different places:
 *
 *   on chain     when did this wallet last transact, anything, anywhere.
 *                Etherscan, one lookup per address, and the only signal that
 *                can tell a dormant wallet from a lost one.
 *
 *   in the room  did they weigh a nudge, say something, leave a note or a
 *                mark in Studio lately. Our own stores, no chain at all.
 *
 * They share a row on the register and they are kept in separate files,
 * because they are separate claims and one of them costs money to ask.
 *
 * ---------------------------------------------------------------- the chain
 *
 * Three and a half thousand addresses at five calls a second is twelve
 * minutes, and this function has five. So the sweep is tiered rather than
 * whole: everybody with a page is refreshed every night, because those are the
 * wallets anybody actually opens, and the rest rotate through on a cursor.
 * The column shows a month. A tail three days behind cannot be seen in it.
 *
 * txlist and not tokentx, deliberately. txlist is what a wallet *sent*, and
 * being sent something is not evidence that anybody is home ... an airdrop
 * lands on the dead as easily as on the living. The question is whether this
 * wallet still acts, so the answer is built from its own actions.
 */
import { readFile, writeFile } from '../_lib/repo.js';
import { loadRuns, saveRuns, hoursSince } from '../_lib/runs.js';
import { storeConfigured, pipe } from '../_lib/kv.js';
import { keys as chatKeys } from '../_lib/chat.js';
import { keys as noteKeys } from '../_lib/notes.js';
import { send } from '../_lib/email.js';

const ETHERSCAN = 'https://api.etherscan.io/v2/api';
const CHAIN = 'data/last-active.json';
const STUDIO = 'data/studio-active.json';
const RUNS = 'data/active-runs.json';

// how long somebody stays lit in the room after their last act
const WINDOW_DAYS = Number(process.env.STUDIO_WINDOW_DAYS || 30);
// leave the budget before the writes, which are what make a run provable
const SWEEP_BY = Number(process.env.ACTIVE_SWEEP_MS || 235000);
// pacing between Etherscan calls; five a second is the free tier's ceiling
const PACE_MS = Number(process.env.ACTIVE_PACE_MS || 205);
// a daily schedule with a run missing
const MAX_GAP_HOURS = Number(process.env.ACTIVE_MAX_GAP_HOURS || 36);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (a) => String(a || '').toLowerCase();

async function es(params, key) {
  const url = `${ETHERSCAN}?${new URLSearchParams({ chainid: '1', apikey: key, ...params })}`;
  for (let i = 0; i < 4; i++) {
    try {
      const j = await (await fetch(url)).json();
      if (j.status === '1') return j.result;
      if (j.message === 'No records found' || /no records/i.test(String(j.result))) return [];
      if (/rate limit|max calls/i.test(String(j.result))) { await sleep(1300); continue; }
      return [];
    } catch (e) { await sleep(600 * (i + 1)); }
  }
  return null;                                   // asked and never answered
}

/** The newest transaction this wallet sent, as a unix second, or null. */
async function latestTx(address, key) {
  const r = await es({ module: 'account', action: 'txlist', address,
    startblock: '0', endblock: '99999999', page: '1', offset: '1', sort: 'desc' }, key);
  if (r === null) return undefined;              // undefined: unknown, keep what we had
  if (!Array.isArray(r) || !r.length) return null;
  const t = Number(r[0].timeStamp);
  return Number.isFinite(t) ? t : null;
}

const monthOf = (unix) => {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/* ------------------------------------------------------------- the room */

/* What somebody last did in Studio, and when.
 *
 * Recomputed from the sources every night rather than stamped at the time of
 * the act. A counter written on every write is one more thing that can be
 * missed, and a miss in that design is permanent; this one is wrong for at
 * most a night and then right again on its own.
 *
 * Every walk is bounded by the window: the log is read newest first and
 * stopped at the first thing older than the window, so the cost is the size of
 * the last thirty days rather than the size of the archive.
 */
async function studioActivity(weighings, since, addresses) {
  const seen = new Map();                        // address -> { at, what }
  const mark = (address, at, what) => {
    const a = lower(address);
    if (!a.startsWith('0x') || !at || at < since) return;
    const had = seen.get(a);
    if (!had || at > had.at) seen.set(a, { at, what });
  };

  for (const w of (weighings && weighings.weighings) || []) {
    mark(w.address, Date.parse(w.at || ''), 'weighed');
  }
  if (!storeConfigured()) return { seen, reached: false };

  /* Chat, newest first, stopping at the window. The log is a list of message
     numbers and the messages are numbered in order, so walking back from the
     end is walking back through time. */
  try {
    const [total] = await pipe([['LLEN', chatKeys.log]]);
    const n = Number(total) || 0;
    for (let end = n; end > 0;) {
      const start = Math.max(0, end - 200);
      const [ids] = await pipe([['LRANGE', chatKeys.log, String(start), String(end - 1)]]);
      if (!ids || !ids.length) break;
      const rows = await pipe(ids.map((i) => ['GET', chatKeys.msg(i)]));
      let allOld = true;
      for (const raw of rows) {
        let m = null;
        try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { continue; }
        if (!m) continue;
        const at = Date.parse(m.at || '');
        if (at >= since) { allOld = false; if (!m.deleted) mark(m.address, at, 'said something'); }
      }
      /* The marks under those messages carry their own timestamps, so a
         reaction left today on a message from March is today's act. */
      const marks = await pipe(ids.map((i) => ['HGETALL', chatKeys.marks(i)]));
      for (const h of marks) {
        const flat = Array.isArray(h) ? h : Object.entries(h || {}).flat();
        for (let i = 0; i + 1 < flat.length; i += 2) {
          const who = String(flat[i]).split(':')[0];
          const at = Number(flat[i + 1]);
          if (at >= since) { allOld = false; mark(who, at, 'reacted'); }
        }
      }
      if (allOld && start === 0) break;
      if (allOld && end < n - 600) break;        // well past the window, stop walking
      end = start;
    }
  } catch (e) { /* the room is not the whole signal */ }

  /* Notes, per wallet rather than from the public stream.
   *
   * `notes:all` carries only what is public and unhidden, so a collector who
   * writes privately would never light up ... and a private note is somebody
   * being in the room exactly as much as a public one is. The per-wallet set
   * holds all of theirs, and a note's id opens with the millisecond it was
   * written in base thirty-six, so the newest id alone dates it. No bodies are
   * read: three and a half thousand ranges cost eight round trips and nothing
   * private is ever fetched to decide whether a dot is lit. */
  try {
    const list = addresses || [];
    for (let i = 0; i < list.length; i += 500) {
      const batch = list.slice(i, i + 500);
      const rows = await pipe(batch.map((a) => ['ZRANGE', noteKeys.wallet(a), '0', '0', 'REV']));
      rows.forEach((ids, j) => {
        const id = Array.isArray(ids) ? ids[0] : ids;
        if (!id) return;
        const at = parseInt(String(id).slice(0, 9), 36);
        if (Number.isFinite(at)) mark(batch[j], at, 'left a note');
      });
    }
  } catch (e) { /* ditto */ }

  return { seen, reached: true };
}

/* ------------------------------------------------------------------ run */

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return new Response('ETHERSCAN_API_KEY is not set', { status: 503 });

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const started = Date.now();

  let prior = { runs: [], sha: undefined };
  try { prior = await loadRuns(RUNS); } catch (e) { /* the run itself will say */ }

  try {
    const out = await run({ key, dry, started, prior, url });
    return new Response(JSON.stringify(out, null, 1), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    const why = String(err && err.message ? err.message : err).slice(0, 300);
    const entry = { run_id: `a${started.toString(36)}`, at: new Date(started).toISOString(), ok: false, ms: Date.now() - started, error: why };
    if (!dry) {
      await saveRuns(RUNS, prior, entry, { keep: 60, note: NOTE, message: `Active run failed: ${why.slice(0, 60)}` }).catch(() => {});
      const to = process.env.EMAIL_TO_OPS || process.env.EMAIL_TO_ARTIST;
      if (to) {
        await send({ to, subject: 'Activity: the nightly pass failed',
          text: `The activity pass stopped with:\n\n  ${why}\n\nLast active and the Studio dots are yesterday's. Nothing was lost; the cursor did not move, so the next run covers the same ground.\n\nMintFace`,
        }).catch(() => {});
      }
    }
    console.error('active: run failed', why);
    return new Response(JSON.stringify({ ok: false, error: why }, null, 1), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

const NOTE = 'One record per activity pass, newest first, sixty kept. Two signals: the chain (Etherscan, tiered and rotating) and the room (our own stores, recomputed whole). See docs/ACTIVITY.md.';

async function run({ key, dry, started, prior, url }) {
  const runId = `a${started.toString(36)}`;
  const site = process.env.SITE_ORIGIN || 'https://mintface.art';

  const register = JSON.parse((await readFile('data/collectors-register.json')).text);
  const F = register.fields;
  const iA = F.indexOf('address'), iS = F.indexOf('slug'), iP = F.indexOf('private');
  const everyone = register.rows.map((r) => ({ address: lower(r[iA]), paged: Boolean(r[iS]), private: Boolean(r[iP]) }));

  /* ---- the room, first: it is cheap, and it is the half that must not be
     skipped if the chain half runs out of clock. ---- */
  let weighings = null;
  try { weighings = JSON.parse((await readFile('data/nudge-weighings.json')).text); } catch (e) { /* none yet */ }
  const since = started - WINDOW_DAYS * 86400000;
  const { seen: studio, reached } = await studioActivity(weighings, since, everyone.map((p) => p.address));

  const studioFile = {
    _note: `Collectors active in the MintFace Studio inside the last ${WINDOW_DAYS} days, and what they last did. Recomputed whole every night from the nudge ledger, the room and the notes ... no chain lookup is involved and none is needed. A wallet drops off this list by going quiet, not by being removed. See docs/ACTIVITY.md.`,
    generated: new Date(started).toISOString(),
    window_days: WINDOW_DAYS,
    wallets: Object.fromEntries([...studio.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .map(([a, v]) => [a, [Math.round(v.at / 1000), v.what]])),
  };

  /* ---- the chain ---- */
  let chain = { wallets: {}, cursor: 0 };
  try { chain = JSON.parse((await readFile(CHAIN)).text); } catch (e) { /* first run */ }
  const wallets = { ...(chain.wallets || {}) };
  const tail = everyone.filter((p) => !p.paged).map((p) => p.address);
  const paged = everyone.filter((p) => p.paged).map((p) => p.address);

  let cursor = Number(chain.cursor) || 0;
  if (cursor >= tail.length) cursor = 0;

  /* Everyone with a page, then as much of the tail as the clock allows,
     resuming where the last run stopped. */
  const queue = [...paged];
  const rotated = [];
  for (let i = 0; i < tail.length; i++) rotated.push(tail[(cursor + i) % tail.length]);
  queue.push(...rotated);

  let asked = 0, moved = 0, unknown = 0, reachedIn = 0;
  for (const a of queue) {
    if (Date.now() - started > SWEEP_BY) break;
    const t = await latestTx(a, key);
    asked++;
    reachedIn = queue.indexOf(a);
    if (t === undefined) { unknown++; }
    else {
      const had = wallets[a] && wallets[a][0];
      if (had !== t) moved++;
      wallets[a] = t ? [t, monthOf(t)] : [0, null];
    }
    await sleep(PACE_MS);
  }
  /* How far into the tail this run got, so the next one starts there. Only the
     rotated part moves the cursor; the paged tier is swept whole every night
     and has no position to keep. */
  const intoTail = Math.max(0, asked - paged.length);
  const nextCursor = tail.length ? (cursor + intoTail) % tail.length : 0;

  const chainFile = {
    _note: 'The most recent transaction each wallet has sent, as a unix second and the month it falls in. Etherscan txlist, one lookup per address: everybody with a page every night, the rest rotating on the cursor below. Sent rather than received on purpose ... an airdrop lands on the dead as easily as on the living, so aliveness is built from a wallet\'s own acts. See docs/ACTIVITY.md.',
    generated: new Date(started).toISOString(),
    cursor: nextCursor,
    tail: tail.length,
    wallets,
  };

  const entry = {
    run_id: runId,
    at: new Date(started).toISOString(),
    ok: true,
    ms: Date.now() - started,
    chain: { asked, moved, unknown, paged: paged.length, tail: tail.length, cursor: nextCursor,
      covered: Object.keys(wallets).length },
    studio: { lit: Object.keys(studioFile.wallets).length, window_days: WINDOW_DAYS, store: reached },
  };

  const flagged = [];
  const gapHours = hoursSince(prior.runs, started);
  if (gapHours != null && Number.isFinite(gapHours) && gapHours > MAX_GAP_HOURS) {
    flagged.push({ id: 'gap', slug: 'activity',
      why: `the previous pass finished ${Math.round(gapHours)} hours ago on a daily schedule ... at least one run did not happen`,
      action: 'the cursor did not move, so nothing is lost ... what is worth knowing is what killed the run that is missing' });
  }
  if (!reached) {
    flagged.push({ id: 'store', slug: 'studio',
      why: 'the store did not answer, so the dots are built from the nudge ledger alone',
      action: 'chat, notes and marks are missing from tonight\'s dots' });
  }
  if (flagged.length) entry.flagged = flagged;

  if (!dry) {
    const put = async (path, body, msg) => {
      const cur = await readFile(path).catch(() => ({ sha: null }));
      await writeFile(path, JSON.stringify(body, null, 1) + '\n', msg, cur.sha || undefined);
    };
    await put(STUDIO, studioFile, `Studio: ${entry.studio.lit} active in the last ${WINDOW_DAYS} days`);
    await put(CHAIN, chainFile, `Last active: ${asked} asked, ${moved} moved`);
    await saveRuns(RUNS, prior, entry, { keep: 60, note: NOTE, message: `Activity: ${asked} asked, ${entry.studio.lit} in the room` });
  }

  return {
    summary: `active: ${asked} wallets asked (${paged.length} paged, ${intoTail} of ${tail.length} tail), `
      + `${moved} moved, ${entry.studio.lit} lit in the room, ${Math.round((Date.now() - started) / 1000)}s`,
    dry,
    ...entry,
  };
}
