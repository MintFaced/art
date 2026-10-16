/* Who bought or held a work: kept in the store, never in data/state.json.
 *
 * state.json is committed to a public repository and served from the site, so
 * anything written there is published. A collector's or a reserver's email
 * and name are the studio's to know, and live here instead. The sale record
 * in state.json keeps everything else (the work, the amount, the session).
 *
 * Best effort on write: a sale must not fail because the store blinked, and
 * the sale emails carry the same details to the studio either way.
 */
import { one, storeConfigured } from './kv.js';

const K = (kind, workId) => `contact:${kind}:${workId}`;

export async function keepContact(kind, workId, data) {
  if (!storeConfigured()) return false;
  try {
    await one('SET', K(kind, workId), JSON.stringify({ ...data, at: new Date().toISOString() }));
    return true;
  } catch (e) {
    console.error('contact not kept', kind, workId, e.message);
    return false;
  }
}

export async function readContact(kind, workId) {
  if (!storeConfigured()) return null;
  try {
    const raw = await one('GET', K(kind, workId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
