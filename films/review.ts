/* Stills for review: frames of a film as PNGs, for looking at frame by frame.
 *
 *   node review.ts 01-strips 0 1.5 3 6.5          (seconds)
 *   node review.ts 01-strips --every 0.5          (a contact run)
 *
 * Writes out/review/<film>/<seconds>.png. FILMS.md asks for film 1 to be
 * reviewed frame by frame for the //Strips rule; this is the tool for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const ROOT = path.resolve(import.meta.dirname);
export const BROWSER = process.env.REMOTION_BROWSER
  || path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell');

const [id, ...rest] = process.argv.slice(2);
if (!id) { console.error('usage: node review.ts <film-id> <seconds...> | --every <s>'); process.exit(1); }
const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts'), publicDir: path.join(ROOT, 'public') });
const comp = await selectComposition({ serveUrl, id, browserExecutable: BROWSER });
const every = rest[0] === '--every' ? Number(rest[1]) : null;
const times = every ? Array.from({ length: Math.floor(comp.durationInFrames / comp.fps / every) + 1 }, (_, i) => +(i * every).toFixed(2)) : rest.map(Number);
const dir = path.join(ROOT, 'out', 'review', id);
fs.mkdirSync(dir, { recursive: true });
for (const t of times) {
  const frame = Math.min(comp.durationInFrames - 1, Math.round(t * comp.fps));
  const output = path.join(dir, `${String(t.toFixed(2)).padStart(5, '0')}.png`);
  await renderStill({ composition: comp, serveUrl, output, frame, browserExecutable: BROWSER, imageFormat: 'png' });
  console.log(output);
}
