import { findWork, priceNZD, priceETH, useRequestOrigin } from './_lib/data.js';
import { writeWorkState, workState, stateConfigured } from './_lib/state.js';
import { send } from './_lib/email.js';
import { readQuote } from './_lib/quote.js';

// The buyer pays mintface.eth from their own wallet and hands us the transaction
// hash. We verify it on chain: right recipient, enough value, actually mined.
// No key belongs on a server, so the token itself is transferred by hand afterwards.
const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
];
const RECEIVE = (process.env.ETH_RECEIVE_ADDRESS || '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180').toLowerCase();
const TOLERANCE_QUOTED = 0.005;   // the rate is locked, so only rounding moves
const TOLERANCE_LIVE = 0.02;      // no quote, so allow for drift since they sent it

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function rpc(method, params) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no rpc');
}

async function ethPerNzd() {
  const r = await fetch('https://api.coinbase.com/v2/prices/ETH-NZD/spot').then((x) => x.json());
  const nzdPerEth = Number(r?.data?.amount);
  if (!nzdPerEth) throw new Error('no eth rate');
  return 1 / nzdPerEth;
}

export async function POST(request) {
  useRequestOrigin(request);
  if (!stateConfigured()) {
    return json({ error: 'sale state is not configured yet, email art@mintface.art and it will be handled by hand' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { workId, what, txHash, address, quote } = body || {};
  if (!workId || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return json({ error: 'workId and a transaction hash are required' }, 400);
  }

  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);

  const live = await workState(workId);
  if (live?.paid?.tx === txHash) return json({ ok: true, already: true });
  const status = live?.status || hit.work.status;
  if (status !== 'available' && status !== 'reserved') return json({ error: `this work is ${status}` }, 409);

  const tx = await rpc('eth_getTransactionByHash', [txHash]);
  if (!tx) return json({ error: 'that transaction is not visible yet, try again in a moment' }, 404);
  const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
  if (!receipt) return json({ error: 'still pending, try again once it confirms' }, 202);
  if (receipt.status !== '0x1') return json({ error: 'that transaction failed on chain' }, 400);
  if ((tx.to || '').toLowerCase() !== RECEIVE) return json({ error: 'that payment did not go to mintface.eth' }, 400);

  const paidEth = Number(BigInt(tx.value)) / 1e18;

  // where the price is already in ETH there is nothing to convert, so no quote
  // is needed and no rate can move underneath it
  const fixedEth = priceETH(hit.work, what || 'digital');
  if (fixedEth) {
    if (paidEth < fixedEth * (1 - TOLERANCE_QUOTED)) {
      return json({ error: `that is ${paidEth.toFixed(4)} ETH, the work is ${fixedEth} ETH` }, 400);
    }
  }

  const nzd = fixedEth ? null : priceNZD(hit.work, what || 'digital');
  if (!fixedEth && !nzd) return json({ error: 'no price set for that option' }, 409);

  // The rate is whatever was locked when the slide-over opened. A quote counts as
  // live if it had not expired when the block was mined, so a payment sent inside
  // the window is honoured even if it confirms after it.
  let rate = null;
  if (!fixedEth && quote) {
    let minedAt = Date.now();
    try {
      const block = await rpc('eth_getBlockByNumber', [tx.blockNumber, false]);
      if (block?.timestamp) minedAt = Number(BigInt(block.timestamp)) * 1000;
    } catch { /* fall back to now */ }
    try {
      const q = readQuote(quote, { at: minedAt, workId });
      rate = q.rates?.eth || null;
    } catch (err) {
      return json({ error: err.message }, 409);
    }
  }
  if (!fixedEth) {
    if (!rate) rate = await ethPerNzd();
    const expected = nzd * rate;
    const tolerance = quote ? TOLERANCE_QUOTED : TOLERANCE_LIVE;
    if (paidEth < expected * (1 - tolerance)) {
      return json({ error: `that is ${paidEth.toFixed(4)} ETH, the work was quoted at ${expected.toFixed(4)} ETH` }, 400);
    }
  }

  await writeWorkState(workId, {
    status: 'acquired',
    what: what || 'digital',
    paid: { amount: paidEth, currency: 'ETH', tx: txHash, from: (tx.from || address || '').toLowerCase(), at: new Date().toISOString() },
    collector: { address: (tx.from || address || '').toLowerCase(), ens: null, display_name: null, note: null, acquired: new Date().toISOString() },
    token_transfer: 'pending',
  }, `Sold for ETH: ${hit.work.title || workId} (${paidEth.toFixed(4)} ETH)`);

  await send({
    to: process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art',
    subject: `Sold for ETH ... ${hit.work.title || workId}`,
    text: `${hit.work.title || workId} sold for ${paidEth.toFixed(4)} ETH.

From: ${tx.from}
Tx: https://etherscan.io/tx/${txHash}

The token still needs transferring by hand, hardware signed, to ${tx.from}.`,
  }).catch(() => {});

  return json({ ok: true, status: 'acquired', paid: paidEth, tx: txHash });
}
