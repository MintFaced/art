/* /api/strips: the //STRIPS routes.
 *
 * POST /api/strips/preview       {spec}      the design the spec makes, no voucher
 * POST /api/strips/mint/prepare  {spec, to}  the design and its voucher
 * GET  /api/strips/state                     where it's deployed, how many are left
 * GET  /api/strips/free?wallet=0x...         a wallet's free mints and its proof
 * GET  /api/strips/token/123                 one token, read off the chain
 * GET  /api/strips/gallery                   every token, for the gallery
 * GET  /api/strips/wallet?wallet=0x...       what a wallet holds, with its TAO
 * POST /api/strips/tx {op, id, ...}          a holder's transaction, to sign
 * POST /api/strips/refresh {id}              ask OpenSea to read a token again
 */
import { encodeFunctionData, isAddress, parseAbi, parseAbiItem, parseEventLogs } from 'viem';
import { chain, checkMintSpec, designOf, prepareMint, deployed, deployment, networkName, read, PRICE_WEI, PUBLIC_CAP } from './_lib/strips.js';
import { claimState, freeMintsFor } from './_lib/strips-snapshot.js';
import { cardPNG, refreshOpenSea, tokenFor } from './_lib/strips-token.js';
import { readGallery, taoNow } from './_lib/strips-index.js';
import { storeConfigured } from './_lib/kv.js';

const MINTED = parseAbiItem('event Minted(uint256 indexed id, address indexed to, bytes32 indexed designHash, uint256 requestId, bool free)');
const HOLDER = parseAbi(['function setView(uint256 id, uint8 n)', 'function tellStory(uint256 id, string text)']);

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
});
const route = (request) => new URL(request.url).pathname.replace(/^\/api\/strips\/?/, '');

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const path = route(request);
  if (path === 'preview') {
    const { spec, error } = checkMintSpec(body);
    if (error) return json({ error }, 400);
    const { design, hash, strips } = designOf(spec);
    let taken = false;
    if (deployed()) taken = await read.extension('designUsed', [hash]).catch(() => false);
    return json({ design, hash, strips, red_line: spec.red_line, taken });
  }
  if (path === 'mint/prepare') {
    /* A free mint's allowance is read here, never taken from the page, and it's
       read for a paid mint too: this is the door the fail-closed rule is held
       at, whatever a page shows. If the free mints can't be read, nothing is
       signed, and a wallet that's owed one isn't sold one. */
    if (!isAddress(String(body.to || ''))) return json({ error: 'connect a wallet first' }, 400);
    const f = await freeMintsFor(body.to);
    if (f.unavailable) return json({ error: 'free mints can\'t be read just now, so minting has paused' }, 503);
    if (body.free && !f.left) return json({ error: 'no free mints left on this wallet' }, 403);
    if (!body.free && f.left) return json({ error: 'this wallet has a free mint waiting' }, 409);
    const { status, error, ...rest } = await prepareMint({ ...body, free: body.free ? f : null });
    return json(error ? { error, ...rest } : rest, status);
  }
  /* The chain decides who may do these. This only spells the transaction. */
  if (path === 'tx') {
    if (!deployed()) return json({ error: 'not deployed' }, 503);
    const id = BigInt(Number(body.id) || 0);
    if (body.op === 'view') return json({ to: deployment().extension, data: encodeFunctionData({ abi: HOLDER, functionName: 'setView', args: [id, Number(body.n) || 0] }) });
    if (body.op === 'story') {
      const text = String(body.text || '').trim();
      if (!text || [...text].length > 280) return json({ error: 'a story is 1 to 280 characters' }, 400);
      return json({ to: deployment().extension, data: encodeFunctionData({ abi: HOLDER, functionName: 'tellStory', args: [id, text] }) });
    }
    return json({ error: 'no such op' }, 400);
  }
  /* The core has no ERC-4906, so a view change can't announce itself. */
  if (path === 'refresh') return json({ refreshed: await refreshOpenSea(Number(body.id) || 0) });
  return json({ error: 'not found' }, 404);
}

export async function GET(request) {
  const path = route(request);
  const url = new URL(request.url);
  if (path === 'state') {
    const d = deployment();
    if (!deployed()) return json({ deployed: false, network: networkName() }, 200, 'public, max-age=60');
    const [open, publicMinted, streetMinted, claim] = await Promise.all([
      read.extension('mintOpen'), read.extension('publicMinted'), read.extension('streetMinted'),
      claimState().catch(() => ({ ok: false, live: false, deadline: 0, reserved: 0 })),
    ]);
    return json({
      deployed: true, network: networkName(), chain_id: d.chain_id, core: d.core, extension: d.extension, ledger: d.ledger,
      open, public_minted: Number(publicMinted), street_minted: Number(streetMinted), price_wei: PRICE_WEI.toString(), claim_deadline: claim.deadline,
      claims_ok: claim.ok, claim_live: claim.live, reserved: claim.reserved, paid_left: Math.max(0, PUBLIC_CAP - Number(publicMinted) - claim.reserved),
    }, 200, 'public, max-age=15');
  }
  if (path === 'free') {
    const wallet = url.searchParams.get('wallet') || '';
    if (!isAddress(wallet)) return json({ error: 'wallet' }, 400);
    const f = await freeMintsFor(wallet);
    return json(f, f.unavailable ? 503 : 200);
  }
  /* Whether a transaction landed, asked here and not of the wallet: a phone
     over WalletConnect is only obliged to sign. */
  if (path === 'receipt') {
    const hash = url.searchParams.get('hash') || '';
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) return json({ error: 'hash' }, 400);
    if (!deployed()) return json({ error: 'not deployed' }, 404);
    const r = await chain().getTransactionReceipt({ hash }).catch(() => null);
    if (!r) return json({ pending: true });
    const ours = r.logs.filter((l) => l.address.toLowerCase() === deployment().extension.toLowerCase());
    const [minted] = parseEventLogs({ abi: [MINTED], logs: ours });
    return json({ status: r.status, token: minted ? Number(minted.args.id) : null });
  }
  if (path === 'gallery' || path === 'wallet') {
    const list = storeConfigured() && deployed() ? await readGallery().catch(() => []) : [];
    if (path === 'gallery') return json(list, 200, 'public, max-age=30');
    const wallet = (url.searchParams.get('wallet') || '').toLowerCase();
    if (!isAddress(wallet)) return json({ error: 'wallet' }, 400);
    const held = list.filter((t) => (t.owner || '').toLowerCase() === wallet).map((t) => ({ id: t.id, tao: taoNow(t), display: t.display, rhythm: t.rhythm, no: t.no, redeemed: t.redeemed, design: t.design }));
    /* collectors.mintface.art reads this for its //STRIPS row */
    return new Response(JSON.stringify(held), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' } });
  }
  /* the picture on a sale tweet. A design doesn't change once it's minted. */
  const card = path.match(/^card\/(\d+)$/);
  if (card) {
    const design = deployed() ? await read.extension('designOf', [BigInt(card[1])]).catch(() => null) : null;
    if (!design || design === '0x') return json({ error: 'no such token' }, 404);
    return new Response(await cardPNG(design), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
  }
  const token = path.match(/^token\/(\d+)$/);
  if (token) {
    const t = await tokenFor(Number(token[1]));
    return t ? json(t, 200, 'public, max-age=15') : json({ error: 'no such token' }, 404);
  }
  return json({ error: 'not found' }, 404);
}
