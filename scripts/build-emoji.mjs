#!/usr/bin/env node
/* The world's emoji, in the room's shape.
 *
 * The quick row under a message is Ryan's list and stays six or eight long: it
 * is a nod, not a keyboard. The `+` at the end of it opens this ... every
 * standard emoji, which is a keyboard, and a keyboard is a thing you go and
 * ask for rather than a thing that sits under every message forever.
 *
 * Vendored rather than fetched at run time. The room may not depend on
 * unicode.org being up to draw a picker, and a file that only changes when the
 * Unicode Consortium publishes is a file that belongs in the repository. Read
 * once, lazily, the first time somebody presses `+`, and then held for the
 * visit.
 *
 * Fully-qualified forms only, and the base of each: the skin-tone variants are
 * a fifth of a megabyte of permutations that no picker shows as separate
 * entries, and the Component group is the modifiers themselves, which are not
 * emoji anybody reacts with.
 *
 * AND NOTHING NEWER THAN THE FONTS. An emoji the Consortium published last
 * autumn is a hollow box on every phone in the room until the platforms ship a
 * font for it, and a picker of boxes reads as broken rather than as current.
 * The ceiling is a knob, not a principle: raise it as the fonts catch up.
 *
 *   node scripts/build-emoji.mjs                 # write data/emoji.json
 *   node scripts/build-emoji.mjs --dry           # report only
 *   node scripts/build-emoji.mjs --upto 16.0     # let a newer set in
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data', 'emoji.json');
const SRC = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';

/* A skin tone is a modifier, and a modified emoji is the same emoji. The
   picker shows the base and the room stores what was pressed. */
const TONE = /[\u{1F3FB}-\u{1F3FF}]/u;

/* The newest emoji release this build will include. E15.1 is Unicode 15.1,
   which every current platform has had a font for for years. */
const upto = (() => {
  const at = process.argv.indexOf('--upto');
  const v = at > 0 ? process.argv[at + 1] : '15.1';
  const [a, b] = String(v).split('.').map(Number);
  return a * 1000 + (b || 0);
})();
const era = (v) => { const [a, b] = v.split('.').map(Number); return a * 1000 + (b || 0); };

let held = 0;
const parse = (text) => {
  const groups = [];
  let group = null;
  let version = '';
  for (const line of text.split('\n')) {
    const v = /^#\s*Version:\s*(\S+)/.exec(line);
    if (v) { version = v[1]; continue; }
    const g = /^#\s*group:\s*(.+?)\s*$/.exec(line);
    if (g) {
      group = { g: g[1], e: [] };
      /* Not a group of emoji: the tones and hair colours that modify them. */
      if (g[1] !== 'Component') groups.push(group);
      continue;
    }
    if (!group || line.startsWith('#') || !line.trim()) continue;
    const m = /^([0-9A-F ]+);\s*fully-qualified\s*#\s*(\S+)\s+E(\d+\.\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const glyph = m[2];
    if (TONE.test(glyph)) continue;
    if (era(m[3]) > upto) { held += 1; continue; }
    group.e.push([glyph, m[4]]);
  }
  return { version, groups: groups.filter((x) => x.e.length) };
};

const res = await fetch(SRC);
if (!res.ok) { console.error(`${SRC} said ${res.status}`); process.exit(1); }
const out = parse(await res.text());
out.source = SRC;
out.upto = `${(upto / 1000 | 0)}.${upto % 1000}`;
out._note = 'Built by scripts/build-emoji.mjs. Not edited by hand.';

const count = out.groups.reduce((n, g) => n + g.e.length, 0);
const json = JSON.stringify(out);
console.log(`Unicode ${out.version} tables · up to E${(upto / 1000 | 0)}.${upto % 1000}`
  + ` · ${out.groups.length} groups · ${count} emoji · ${(json.length / 1024).toFixed(1)}KB`
  + (held ? ` · ${held} held back as newer than the fonts` : ''));
for (const g of out.groups) console.log(`  ${String(g.e.length).padStart(4)}  ${g.g}`);

if (process.argv.includes('--dry')) process.exit(0);
fs.writeFileSync(OUT, json + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
