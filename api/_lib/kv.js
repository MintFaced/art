/* The store, over Upstash's REST API.
 *
 * Notes are the first thing on this site that is neither catalogue nor sale:
 * they are written by other people, they can be private, and they change after
 * they are written. None of that belongs in the repo ... a private note in a
 * file the deployment serves is a private note in public, and a commit per
 * sentence is a deploy per sentence.
 *
 * REST rather than a client library because a function that already boots in
 * milliseconds should not pull in a driver to send one command over HTTP.
 * Both the Vercel marketplace names and Upstash's own are accepted, since the
 * integration sets one pair and a hand-made database sets the other.
 */
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;

export const storeConfigured = () => Boolean(URL_() && TOKEN());

/** A pipeline of commands, in order. Throws if the store says no. */
export async function pipe(commands) {
  const url = URL_(), token = TOKEN();
  if (!url || !token) throw new Error('the notes store is not configured');
  if (!commands.length) return [];
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands.map((c) => c.map(String))),
  });
  if (!r.ok) throw new Error(`store ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const out = await r.json();
  const rows = Array.isArray(out) ? out : [out];
  const bad = rows.find((x) => x && x.error);
  if (bad) throw new Error(`store: ${String(bad.error).slice(0, 160)}`);
  return rows.map((x) => (x ? x.result : null));
}

export const one = async (...cmd) => (await pipe([cmd]))[0];
