/* data/nudges.json, written once and read the same everywhere at once.
 *
 * The repo is the record and the deployment serves it, and the gap between
 * the two is a build: a minute when nothing else is queued, several when the
 * TAO run has just committed ten times. A nudge that opened, or a colour that
 * locked, could sit in the repo for that long while /studio, the collection
 * page and the console all said the old thing ... which is how #5 "took a
 * while to appear".
 *
 * So every write goes to the repo AND to a copy in the store, and the readers
 * take whichever is newer. `rev` is what newer means: a counter bumped on
 * every write, so a copy and a deployment can be compared without trusting
 * either one's clock. A hand edit that forgets to bump it ties, and a tie goes
 * to the deployment. The copy expires after an hour, by which time any build
 * has long landed, so it can never hold the pages on an old state for longer.
 *
 * And a log, because a button that changes the palette should leave a line
 * saying who pressed it and when. It lives in the store, not the file: it is
 * the console's to read, and the file is public.
 */
import { writeFile } from './repo.js';
import { storeConfigured, pipe } from './kv.js';

export const PATH = 'data/nudges.json';
export const K = {
  copy: 'nudges:file',   // the newest nudges.json, for an hour
  log: 'nudges:log',     // what the console and the close job did, newest first
};
const COPY_TTL = 3600;
const LOG_KEEP = 200;

export const revOf = (store) => Math.max(0, Math.floor(Number(store && store.rev) || 0));

/** The JSON as the repo keeps it. */
export const serialise = (store) => JSON.stringify(store, null, 1) + '\n';

/** Whichever copy is newer. Ties go to the deployment. */
export function freshest(deployed, copy) {
  if (!copy || !Array.isArray(copy.nudges)) return deployed;
  if (!deployed || !Array.isArray(deployed.nudges)) return copy;
  return revOf(copy) > revOf(deployed) ? copy : deployed;
}

/** The store's copy, or null. Never throws: the deployment is always there. */
export async function readCopy() {
  if (!storeConfigured()) return null;
  try {
    const [raw] = await pipe([['GET', K.copy]]);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/** Put a state in the store for the readers, without writing the repo. */
export async function mirror(store) {
  if (!storeConfigured()) return false;
  try {
    await pipe([['SET', K.copy, JSON.stringify(store), 'EX', String(COPY_TTL)]]);
    return true;
  } catch (e) {
    console.error('nudges: could not mirror', String(e && e.message ? e.message : e));
    return false;
  }
}

/**
 * Write the file, bump its rev, and mirror it. `sha` is the one the caller
 * read, so two writers racing still fail on the repo the way they always did.
 */
export async function saveNudges(store, message, sha) {
  store.rev = revOf(store) + 1;
  const out = await writeFile(PATH, serialise(store), message, sha);
  await mirror(store);
  return out;
}

/**
 * One line in the log.
 * @param e  { act: 'lock'|'open'|'close'|'hold'|'revalidate'|..., nudge?, number?, by, line }
 *           `by` is 'console' or 'close job'. The console has one password and
 *           no names, so that is as much as "who" can honestly say.
 */
export async function logAct(e) {
  if (!storeConfigured()) return null;
  const row = { at: new Date().toISOString(), ...e };
  try {
    await pipe([['LPUSH', K.log, JSON.stringify(row)], ['LTRIM', K.log, '0', String(LOG_KEEP - 1)]]);
    return row;
  } catch (err) { return null; }
}

/** The newest lines, newest first. */
export async function recentActs(limit = 30) {
  if (!storeConfigured()) return [];
  try {
    const [rows] = await pipe([['LRANGE', K.log, '0', String(Math.max(0, limit - 1))]]);
    return (rows || []).map((r) => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
