/* The //Strips rule, checked (FILMS.md).
 *
 *   node secret-grep.ts
 *
 * The method stays secret: nothing the films say or carry may name a grid
 * size, a seed, a sequence, the ordering rule, masking, or a product beyond
 * "Golden professional acrylics". This reads every word that reaches the
 * screen or the record ... script.json, the snapshot, the captures' words ...
 * and fails on any of them. It also fails on an em-dash in the copy.
 * It does not replace looking at film 1 frame by frame (review.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname);
const FILES = ['script.json', 'data/snapshot.json', 'data/captures.json', 'data/credits.json', 'data/street.json'];
const RULES: [RegExp, string][] = [
  [/\bgrids?\b/i, 'grid'],
  [/\bseed(ed|s)?\b/i, 'seed'],
  [/\bsequenc(e|es|ed|ing)\b/i, 'sequence'],
  [/\border(ing)?\s+(rule|of the (bands|strips|colours))\b/i, 'the ordering rule'],
  [/\bmask(s|ed|ing)?\b/i, 'masking'],
  [/\b(painter'?s|masking|frog)\s*tape\b|\btape(d|s)?\b/i, 'tape'],
  [/\b(liquitex|resene|dulux|wattyl|taubmans|montana|molotow|posca|winsor|newton|daler|rowney|frogtape|tamiya|tesa|scotch|mirka|sherwin|behr|valspar|rust-?oleum|benjamin moore|atelier|matisse|jo sonja|royal talens|amsterdam acrylic|sennelier|holbein|3m)\b/i, 'a product name'],
  [/\bgolden\b(?!\s+professional\s+acrylics)/i, 'Golden, other than "Golden professional acrylics"'],
];

const hits: string[] = [];
/* Every string, with where it is, keys included. */
const visit = (v: any, where: string, file: string) => {
  if (typeof v === 'string') {
    for (const [rx, what] of RULES) if (rx.test(v)) hits.push(`${file} ${where}: ${what} in "${v.slice(0, 120)}"`);
    if (file === 'script.json' && /[—]/.test(v)) hits.push(`${file} ${where}: an em-dash in "${v.slice(0, 120)}"`);
  } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${where}[${i}]`, file));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { visit(k, `${where}.${k} (key)`, file); visit(x, `${where}.${k}`, file); }
};
for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  visit(JSON.parse(fs.readFileSync(p, 'utf8')), '', f);
}
/* The copy in the films themselves, where any is written into the code. */
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  const text = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const strings = [...text.matchAll(/(?:text|label|url)=\{?[`'"]([^`'"]{3,})[`'"]/g)].map((m) => m[1]);
  strings.forEach((s) => visit(s, '', `src/${f}`));
}
if (hits.length) {
  console.error(`secret-grep: ${hits.length} hit${hits.length === 1 ? '' : 's'}`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`secret-grep: clean (${FILES.length} files and the films' own copy)`);
