/* What the wallet actually said.
 *
 * A refusal that reads `an error occurred` has told nobody anything, and on a
 * phone there is no console to open. A page loaded with ?debug=1 leaves the
 * wallet's own code, message and data behind a failed signature, along with
 * the sentence it was asked to sign; this reads them back.
 *
 *   node scripts/chat/read-sign-notes.mjs [--env /tmp/mfenv] [--clear]
 *
 * Notes expire after a day and only the last fifty are kept. They are a thing
 * to look at this afternoon, not a store.
 */
import { readFileSync } from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const envFile = arg('--env', '/tmp/mfenv');
try {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_0-9]+)="?(.*?)"?$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) { /* the environment may already hold them */ }

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL_ || !TOKEN) {
  console.error('No store credentials. vercel env pull /tmp/mfenv --environment=production');
  process.exit(1);
}

const call = async (path) => {
  const r = await fetch(`${URL_}/${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
};

if (process.argv.includes('--clear')) {
  await call('del/mf:notes:sign');
  console.log('cleared');
  process.exit(0);
}

const rows = await call('lrange/mf:notes:sign/0/-1');
if (!rows || !rows.length) {
  console.log('Nothing waiting. Load the page with ?debug=1 and reproduce the refusal.');
  process.exit(0);
}
console.log(`${rows.length} note${rows.length === 1 ? '' : 's'}, newest first\n`);
for (const raw of rows) {
  let n;
  try { n = JSON.parse(raw); } catch (e) { console.log('unreadable row'); continue; }
  console.log('='.repeat(72));
  console.log(`${n.at}   ${n.what}`);
  console.log(`shown   ${n.shown || ''}`);
  console.log(`code    ${n.code || '(none)'}`);
  if (n.raw) console.log(`raw     ${n.raw}`);
  if (n.data) console.log(`data    ${n.data}`);
  if (n.cause) console.log(`cause   ${n.cause}`);
  if (n.ua) console.log(`ua      ${n.ua}`);
  if (n.sent) {
    console.log(`\nwallet  ${n.sent.wallet}   rail ${n.sent.rail}   ${n.sent.bytes} bytes`);
    console.log(`account ${n.sent.account}`);
    console.log(`address ${n.sent.address}`);
    console.log('\n' + String(n.sent.message).split('\n').map((l) => `  | ${l}`).join('\n'));
  }
  console.log('');
}
