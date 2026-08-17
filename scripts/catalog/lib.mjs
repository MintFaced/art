// shared helpers for mintface.art phase 1 catalog enumeration
import { keccak256, toUtf8Bytes } from './keccak.mjs';

export const BS = 'https://eth.blockscout.com/api/v2';
export const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
  'https://rpc.flashbots.net',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url, { tries = 5, timeout = 40000, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', ...headers } });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) throw new Error('http ' + res.status);
      if (!res.ok) return { __error: res.status, __url: url };
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(600 * (i + 1) + Math.floor(Math.random() * 300));
    }
  }
  return { __error: String(lastErr), __url: url };
}

let rpcIdx = 0;
export async function rpc(method, params, { tries = 6 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const url = RPCS[rpcIdx++ % RPCS.length];
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30000);
      const res = await fetch(url, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      clearTimeout(t);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw new Error(`rpc ${method} failed: ${lastErr}`);
}

export async function ethCall(to, data, block = 'latest') {
  return rpc('eth_call', [{ to, data }, block]);
}

// ---- abi helpers (minimal) ----
export const selector = (sig) => keccak256(toUtf8Bytes(sig)).slice(0, 10);
export const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export const padUint = (n) => BigInt(n).toString(16).padStart(64, '0');

export function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const b = hex.replace(/^0x/, '');
  if (b.length < 128) return null;
  const off = parseInt(b.slice(0, 64), 16) * 2;
  const len = parseInt(b.slice(off, off + 64), 16) * 2;
  const body = b.slice(off + 64, off + 64 + len);
  return Buffer.from(body, 'hex').toString('utf8');
}
export const decodeAddress = (hex) => (hex && hex !== '0x' ? '0x' + hex.slice(-40) : null);
export const decodeUint = (hex) => (hex && hex !== '0x' ? BigInt(hex).toString() : null);

// ---- ENS ----
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
export function namehash(name) {
  let node = '0x' + '00'.repeat(32);
  if (name) {
    const labels = name.split('.');
    for (let i = labels.length - 1; i >= 0; i--) {
      const lh = keccak256(toUtf8Bytes(labels[i]));
      node = keccak256(Buffer.from(node.slice(2) + lh.slice(2), 'hex'));
    }
  }
  return node;
}
export async function ensResolve(name) {
  const node = namehash(name);
  const resolver = decodeAddress(await ethCall(ENS_REGISTRY, selector('resolver(bytes32)') + node.slice(2)));
  if (!resolver || /^0x0+$/.test(resolver)) return null;
  const addr = decodeAddress(await ethCall(resolver, selector('addr(bytes32)') + node.slice(2)));
  return addr && !/^0x0+$/.test(addr) ? addr : null;
}
export async function ensReverse(address) {
  const name = address.toLowerCase().replace(/^0x/, '') + '.addr.reverse';
  const node = namehash(name);
  const resolver = decodeAddress(await ethCall(ENS_REGISTRY, selector('resolver(bytes32)') + node.slice(2)));
  if (!resolver || /^0x0+$/.test(resolver)) return null;
  const nm = decodeString(await ethCall(resolver, selector('name(bytes32)') + node.slice(2)));
  if (!nm) return null;
  // forward-verify
  const fwd = await ensResolve(nm).catch(() => null);
  return fwd && fwd.toLowerCase() === address.toLowerCase() ? nm : null;
}

// ---- blockscout pagination ----
export async function bsPaged(path, { max = 100000, params = {} } = {}) {
  const out = [];
  let next = { ...params };
  for (let page = 0; page < 400; page++) {
    const qs = new URLSearchParams(next).toString();
    const j = await getJSON(`${BS}${path}${qs ? (path.includes('?') ? '&' : '?') + qs : ''}`);
    if (j.__error) { out.__error = j.__error; break; }
    if (!j.items) break;
    out.push(...j.items);
    if (out.length >= max || !j.next_page_params) break;
    next = { ...params, ...j.next_page_params };
    await sleep(180);
  }
  return out;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); }
        catch (e) { out[idx] = { __error: String(e) }; }
      }
    })
  );
  return out;
}
