#!/usr/bin/env node
/* WalletConnect, vendored.
 *
 * The site loads no third-party JavaScript from a third-party origin, and that
 * is deliberate rather than incidental: every script a page runs is served
 * from mintface.art and is in this repository where it can be read. A CDN tag
 * would put a wallet connection ... the one thing on this site that touches
 * somebody's keys ... behind a script somebody else can change.
 *
 * So the SDK is bundled here and committed, exactly as the fonts are. The
 * relay traffic at run time is WalletConnect's own network and unavoidable;
 * the CODE is ours to serve.
 *
 * WHY universal-provider AND NOT ethereum-provider. Measured, minified, gzipped:
 *
 *     @walletconnect/ethereum-provider    2044 KB raw    577 KB gzip
 *     @walletconnect/universal-provider    473 KB raw    142 KB gzip
 *     @walletconnect/sign-client           434 KB raw    132 KB gzip
 *
 * The whole of mintface.js is 39 KB gzipped, so the full provider is fifteen
 * times the site's own script, and nearly all of the difference is the modal
 * ... a wallet-chooser UI in somebody else's design language, which this site
 * would not use. universal-provider is ten kilobytes more than the thinnest
 * option and speaks EIP-1193, the same `request({ method })` every injected
 * wallet here already speaks, so nothing downstream has to know which rail a
 * provider arrived on. The QR and the deep links are ours.
 *
 * Nobody pays for it until they need it: the bundle is fetched on demand, the
 * first time somebody presses CONNECT in a browser with no wallet in it.
 *
 *   node scripts/build-walletconnect.mjs
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'vendor', 'walletconnect.js');
const ENTRY = path.join(ROOT, 'vendor', '_entry.mjs');

/* One global, named so it cannot collide with anything the page has. */
fs.writeFileSync(ENTRY, `import UniversalProvider from '@walletconnect/universal-provider';
window.MF_WC = { UniversalProvider };
`);

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  outfile: OUT,
  logLevel: 'error',
});
fs.unlinkSync(ENTRY);

const raw = fs.statSync(OUT).size;
const gz = gzipSync(fs.readFileSync(OUT), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
fs.writeFileSync(OUT, `/* WalletConnect (universal-provider), bundled by scripts/build-walletconnect.mjs.
   Vendored rather than loaded from a CDN: this site serves every script it runs.
   Not edited by hand. ${kb(raw)} raw, ${kb(gz)} gzipped. */\n${fs.readFileSync(OUT, 'utf8')}`);
console.log(`vendor/walletconnect.js  ${kb(raw)} raw  ${kb(gz)} gzipped`);
