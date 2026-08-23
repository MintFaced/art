/* Finding work that has been minted since the catalogue was last written.
 *
 * The sweep has always tracked tokens it already knew about. It asked, for
 * every record, who holds it now. That answers nothing about a token that has
 * come into existence since ... which is why Patrimora 182 through 185 minted,
 * sold, and never appeared on the site at all.
 *
 * Births are read from the chain the only way that is exact: a Transfer whose
 * `from` is the zero address is a mint, whatever the id scheme, whether or not
 * the contract exposes totalSupply. Counting supply would have been simpler
 * and wrong ... Genesis sits on Foundation's shared contract, whose supply is
 * a hundred and fourteen thousand other people's work.
 *
 * Pure of anything MintFace-specific beyond what it is handed. Which contracts
 * mint openly is config, in data/source/open-mint.json.
 */

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (v) => BigInt(v).toString(16).padStart(64, '0');

/** Mint logs for one contract, oldest first. */
export async function mintsSince({ contract, fromBlock, toBlock, es }) {
  const out = [];
  const walk = async (from, to) => {
    const r = await es({ module: 'logs', action: 'getLogs', address: contract,
      topic0: TRANSFER, topic1: ZERO_TOPIC, topic0_1_opr: 'and',
      fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' });
    await sleep(200);
    if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
      if (from >= to) return;
      const mid = Math.floor((from + to) / 2);
      await walk(from, mid);
      await walk(mid + 1, to);
      return;
    }
    for (const l of Array.isArray(r) ? r : []) {
      // an ERC-20 Transfer shares this signature and has no token id
      if (!l.topics || l.topics.length < 4) continue;
      out.push({
        tokenId: BigInt(l.topics[3]).toString(),
        to: ('0x' + l.topics[2].slice(-40)).toLowerCase(),
        ts: Number(l.timeStamp) || parseInt(l.timeStamp, 16),
        block: Number(l.blockNumber) || parseInt(l.blockNumber, 16),
        tx: l.transactionHash,
      });
    }
  };
  await walk(fromBlock, toBlock);
  return out.sort((a, b) => a.block - b.block);
}

const decodeString = (hex) => {
  const h = hex.replace(/^0x/, '');
  if (h.length < 128) return null;
  const len = parseInt(h.slice(64, 128), 16);
  if (!len) return null;
  return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8');
};

// ar:// is not a URL a browser can follow, and the catalogue has always stored
// the gateway form
const gateway = (u) => (typeof u === 'string' && u.startsWith('ar://')
  ? 'https://node1.irys.xyz/' + u.slice(5)
  : u || null);

/** Everything the chain and its metadata will say about one new token. */
export async function readToken({ contract, tokenId, standard, rpc }) {
  const call = async (data) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data }, 'latest'] }) });
        const j = await r.json();
        if (j.result && j.result !== '0x') return j.result;
      } catch (e) { /* retry */ }
      await sleep(300 * (i + 1));
    }
    return null;
  };
  const ownerHex = standard === 'ERC-1155' ? null : await call('0x6352211e' + word(tokenId));
  const owner = ownerHex ? ('0x' + ownerHex.slice(-40)).toLowerCase() : null;
  const uriHex = await call((standard === 'ERC-1155' ? '0x0e89341c' : '0xc87b56dd') + word(tokenId));
  const uri = uriHex ? decodeString(uriHex) : null;

  let md = null;
  if (uri) {
    const url = uri.startsWith('ar://') ? gateway(uri) : uri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        if (r.ok) { md = await r.json(); break; }
        if (r.status === 404) break;
      } catch (e) { /* retry */ }
      await sleep(400 * (i + 1));
    }
  }
  return { owner, uri, md };
}

/** Build a catalogue record in the shape the collection already uses. */
export function buildRecord({ collection, contract, standard, tokenId, titlePattern, mint, owner, md, artist, vault, escrow }) {
  const m = md || {};
  const held = (a) => (artist[a] ? 'artist_held' : (a === vault ? 'vaulted' : (escrow.has(a) ? 'listed' : 'acquired')));
  const kind = owner ? held(owner) : 'acquired';
  return {
    ...(m.attributes ? { attributes: m.attributes } : {}),
    ...(mint ? { minted_onchain: new Date(mint.ts * 1000).toISOString(), mint_tx: mint.tx } : {}),
    id: `${collection}-${tokenId}`,
    collection,
    title: (m.name && String(m.name).trim()) || titlePattern.replace('{id}', tokenId),
    statement: m.description ? String(m.description).trim() : null,
    edition: { type: '1/1' },
    digital: {
      chain: 'ethereum', standard, contract, token_id: String(tokenId),
      image: gateway(m.image || m.image_url || null),
      animation: gateway(m.animation_url || null),
      image_details: null,
      external_url: m.external_url || null,
    },
    physical: { exists: null, width_cm: null, height_cm: null, depth_cm: null,
      ready_to_hang: null, framed: null, certificate: null,
      packaging: 'Ships boxed/crated, freight included' },
    pricing_nzd: { digital: null, painting: null, both: null },
    status: kind === 'acquired' ? 'acquired' : (kind === 'vaulted' ? 'vaulted' : 'available'),
    held_by: kind === 'artist_held' ? artist[owner] : (kind === 'listed' ? 'Foundation market escrow' : null),
    listed_on: kind === 'listed' ? 'Foundation' : null,
    reserve: null,
    collector: kind === 'acquired'
      ? { address: owner, ens: null, display_name: null, note: null,
          acquired: mint ? new Date(mint.ts * 1000).toISOString() : null }
      : null,
  };
}
