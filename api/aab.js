/* The agent rail's doors (AAB.md).
 *
 *   GET  /ai/catalog.json      what an agent can buy right now
 *   GET  /ai/buy/{id}          402 with the order and the transaction that
 *                              fills it; 200 once it is filled
 *   GET  /api/aab?view=ledger  what /mintwork shows: every order, no signatures
 *   POST /api/aab              /mintwork's hands: draft, keep, cancel, sweep
 *
 * The two /ai paths arrive here by rewrite with their own URL intact, so the
 * path says which door was knocked on.
 */
import { useRequestOrigin } from './_lib/data.js';
import { storeConfigured } from './_lib/kv.js';
import * as R from './_lib/aab.js';
import * as S from './_lib/seaport.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 1), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'X-PAYMENT, X-Agent-Address, X-Agent-Signature, X-Agent-Issued, content-type',
    'access-control-expose-headers': 'X-PAYMENT-RESPONSE',
    ...extra,
  },
});

const unready = () => json({ error: 'The agent rail is not configured on this deployment.' }, 503);

export async function OPTIONS() {
  return json({}, 204);
}

export async function GET(request) {
  useRequestOrigin(request);
  if (!storeConfigured()) return unready();
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (/^\/ai\/catalog(\.json)?$/.test(path) || url.searchParams.get('view') === 'catalog') {
      return json(await R.feed(), 200, { 'cache-control': 'public, max-age=60' });
    }
    const m = /^\/ai\/buy\/([^/]+)$/.exec(path);
    const id = m ? decodeURIComponent(m[1]) : url.searchParams.get('buy');
    if (id) {
      const txHash = R.paymentHash(request.headers.get('x-payment'), url.searchParams.get('tx'));
      const out = await R.buy(id, { txHash, headers: request.headers });
      const extra = { 'cache-control': 'no-store' };
      /* x402 hands the settlement back in a header as well as the body. */
      if (out.status === 200 && out.body && out.body.tx) {
        extra['x-payment-response'] = Buffer.from(JSON.stringify({ success: true, transaction: out.body.tx,
          network: 'ethereum', payer: out.body.collector })).toString('base64');
      }
      return json(out.body, out.status, extra);
    }
    if (url.searchParams.get('view') === 'ledger') return json(await R.ledger(), 200, { 'cache-control': 'no-store' });
    return json({ error: 'Nothing here. The rail is at /ai/catalog.json and /ai/buy/{id}.' }, 404);
  } catch (e) {
    console.error('aab GET', path, e);
    return json({ error: 'The rail could not answer just now. Try again in a minute.' }, 500);
  }
}

export async function POST(request) {
  useRequestOrigin(request);
  if (!storeConfigured()) return unready();
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Send JSON.' }, 400); }
  const action = String(body.action || '');
  try {
    /* Drafting reads the chain for every work on the rail, and anybody can
       ask; so one at a time, a few seconds apart. It changes nothing: a draft
       is worth nothing until the holding wallet signs it. */
    if (action === 'draft') {
      if (!(await R.fence('draft', 5))) return json({ error: 'A batch is being drafted. Try again in a few seconds.' }, 429);
      const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.map(String) : null;
      return json(await R.draft({ ids }));
    }
    if (action === 'keep') {
      if (!/^[0-9a-f]{24}$/.test(String(body.draft || ''))) return json({ error: 'Which batch?' }, 400);
      const out = await R.keepSigned({ draft: body.draft, signature: String(body.signature || '') });
      return json(out, out.status || 200);
    }
    if (action === 'cancel') {
      return json(await R.cancelPlan(body.scope === 'retired' ? 'retired' : 'all'));
    }
    /* The nuclear option, said as what it is: every Seaport order this wallet
       has ever signed, OpenSea listings included. The page asks twice. */
    if (action === 'void') {
      return json({ tx: { to: S.SEAPORT, value: '0', data: S.incrementCounterData() },
        warning: 'This voids every Seaport order the holding wallet has signed, including its OpenSea listings.' });
    }
    if (action === 'cleared') {
      await R.clearRetired();
      return json({ ok: true });
    }
    if (action === 'sweep') {
      if (!(await R.fence('sweep', 30))) return json({ error: 'Swept a moment ago. Try again in half a minute.' }, 429);
      return json(await R.sweep());
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('aab POST', action, e);
    return json({ error: `That did not go through: ${String(e.shortMessage || e.message || e).slice(0, 160)}` }, 500);
  }
}
