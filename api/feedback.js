/* The agent letterbox's door (AGENT-FEEDBACK.md).
 *
 *   POST /ai/feedback        a note, as raw markdown or JSON { markdown, agent, contact }
 *   GET  /ai/feedback/{id}   where that note stands, and Ryan's reply ... never the note
 *
 * Both arrive here by rewrite with their own URL intact. A human reads every
 * note; nothing a note says is ever acted on by the site.
 */
import { storeConfigured } from './_lib/kv.js';
import { clientOf, MAX_BYTES, receive, statusOf, TEMPLATE } from './_lib/feedback.js';

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 1), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, X-Agent-Name, X-Agent-Wallet, X-MintFace-Ref',
    'cache-control': 'no-store',
  },
});

export async function OPTIONS() { return json({}, 204); }

export async function GET(request) {
  if (!storeConfigured()) return json({ error: 'The letterbox is not open on this deployment.' }, 503);
  const m = /^\/ai\/feedback\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!m) {
    return json({ how: 'POST markdown to /ai/feedback. A human reads every note.', template: TEMPLATE,
      max_bytes: MAX_BYTES, check: 'GET /ai/feedback/{id} for where a note stands' });
  }
  const s = await statusOf(decodeURIComponent(m[1]));
  if (!s) return json({ error: 'No note by that id.', feedback: '/ai/feedback' }, 404);
  return json(s);
}

export async function POST(request) {
  if (!storeConfigured()) return json({ error: 'The letterbox is not open on this deployment.' }, 503);
  /* Read as text first, whatever it claims to be, so the size is measured
     before anything is made of it. A little over the limit is allowed for a
     JSON wrapper; the note inside it is measured on its own. */
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES + 2048) {
    return json({ error: `That note is over ${MAX_BYTES / 1024}KB. Trim it and send it again.` }, 413);
  }
  const type = String(request.headers.get('content-type') || '').toLowerCase();
  let markdown = raw;
  let agent = request.headers.get('x-agent-name');
  let wallet = request.headers.get('x-agent-wallet');
  let contact = null;
  if (type.includes('application/json')) {
    let j;
    try { j = JSON.parse(raw); } catch (e) { return json({ error: 'That is not JSON. Send { "markdown": "..." }, or the markdown itself as text/markdown.', template: TEMPLATE }, 400); }
    markdown = j && typeof j.markdown === 'string' ? j.markdown : '';
    agent = (j && j.agent) || agent;
    wallet = (j && j.wallet) || wallet;
    contact = (j && j.contact) || null;
  }
  const out = await receive({ markdown, agent, wallet, contact, ref: request.headers.get('x-mintface-ref'),
    client: clientOf(request.headers) });
  return json(out.body, out.status);
}
