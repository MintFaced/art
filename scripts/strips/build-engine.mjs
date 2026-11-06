#!/usr/bin/env node
/* The engine as it goes on-chain: strips-blink.js, minified, set to play the
 * token in window.STRIP, gzipped. Writes contracts/build/engine.js.gz and fails
 * past the 30 KB budget. The same input always gives the same bytes.
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUDGET = 30 * 1024;

const out = await build({
  stdin: { contents: "import { play } from './strips-blink.js'; play(document.body, window.STRIP);", resolveDir: root, loader: 'js' },
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none', charset: 'utf8',
});
const js = out.outputFiles[0].contents;
const gz = gzipSync(js, { level: 9 });
mkdirSync(`${root}contracts/build`, { recursive: true });
writeFileSync(`${root}contracts/build/engine.min.js`, js);
writeFileSync(`${root}contracts/build/engine.js.gz`, gz);
console.log(`engine: ${js.length} bytes minified, ${gz.length} gzipped, budget ${BUDGET}`);
if (gz.length > BUDGET) { console.error('over the engine budget'); process.exit(1); }
