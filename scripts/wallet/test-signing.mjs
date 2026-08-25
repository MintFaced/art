#!/usr/bin/env node
/* MF.sign, against a wallet that behaves like a wallet.
 *
 * Every signed feature on this site ... the nudges, the notes, the room ...
 * goes through one function, so this is the one place the browser half of the
 * signature is checked. It loads mintface.js as the browser does and hands it
 * an injected provider that answers the way a real one answers, including the
 * ways real ones say no.
 *
 * The case that matters most is the first: a signature made from the hex
 * payload MF.sign sends must verify against the plain sentence the server
 * rebuilds. If that ever stops being true, every wallet on the site stops
 * working at once and nothing else changes.
 *
 *   node scripts/wallet/test-signing.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyMessage, toHex, hexToString } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '../..');

/* ---------- mintface.js, loaded the way a page loads it ---------- */
const win = {};
const src = fs.readFileSync(path.join(ROOT, 'mintface.js'), 'utf8');
new Function('window', 'document', 'fetch', 'location', 'setTimeout', 'clearTimeout', 'console', src)(
  win, { addEventListener() {}, querySelector: () => null }, async () => ({ ok: false }),
  { href: 'https://mintface.art/chat', search: '' }, setTimeout, clearTimeout, console,
);
const MF = win.MF;

/* ---------- a wallet ---------- */
const account = privateKeyToAccount(generatePrivateKey());
const ADDRESS = account.address.toLowerCase();

/** An injected provider. `mode` decides how it behaves this time. */
function provider(mode, { delay = 0 } = {}) {
  const seen = [];
  return {
    seen,
    async request({ method, params }) {
      seen.push({ method, params });
      if (method === 'eth_requestAccounts') {
        if (mode === 'refuse-connect') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
        return [account.address];
      }
      if (method !== 'personal_sign') throw new Error(`unexpected ${method}`);
      const [data, who] = params;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (mode === 'refuse') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
      if (mode === 'pending') { const e = new Error('Already processing eth_requestAccounts.'); e.code = -32002; throw e; }
      if (mode === 'disconnected') { const e = new Error('The provider is disconnected.'); e.code = 4900; throw e; }
      if (mode === 'nothing') return null;
      /* A wallet that only understands hex, which is what personal_sign is
         specified to take and what a relay to a hardware wallet gives it. A
         UTF-8 string arriving here is the bug this is guarding against. */
      if (!/^0x[0-9a-f]*$/i.test(data)) { const e = new Error('data is not hex'); e.code = -32602; throw e; }
      if (String(who).toLowerCase() !== ADDRESS) throw new Error('signing as the wrong account');
      return account.signMessage({ message: { raw: data } });
    },
  };
}

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const SENTENCE = [
  'MintFace ... the room', '', 'Action: say',
  'Message: Kia ora. Ünicode, an em dash — and an emoji 🎨, because people paste things.',
  `Wallet: ${ADDRESS}`, 'Issued: 2026-08-25T07:00:00.000Z', '',
  'Signing speaks in the room. It moves nothing and spends nothing.',
].join('\n');

/* ================= the payload ================= */
head('What the wallet is handed');
{
  ok(MF.toHex('abc') === '0x616263', 'the payload is hex', MF.toHex('abc'));
  ok(MF.toHex(SENTENCE) === toHex(SENTENCE),
    'byte for byte what viem would produce, multi-byte characters included');
  ok(hexToString(MF.toHex(SENTENCE)) === SENTENCE, 'and it round-trips back to the sentence');

  win.ethereum = provider('ok');
  const sig = await MF.sign(SENTENCE, ADDRESS);
  const call = win.ethereum.seen.find((c) => c.method === 'personal_sign');
  ok(/^0x[0-9a-f]+$/i.test(call.params[0]), 'personal_sign is called with hex, not a string',
    `${String(call.params[0]).slice(0, 24)}…`);
  ok(call.params[1] === ADDRESS, 'and with the address second, which is the order personal_sign takes');

  ok(await verifyMessage({ address: account.address, message: SENTENCE, signature: sig }),
    'THE ONE THAT MATTERS: the server verifies it against the plain sentence',
    'hex in the request, plain text on the server, same bytes signed');

  const plain = await account.signMessage({ message: SENTENCE });
  ok(plain === sig, 'the signature is identical to the one a UTF-8 payload would have produced',
    'so nothing already signed or stored is invalidated by the change');
}

/* ================= it is only ever plain personal_sign ================= */
head('No typed data anywhere');
{
  win.ethereum = provider('ok');
  await MF.sign(SENTENCE, ADDRESS);
  const methods = win.ethereum.seen.map((c) => c.method);
  ok(methods.every((m) => m === 'personal_sign'), 'one method, personal_sign', methods.join(', '));
  ok(!methods.some((m) => /signTypedData/i.test(m)),
    'never eth_signTypedData ... a Ledger signs personal_sign in the Ethereum app without blind signing');

  const source = fs.readFileSync(path.join(ROOT, 'mintface.js'), 'utf8');
  ok(!/signTypedData|eth_sign\b/.test(source), 'and nothing in the shared runtime reaches for either');
}

/* ================= saying no ================= */
head('Every way a wallet says no is said out loud');
{
  const states = [];
  const watch = (s, why) => states.push(why ? `${s}: ${why}` : s);

  win.ethereum = provider('refuse');
  let err = null;
  try { await MF.sign(SENTENCE, ADDRESS, watch); } catch (e) { err = e; }
  ok(err && err.code === 4001 && /refused in the wallet/i.test(err.message),
    'a refusal in the wallet is reported as a refusal, not as silence', err && err.message);
  ok(states.some((x) => x.startsWith('requested')) && states.some((x) => x.startsWith('failed')),
    'and the caller saw it go out and saw it come back', states.join(' → '));

  win.ethereum = provider('pending');
  err = null;
  try { await MF.sign(SENTENCE, ADDRESS); } catch (e) { err = e; }
  ok(err && err.code === -32002 && /already has a request waiting/i.test(err.message),
    'a request queued behind another one says so, which is the dead-button case',
    err && err.message);

  win.ethereum = provider('disconnected');
  err = null;
  try { await MF.sign(SENTENCE, ADDRESS); } catch (e) { err = e; }
  ok(err && /not connected to this site/i.test(err.message), 'a disconnected provider says so', err && err.message);

  win.ethereum = provider('nothing');
  err = null;
  try { await MF.sign(SENTENCE, ADDRESS); } catch (e) { err = e; }
  ok(err && /without a signature/i.test(err.message),
    'a wallet that answers with nothing is an error, not an empty signature', err && err.message);

  delete win.ethereum;
  err = null;
  try { await MF.sign(SENTENCE, ADDRESS); } catch (e) { err = e; }
  ok(err && /No wallet found/i.test(err.message), 'no wallet at all says so before anything else');
}

/* ================= the wait ================= */
head('A wallet that takes its time');
{
  const states = [];
  win.ethereum = provider('ok', { delay: 60 });
  const sig = await MF.sign(SENTENCE, ADDRESS, (s) => states.push(s));
  ok(states[0] === 'requested', 'the caller is told the instant the request goes out', states.join(' → '));
  ok(states[states.length - 1] === 'signed' && sig.startsWith('0x'),
    'and told when it comes back');
  ok(!states.includes('slow'), 'a wallet that answers quickly is never called slow');

  /* The slow warning is what a hardware wallet needs: twelve seconds of
     nothing, with the prompt possibly behind the window. Checked by driving
     the timer rather than by waiting twelve seconds. */
  const source = fs.readFileSync(path.join(ROOT, 'mintface.js'), 'utf8');
  ok(/setTimeout\(\(\) => onState\('slow'\), 12000\)/.test(source),
    "after twelve seconds of silence the caller is told 'slow'");
  ok(/clearTimeout\(slow\)/.test(source), 'and the warning is cancelled however the request ends');
}

/* ================= connecting ================= */
head('Connecting');
{
  win.ethereum = provider('ok');
  const a = await MF.connect();
  ok(a === ADDRESS, 'the address comes back lowercased', a);
  ok(win.ethereum.seen.length === 1 && win.ethereum.seen[0].method === 'eth_requestAccounts',
    'connecting asks for accounts and nothing else ... no signature is requested here',
    win.ethereum.seen.map((c) => c.method).join(', '));

  win.ethereum = provider('refuse-connect');
  let err = null;
  try { await MF.connect(); } catch (e) { err = e; }
  ok(err && /refused in the wallet/i.test(err.message),
    'and a refusal to connect is reported as one', err && err.message);
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
