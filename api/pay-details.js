// Where to send crypto, and what it converts to. Public, read only, no secrets.
const ETH_ADDRESS = process.env.ETH_RECEIVE_ADDRESS || '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180';
const BTC_ADDRESS = process.env.BTC_RECEIVE_ADDRESS || null;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
});

async function spot(pair) {
  try {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`).then((x) => x.json());
    const nzdPer = Number(r?.data?.amount);
    return nzdPer > 0 ? 1 / nzdPer : null;
  } catch { return null; }
}

export async function GET(request) {
  const chain = new URL(request.url).searchParams.get('chain') || 'ethereum';
  if (chain === 'bitcoin') {
    return json({ chain, address: BTC_ADDRESS, rate: await spot('BTC-NZD'), note: BTC_ADDRESS ? null : 'no BTC_RECEIVE_ADDRESS set' });
  }
  return json({ chain: 'ethereum', address: ETH_ADDRESS, ens: 'mintface.eth', rate: await spot('ETH-NZD') });
}
