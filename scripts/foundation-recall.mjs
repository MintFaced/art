#!/usr/bin/env node
/* The prepared batch for recalling tokens out of Foundation escrow.
 *
 * Every Foundation listing holds the token in Foundation's market contract
 * rather than in Ryan's wallet. Recalling one is a transaction, and doing a
 * hundred of them by clicking through a web interface is how one gets missed.
 * So the calls are written out here in full: function, arguments, and the
 * exact calldata, one row per token, in a fixed order.
 *
 * Nothing here signs or sends anything. It produces a document to read
 * before a Ledger session, which is the only safe way round.
 *
 * The two calls, taken from the market contract's own ABI rather than from
 * memory. Their selectors are derived the same way as getBuyPrice and
 * getReserveAuctionIdFor, which the listings sync already uses, so those two
 * serve as the control that the derivation is right:
 *
 *   cancelBuyPrice(address nftContract, uint256 tokenId)   0x21561935
 *   cancelReserveAuction(uint256 auctionId)                0x21506fff
 *
 * An auction that has taken a bid cannot be cancelled. Those are found and
 * listed separately rather than being written into a batch that would revert.
 *
 *   node scripts/foundation-recall.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MARKET = '0xcda72070e455bb31c7690a170224ce43623d0b6f';
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const SEL = {
  cancelBuyPrice: '0x21561935',
  cancelReserveAuction: '0x21506fff',
  getReserveAuctionIdFor: '0x2ab2b52b',
  getReserveAuction: '0x9e79b41f',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

async function call(data) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MARKET, data }, 'latest'] }) });
      const j = await r.json();
      if (j.result && j.result !== '0x') return j.result;
      if (j.result === '0x') return null;
    } catch (e) { /* retry */ }
    await sleep(400 * (i + 1));
  }
  return null;
}
const words = (hex) => {
  const d = hex.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= d.length; i += 64) out.push('0x' + d.slice(i, i + 64));
  return out;
};

const listings = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/listings.json'), 'utf8')).works;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));

// the work behind each listing, so a row can be read without a lookup
const work = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  // the vault mirrors other collections' works by the same id, and its rows
  // carry collection_contract rather than a digital record. Reading it here
  // overwrote two real Seize And Share entries and quietly dropped them.
  if (col.slug === 'the-vault') continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    work.set(w.id, { title: w.title || w.id, collection: col.slug, status: w.status, digital: w.digital || {} });
  }
}

const dropped = [];
const rows = Object.entries(listings)
  .filter(([, l]) => String(l.venue).toLowerCase() === 'foundation')
  .map(([id, l]) => ({ id, l, w: work.get(id) }))
  .filter((r) => {
    if (r.w && r.w.digital.contract) return true;
    dropped.push({ id: r.id, why: r.w ? 'the work record carries no contract' : 'no work record for this listing' });
    return false;
  })
  .sort((a, b) => (a.w.collection).localeCompare(b.w.collection) || a.id.localeCompare(b.id));

const buyNow = [], auctions = [], bidOn = [], unknown = [];
for (const r of rows) {
  const c = r.w.digital.contract;
  const t = r.w.digital.token_id;
  if (r.l.kind === 'buy-now') {
    buyNow.push({ ...r, fn: `cancelBuyPrice(${c}, ${t})`,
      data: SEL.cancelBuyPrice + addrWord(c) + word(t) });
    continue;
  }
  // an auction is cancelled by its id, and only while nobody has bid
  const idHex = await call(SEL.getReserveAuctionIdFor + addrWord(c) + word(t));
  await sleep(120);
  const auctionId = idHex ? BigInt(idHex) : 0n;
  if (!auctionId) { unknown.push({ ...r, why: 'no reserve auction id on chain' }); continue; }
  const det = await call(SEL.getReserveAuction + word(auctionId));
  await sleep(120);
  const w8 = det ? words(det) : [];
  const bidder = w8[6] ? '0x' + w8[6].slice(-40) : null;
  const amount = w8[7] ? BigInt(w8[7]) : 0n;
  const live = bidder && bidder !== '0x' + '0'.repeat(40);
  const row = { ...r, auctionId: auctionId.toString(), bidder, amount,
    fn: `cancelReserveAuction(${auctionId})`, data: SEL.cancelReserveAuction + word(auctionId) };
  (live ? bidOn : auctions).push(row);
}

const nzd = (r) => (r.l.price_eth != null ? `${r.l.price_eth} ETH` : '');
const table = (list, cols) => [
  `| ${cols.join(' | ')} |`,
  `|${cols.map(() => '---').join('|')}|`,
  ...list,
].join('\n');

const out = `# Ledger session ... Foundation recall

Generated by \`scripts/foundation-recall.mjs\` from \`data/listings.json\` and the
market contract itself. Regenerate rather than edit.

Nothing here has been signed or sent. It is a document to read first.

**Market contract** \`${MARKET}\`
**Signer** must be the seller on each listing, which for all of these is
mintface.eth \`0xd40b63bf04a44e43fbfe5784bcf22acaab34a180\`.

Both selectors come from the market contract's published ABI. The same
derivation reproduces \`getBuyPrice\` \`0x4635256e\` and \`getReserveAuctionIdFor\`
\`0x2ab2b52b\`, which the listings sync already uses against this contract, so
those two are the control.

| call | selector | arguments |
|---|---|---|
| \`cancelBuyPrice\` | \`${SEL.cancelBuyPrice}\` | \`address nftContract, uint256 tokenId\` |
| \`cancelReserveAuction\` | \`${SEL.cancelReserveAuction}\` | \`uint256 auctionId\` |

Recalling a token returns it from escrow to the signer's wallet. It does not
change anything on this site: the works stay available and keep the standard
acquire flow, and an OpenSea listing takes over as the on-chain path the
moment one exists.

---

## Batch one ... buy-now listings (${buyNow.length})

\`cancelBuyPrice(nftContract, tokenId)\` on \`${MARKET}\`, value 0.

${table(buyNow.map((r) => `| ${r.w.collection} | ${r.w.title} | \`${r.w.digital.contract}\` | ${r.w.digital.token_id} | ${nzd(r)} | \`${r.data}\` |`),
  ['collection', 'work', 'nftContract', 'tokenId', 'listed at', 'calldata'])}

---

## Batch two ... reserve auctions with no bid (${auctions.length})

\`cancelReserveAuction(auctionId)\` on \`${MARKET}\`, value 0.

${auctions.length ? table(auctions.map((r) => `| ${r.w.collection} | ${r.w.title} | ${r.auctionId} | \`${r.data}\` |`),
  ['collection', 'work', 'auctionId', 'calldata']) : 'None.'}

---

## Not cancellable (${bidOn.length + unknown.length})

${bidOn.length || unknown.length ? table([
  ...bidOn.map((r) => `| ${r.w.title} | auction ${r.auctionId} | a bid of ${Number(r.amount) / 1e18} ETH is standing, so it must run its course |`),
  ...unknown.map((r) => `| ${r.w.title} | ${r.l.kind} | ${r.why} |`),
], ['work', 'what', 'why']) : 'Nothing. Every Foundation listing above can be recalled.'}

---

${rows.length} Foundation listings in total: ${buyNow.length} buy-now, ${auctions.length + bidOn.length} auctions.
${dropped.length ? `\n**${dropped.length} listing${dropped.length === 1 ? '' : 's'} could not be prepared** and are not in any batch above:\n\n` + dropped.map((d) => `- \`${d.id}\` ... ${d.why}`).join('\n') : 'Nothing was left out.'}
`;

fs.writeFileSync(path.join(ROOT, 'docs/LEDGER-SESSION.md'), out);
console.log(`wrote docs/LEDGER-SESSION.md`);
console.log(`  buy-now to cancel:      ${buyNow.length}`);
console.log(`  auctions to cancel:     ${auctions.length}`);
console.log(`  auctions with a bid:    ${bidOn.length}`);
console.log(`  could not be read:      ${unknown.length}`);
// a batch that silently omits a token reads as complete when it is not
for (const d of dropped) console.log(`  DROPPED ${d.id}: ${d.why}`);
