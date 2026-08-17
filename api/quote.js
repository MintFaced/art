import { findWork, useRequestOrigin } from './_lib/data.js';
import { issueQuote, quoteConfigured, QUOTE_MINUTES } from './_lib/quote.js';
import { nzdToUsd } from './_lib/fx.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function spot(pair) {
  const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`).then((x) => x.json());
  const nzdPer = Number(r?.data?.amount);
  return nzdPer > 0 ? 1 / nzdPer : null;
}

// One rate for the whole slide-over, held for a quarter of an hour. The amount a
// buyer is shown is the amount that will be honoured.
export async function POST(request) {
  useRequestOrigin(request);
  if (!quoteConfigured()) return json({ error: 'quotes are not configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { workId } = body || {};
  if (!workId) return json({ error: 'workId is required' }, 400);

  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);

  const [eth, btc, usd] = await Promise.all([
    spot('ETH-NZD').catch(() => null),
    spot('BTC-NZD').catch(() => null),
    nzdToUsd().catch(() => null),
  ]);
  if (!eth && !btc && !usd) return json({ error: 'no rates available just now' }, 503);

  const q = issueQuote({ workId, rates: { eth, btc, usd } });
  return json({
    quote: q.token,
    rates: q.rates,
    issued: q.issued,
    expires: q.expires,
    minutes: QUOTE_MINUTES,
  });
}
