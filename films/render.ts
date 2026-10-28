/* Render the films (FILMS.md · Output).
 *
 *   node render.ts                 every film whose inputs changed
 *   node render.ts 02-tao          just one
 *   node render.ts --force         all of them, regardless
 *   node render.ts --prores        also a ProRes 422 HQ master of each
 *
 * Each film is an H.264 MP4 for X: 1920 × 1080, 60 fps, yuv420p, moov at the
 * front, silent, under 50 MB. ProRes masters are off unless asked for (Ryan,
 * 28 Oct 2026: MP4s only); they run to about a gigabyte a film. A film is re-rendered only when
 * something it is made of changed: its own block of script.json, the
 * script's shared settings, the snapshot, the captures, the street, or the
 * code. So a line changed in one film's copy re-renders that film and the
 * 60-second cut (which is made of all four), and nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const ROOT = path.resolve(import.meta.dirname);
const OUT = path.join(ROOT, 'out');
const BROWSER = process.env.REMOTION_BROWSER
  || path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const FFMPEG = process.env.FFMPEG || path.join(ROOT, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
const args = process.argv.slice(2);
const force = args.includes('--force');
const prores = args.includes('--prores');
const only = args.filter((a) => !a.startsWith('--'));
const MAX_MB = 50;

const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'script.json'), 'utf8'));
const IDS = ['01-strips', '02-tao', '03-collectors', '04-studio', '00-mintface-60'];
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/* Everything a render reads, as one hash per film. */
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])).sort();
const shared = sha([
  ...walk(path.join(ROOT, 'src')).map((p) => sha(fs.readFileSync(p))),
  ...['snapshot.json', 'captures.json', 'street.json'].map((n) => sha(fs.readFileSync(path.join(ROOT, 'data', n)))),
  /* Pictures by name and size: the snapshot names them, so a changed picture
     is a changed snapshot; this catches a re-pull of the same names. */
  sha(walk(path.join(ROOT, 'public')).map((p) => `${path.relative(ROOT, p)}:${fs.statSync(p).size}`).join('\n')),
  sha(JSON.stringify({ ...script, films: undefined })),
].join(''));
const hashOf = (id: string) => sha(shared + (id === '00-mintface-60' ? JSON.stringify(script.films) : JSON.stringify(script.films[id])));

fs.mkdirSync(OUT, { recursive: true });
const ledgerPath = path.join(OUT, '.rendered.json');
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : {};
const todo = IDS.filter((id) => (!only.length || only.includes(id)) && (force || ledger[id] !== hashOf(id)
  || !fs.existsSync(path.join(OUT, `${id}.mp4`)) || (prores && !fs.existsSync(path.join(OUT, `${id}.mov`)))));
if (!todo.length) { console.log('nothing changed; every film is up to date'); process.exit(0); }

console.log(`bundling for ${todo.join(', ')}`);
const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts'), publicDir: path.join(ROOT, 'public') });
const freeGB = () => { try { return Number(execFileSync('df', ['-k', OUT]).toString().trim().split('\n').pop()!.split(/\s+/)[3]) / 1048576; } catch { return 99; } };

for (const id of todo) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable: BROWSER });
  const t0 = Date.now();
  const mp4 = path.join(OUT, `${id}.mp4`), raw = path.join(OUT, `.${id}.raw.mp4`);
  /* Well under the 50 MB cap at this quality, and X transcodes whatever it
     is given, so start high and come down only if a file runs over. */
  let crf = 13;
  for (;;) {
    /* BT.709, limited range: yuv420p as X expects it. Left to itself the
       encoder tags full-range JPEG colour (yuvj420p), which players and X
       read differently from the page the captures came from. */
    await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: raw, browserExecutable: BROWSER, crf, pixelFormat: 'yuv420p', colorSpace: 'bt709',
      x264Preset: 'slow', imageFormat: 'jpeg', jpegQuality: 95, concurrency: 6, muted: true,
      onProgress: ({ progress }) => process.stdout.write(`\r  ${id}.mp4  ${Math.round(progress * 100)}%   `) });
    /* moov first, so X starts playing before the file has finished arriving. */
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw, '-c', 'copy', '-movflags', '+faststart', mp4]);
    fs.rmSync(raw);
    const mb = fs.statSync(mp4).size / 1048576;
    if (mb <= MAX_MB || crf >= 26) { console.log(`\r  ${id}.mp4  ${mb.toFixed(1)} MB  crf ${crf}  ${Math.round((Date.now() - t0) / 1000)}s`); break; }
    crf += 3;
  }
  if (prores) {
    /* ProRes HQ runs to about a gigabyte a film at 1080p60: refuse rather
       than fill the disk. */
    const need = composition.durationInFrames / composition.fps * 0.06;
    if (freeGB() < need + 1.5) { console.log(`  ${id}.mov  skipped: ${freeGB().toFixed(1)} GB free, needs about ${need.toFixed(1)} GB plus headroom`); continue; }
    const t1 = Date.now();
    await renderMedia({ composition, serveUrl, codec: 'prores', proResProfile: 'hq', outputLocation: path.join(OUT, `${id}.mov`), browserExecutable: BROWSER,
      imageFormat: 'png', concurrency: 6, muted: true,
      onProgress: ({ progress }) => process.stdout.write(`\r  ${id}.mov  ${Math.round(progress * 100)}%   `) });
    console.log(`\r  ${id}.mov  ${(fs.statSync(path.join(OUT, `${id}.mov`)).size / 1048576).toFixed(0)} MB  ${Math.round((Date.now() - t1) / 1000)}s`);
  }
  ledger[id] = hashOf(id);
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
}
