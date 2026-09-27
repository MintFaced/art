/* Seaport, for the agent rail.
 *
 * Everything here is arithmetic: building an order, hashing it the way Seaport
 * hashes it, folding a batch of them under one signature, packing that
 * signature so Seaport can unfold it again, and writing the transaction an
 * agent sends to fill one. No network, no store ... the route and the page
 * call this with what they already have, and the tests can check every byte.
 *
 * ONE SIGNATURE FOR THE WHOLE BATCH. Seaport 1.5 and later take a "bulk order":
 * the orders are the leaves of a merkle tree, the wallet signs the tree once as
 * EIP-712 typed data, and each order is filled with that one signature plus its
 * own index and path up the tree. A hardware wallet confirms once for a
 * hundred works rather than a hundred times.
 *
 * THE OPENSEA CONDUIT. The holding wallet already approves it on the AI
 * contracts, because it lists there, so an order that moves its token through
 * the conduit needs no new approval. Filling needs no conduit on the buyer's
 * side: they pay in ETH.
 *
 * Shapes follow the Seaport 1.6 contract exactly (ConsiderationStructs.sol).
 * The tests check the order hash against the deployed contract's own
 * getOrderHash, and a signed batch against its validate().
 */
import {
  concat, decodeEventLog, encodeAbiParameters, encodeFunctionData, hashStruct, hashTypedData,
  keccak256, numberToHex, parseAbi, recoverAddress, size, slice, toBytes,
} from 'viem';

export const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395';
export const VERSION = '1.6';
export const CHAIN_ID = 1;
export const OPENSEA_CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71';
export const OPENSEA_CONDUIT_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ZERO_HASH = `0x${'0'.repeat(64)}`;

export const ITEM = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 };
export const ORDER_TYPE = { FULL_OPEN: 0, PARTIAL_OPEN: 1, FULL_RESTRICTED: 2, PARTIAL_RESTRICTED: 3 };
/* A tree taller than this is refused by Seaport, and would be 16 million
   orders anyway. */
export const MAX_HEIGHT = 24;

export const domain = ({ chainId = CHAIN_ID, verifyingContract = SEAPORT } = {}) =>
  ({ name: 'Seaport', version: VERSION, chainId, verifyingContract });

export const ORDER_TYPES = {
  OrderComponents: [
    { name: 'offerer', type: 'address' },
    { name: 'zone', type: 'address' },
    { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' },
    { name: 'orderType', type: 'uint8' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'zoneHash', type: 'bytes32' },
    { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' },
    { name: 'counter', type: 'uint256' },
  ],
  OfferItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
};

export const bulkTypes = (height) => ({
  BulkOrder: [{ name: 'tree', type: `OrderComponents${'[2]'.repeat(height)}` }],
  ...ORDER_TYPES,
});

/* The encoded type string, as EIP-712 builds it: the primary type, then every
   type it references in alphabetical order. Seaport keeps a table of these
   hashes, one per height, and looks the signed one up by the proof's length. */
const ITEM_STRINGS = 'ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)'
  + 'OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)'
  + 'OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)';
export const bulkTypehash = (height) =>
  keccak256(toBytes(`BulkOrder(OrderComponents${'[2]'.repeat(height)} tree)${ITEM_STRINGS}`));

/* The empty order every unused leaf holds, so a batch of 109 is a tree of 128.
   Nothing can fill it: it offers nothing and its window closed in 1970. */
export const EMPTY_ORDER = Object.freeze({
  offerer: ZERO_ADDRESS, zone: ZERO_ADDRESS, offer: [], consideration: [],
  orderType: 0, startTime: 0n, endTime: 0n, zoneHash: ZERO_HASH, salt: 0n,
  conduitKey: ZERO_HASH, counter: 0n,
});

/**
 * A sell order for one token, paid in ETH, to anybody who fills it.
 *
 * FULL_OPEN and no zone: nothing but Seaport stands between the order and the
 * person filling it, which is the point ... custody-free, and no server of ours
 * can be asked to approve a fill. An ERC-1155 sells one copy per order.
 */
export function sellOrder({
  offerer, token, tokenId, standard = 'ERC-721', priceWei, recipient = offerer,
  startTime, endTime, salt, counter = 0n, conduitKey = OPENSEA_CONDUIT_KEY,
}) {
  const is1155 = /1155/.test(String(standard));
  return {
    offerer,
    zone: ZERO_ADDRESS,
    offer: [{
      itemType: is1155 ? ITEM.ERC1155 : ITEM.ERC721,
      token,
      identifierOrCriteria: BigInt(tokenId),
      startAmount: 1n,
      endAmount: 1n,
    }],
    consideration: [{
      itemType: ITEM.NATIVE,
      token: ZERO_ADDRESS,
      identifierOrCriteria: 0n,
      startAmount: BigInt(priceWei),
      endAmount: BigInt(priceWei),
      recipient,
    }],
    orderType: ORDER_TYPE.FULL_OPEN,
    startTime: BigInt(startTime),
    endTime: BigInt(endTime),
    zoneHash: ZERO_HASH,
    salt: BigInt(salt),
    conduitKey,
    counter: BigInt(counter),
  };
}

/** Seaport's own order hash: the EIP-712 struct hash of the components. */
export const orderHash = (components) =>
  hashStruct({ data: components, primaryType: 'OrderComponents', types: ORDER_TYPES });

export const heightFor = (n) => {
  let h = 1;
  while ((1 << h) < n) h += 1;
  if (h > MAX_HEIGHT) throw new Error(`a batch of ${n} is past what one signature can carry`);
  return h;
};

const pairHash = (a, b) => keccak256(concat([a, b]));

/**
 * The batch as a tree: the padded leaves, every layer, and the root.
 *
 * Adjacent leaves pair first, so a leaf's position in its pair is the lowest
 * bit of its index, the next pair up the next bit, and so on. That is how
 * Seaport walks the proof, and how EIP-712 hashes nested fixed arrays: the
 * same tree, read by the wallet and by the contract.
 */
export function bulkTree(orders) {
  if (!orders.length) throw new Error('an empty batch');
  const height = heightFor(orders.length);
  const width = 1 << height;
  const leaves = [...orders, ...Array(width - orders.length).fill(EMPTY_ORDER)];
  const layers = [leaves.map(orderHash)];
  while (layers[layers.length - 1].length > 1) {
    const below = layers[layers.length - 1];
    const up = [];
    for (let i = 0; i < below.length; i += 2) up.push(pairHash(below[i], below[i + 1]));
    layers.push(up);
  }
  return { height, leaves, layers, root: layers[layers.length - 1][0] };
}

/** The sibling at every level from the leaf up. */
export function proofFor(tree, index) {
  const out = [];
  let i = index;
  for (let level = 0; level < tree.height; level += 1) {
    out.push(tree.layers[level][i ^ 1]);
    i >>= 1;
  }
  return out;
}

/** The leaves, folded into the nested pairs a wallet signs as `tree`. */
export function nestedTree(tree) {
  let level = tree.leaves;
  for (let h = 0; h < tree.height; h += 1) {
    const up = [];
    for (let i = 0; i < level.length; i += 2) up.push([level[i], level[i + 1]]);
    level = up;
  }
  return level[0];
}

/** What the wallet is asked to sign, whole: eth_signTypedData_v4 takes this. */
export const bulkTypedData = (tree, opts) => ({
  domain: domain(opts),
  types: bulkTypes(tree.height),
  primaryType: 'BulkOrder',
  message: { tree: nestedTree(tree) },
});

/**
 * The digest the wallet signs, worked out from the root alone. It is the same
 * number hashTypedData gives for the whole tree (the tests hold the two to
 * each other), and it is what lets one order be checked on its own later.
 */
export function bulkDigest(root, height, opts) {
  const structHash = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }], [bulkTypehash(height), root]));
  const sep = hashStruct({
    data: domain(opts),
    primaryType: 'EIP712Domain',
    types: { EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
    ] },
  });
  return keccak256(concat(['0x1901', sep, structHash]));
}

export const bulkDigestFromTypedData = (typed) => hashTypedData(typed);

/** The root an order's proof climbs to. */
export function rootFrom(leaf, index, proof) {
  let node = leaf;
  proof.forEach((sib, level) => {
    node = ((index >> level) & 1) ? pairHash(sib, node) : pairHash(node, sib);
  });
  return node;
}

/**
 * One order's signature: the batch signature, the order's index as three
 * bytes, and its path up the tree. Seaport tells a bulk signature from a plain
 * one by its length.
 */
export const packBulkSignature = (signature, index, proof) =>
  concat([signature, numberToHex(index, { size: 3 }), ...proof]);

export function unpackBulkSignature(packed) {
  const len = size(packed);
  const sigLen = (len - 3) % 32 === 1 ? 65 : 64;
  const height = (len - sigLen - 3) / 32;
  if (!Number.isInteger(height) || height < 1 || height > MAX_HEIGHT) return null;
  const signature = slice(packed, 0, sigLen);
  const index = Number(BigInt(slice(packed, sigLen, sigLen + 3)));
  const proof = [];
  for (let i = 0; i < height; i += 1) proof.push(slice(packed, sigLen + 3 + i * 32, sigLen + 3 + (i + 1) * 32));
  return { signature, index, proof, height };
}

/**
 * Who signed this one order, from the order and its packed signature alone.
 * The route calls this before it keeps an order and before it serves one.
 */
export async function bulkSigner(components, packed, opts) {
  const u = unpackBulkSignature(packed);
  if (!u) return null;
  const root = rootFrom(orderHash(components), u.index, u.proof);
  return recoverAddress({ hash: bulkDigest(root, u.height, opts), signature: u.signature });
}

/* ---------- filling ---------- */

export const SEAPORT_ABI = parseAbi([
  'struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }',
  'struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address recipient; }',
  'struct OrderComponents { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }',
  'struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }',
  'struct Order { OrderParameters parameters; bytes signature; }',
  'struct SpentItem { uint8 itemType; address token; uint256 identifier; uint256 amount; }',
  'struct ReceivedItem { uint8 itemType; address token; uint256 identifier; uint256 amount; address recipient; }',
  'function fulfillOrder(Order order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)',
  'function validate(Order[] orders) returns (bool validated)',
  'function cancel(OrderComponents[] orders) returns (bool cancelled)',
  'function incrementCounter() returns (uint256 newCounter)',
  'function getCounter(address offerer) view returns (uint256 counter)',
  'function getOrderHash(OrderComponents order) view returns (bytes32 orderHash)',
  'function getOrderStatus(bytes32 orderHash) view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)',
  'function information() view returns (string version, bytes32 domainSeparator, address conduitController)',
  'event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, SpentItem[] offer, ReceivedItem[] consideration)',
  'event OrderCancelled(bytes32 orderHash, address indexed offerer, address indexed zone)',
  'event CounterIncremented(uint256 newCounter, address indexed offerer)',
]);

/** The components as an Order: the counter is replaced by the item count. */
export function asOrder(components, signature) {
  const { counter, ...rest } = components;
  return {
    parameters: { ...rest, totalOriginalConsiderationItems: BigInt(components.consideration.length) },
    signature,
  };
}

/** What sits on the order in wei: the whole of its consideration. */
export const priceOf = (components) =>
  components.consideration.reduce((s, c) => s + BigInt(c.startAmount), 0n);

/**
 * The transaction that buys it, ready to send: Seaport's address, the call,
 * and the ETH it carries. The token goes to whoever sends it.
 */
export function fulfillTransaction(components, packedSignature, { verifyingContract = SEAPORT, chainId = CHAIN_ID } = {}) {
  return {
    chainId,
    to: verifyingContract,
    value: priceOf(components),
    data: encodeFunctionData({
      abi: SEAPORT_ABI, functionName: 'fulfillOrder',
      args: [asOrder(components, packedSignature), ZERO_HASH],
    }),
  };
}

export const cancelData = (componentsList) =>
  encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'cancel', args: [componentsList] });

export const incrementCounterData = () =>
  encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'incrementCounter', args: [] });

/**
 * The fills in a receipt, as Seaport logged them. Only logs from the Seaport
 * the order names count: an event with the same shape from another contract
 * is somebody else's story.
 */
export function fillsIn(receipt, { verifyingContract = SEAPORT } = {}) {
  const out = [];
  for (const log of (receipt && receipt.logs) || []) {
    if (String(log.address).toLowerCase() !== verifyingContract.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: SEAPORT_ABI, data: log.data, topics: log.topics });
      if (d.eventName === 'OrderFulfilled') out.push({ ...d.args, logIndex: log.logIndex });
    } catch (e) { /* another of Seaport's events */ }
  }
  return out;
}

/** Plain JSON for an order: bigints as decimal strings, for the store and the wire. */
export const orderToJSON = (components) => JSON.parse(JSON.stringify(components,
  (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/** And back. */
export function orderFromJSON(o) {
  const big = (v) => BigInt(v);
  return {
    ...o,
    offer: o.offer.map((i) => ({ ...i, identifierOrCriteria: big(i.identifierOrCriteria),
      startAmount: big(i.startAmount), endAmount: big(i.endAmount) })),
    consideration: o.consideration.map((i) => ({ ...i, identifierOrCriteria: big(i.identifierOrCriteria),
      startAmount: big(i.startAmount), endAmount: big(i.endAmount) })),
    startTime: big(o.startTime), endTime: big(o.endTime), salt: big(o.salt), counter: big(o.counter),
  };
}

/* A 65-byte signature with v as 27 or 28, which is what Seaport's ecrecover
   takes. Some wallets, and some hardware paths through them, answer with v as
   0 or 1; the signature is the same signature either way. */
export function normalizeSignature(sig) {
  const hex = String(sig);
  if (!/^0x[0-9a-fA-F]{130}$/.test(hex)) return hex;
  const v = parseInt(hex.slice(-2), 16);
  return v < 27 ? `${hex.slice(0, -2)}${(v + 27).toString(16).padStart(2, '0')}` : hex;
}
