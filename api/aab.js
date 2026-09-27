/* The agent rail's doors (AAB.md).
 *
 *   GET  /ai/catalog.json      what an agent can buy right now
 *   GET  /ai/buy/{id}          402 with the order and the transaction that
 *                              fills it; 200 once it is filled
 *   GET  /api/aab?view=ledger  what /mintwork/rail shows: every order, no signatures
 *   POST /api/aab              /mintwork/rail's hands: draft, keep, cancel, sweep
 *
 * The two /ai paths arrive here by rewrite with their own URL intact, so the
 * path says which door was knocked on.
 */
import { useRequestOrigin } from './_lib/data.js';
import { storeConfigured } from './_lib/kv.js';
import * as R from './_lib/aab.js';
import * as S from './_lib/seaport.js';
import * as B from './_lib/rebate.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 1), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'X-PAYMENT, X-MintFace-Ref, X-Agent-Address, X-Agent-Signature, X-Agent-Issued, content-type',
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
      const ref = request.headers.get('x-mintface-ref') || url.searchParams.get('ref');
      const out = await R.buy(id, { txHash, headers: request.headers, ref });
      const extra = { 'cache-control': 'no-store' };
      /* x402 hands the settlement back in a header as well as the body. */
      if (out.status === 200 && out.body && out.body.tx) {
        extra['x-payment-response'] = Buffer.from(JSON.stringify({ success: true, transaction: out.body.tx,
          network: 'ethereum', payer: out.body.collector })).toString('base64');
      }
      return json(out.body, out.status, extra);
    }
    if (url.searchParams.get('view') === 'ledger') return json(await R.ledger(), 200, { 'cache-control': 'no-store' });
    /* 🧧 The rebate ledger, public: every campaign and who is owed what. A
       wallet asked for is found wherever it falls, which is how /ai pins a
       signed-in reader's own row. */
    if (url.searchParams.get('view') === 'rebates') {
      const w = url.searchParams.get('wallet');
      return json(await B.view({ wallet: /^0x[0-9a-fA-F]{40}$/.test(w || '') ? w : null }), 200,
        { 'cache-control': w ? 'no-store' : 'public, max-age=60' });
    }
    return json({ error: 'Nothing here. The rail is at /ai/catalog.json and /ai/buy/{id}.' }, 404);
  } catch (e) {
    console.error('aab GET', path, e);
    return json({ error: 'The rail could not answer just now. Try again in a minute.' }, 500);
  }
}

/* A HEAD is a GET without the body, which the platform strips; an agent
   checking the door before it knocks gets the same status. */
export const HEAD = GET;

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
    /* After a cancel of everything is mined: the superseded list named in it
       is cleared too. The page calls this; the chain is the proof. */
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
    /* ---- 🧧 the rebate ----
       Starting and closing take the holding wallet's signature over a message
       the server writes, so every term is in what was signed. A payout is
       prepared here and sent by the holder; it is written down from the chain,
       and only a Disperse call from the holding wallet counts. */
    if (action === 'rebate-draft') {
      const d = await B.draftCampaign(body.terms || {});
      return json(d, d.status || 200);
    }
    if (action === 'rebate-start') {
      const out = await B.startCampaign({ terms: body.terms || {}, issued: String(body.issued || ''), signature: String(body.signature || '') });
      return json(out, out.status || 200);
    }
    if (action === 'rebate-close') {
      const id = String(body.id || '');
      if (!body.signature) {
        const issued = new Date().toISOString();
        return json({ issued, message: B.campaignMessage({ action: 'close', id, issued }) });
      }
      const out = await B.closeCampaign(id, 'closed by the artist', { issued: String(body.issued || ''), signature: String(body.signature) });
      return json(out, out.status || 200);
    }
    if (action === 'rebate-payout') {
      const out = await B.payoutPlan(String(body.id || ''));
      return json(out, out.status || 200);
    }
    if (action === 'rebate-paid') {
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(body.tx || ''))) return json({ error: 'Which transaction?' }, 400);
      const out = await B.recordPayout(String(body.tx));
      return json(out, out.status || 200);
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
