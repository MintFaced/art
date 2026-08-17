#!/usr/bin/env node
// Takes a zip of web-sized paintings and its manifest, puts the images in R2
// under recent/, and writes the works into data/source/recent-work.json.
// Titles are the manifest's guesses: Ryan corrects them in the studio.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ZIP = process.argv[2] || 'docs/recent-works-web.zip';
const KEY = process.env.WARM_KEY || readFileSync('/tmp/warmkey.txt', 'utf8').trim();
const ORIGIN = process.env.IMPORT_ORIGIN || 'https://art-git-rebuild-mintfaceds-projects.vercel.app';
const PUBLIC = 'https://assets.mintface.art';
const SOURCE = 'data/source/recent-work.json';
const dry = process.argv.includes('--dry');

// a spelling Ryan corrected, applied to the title and the key rather than left
// in the URL for ever
const FIXES = { splein: 'spleen' };
const fixWord = (s) => s.replace(/\b(splein|Splein)\b/gi, (m) => (m[0] === m[0].toUpperCase() ? 'Spleen' : 'spleen'));

const dir = mkdtempSync(join(tmpdir(), 'recent-'));
execFileSync('unzip', ['-q', '-o', ZIP, '-d', dir]);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
console.log(`${manifest.length} works in the manifest`);

const slugOf = (file) => {
  let s = file.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  for (const [from, to] of Object.entries(FIXES)) s = s.replaceAll(from, to);
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

const src = JSON.parse(readFileSync(SOURCE, 'utf8'));
src.works = src.works || [];
const byId = new Map(src.works.map((w) => [w.id, w]));

// upload order decides what "latest six" means, so it is the manifest's order
// with the file's own time as a tiebreak rather than whatever the disk returns
const ordered = [...manifest].map((m, i) => {
  const path = join(dir, m.file);
  let at = 0;
  try { at = statSync(path).mtimeMs; } catch { /* fall back to manifest order */ }
  return { ...m, path, at, i };
}).sort((a, b) => a.at - b.at || a.i - b.i);

let added = 0, updated = 0, skipped = 0;
const base = Date.parse('2026-08-17T00:00:00.000Z');

for (let i = 0; i < ordered.length; i++) {
  const m = ordered[i];
  const id = slugOf(m.file);
  const ext = (m.file.match(/\.([a-z0-9]+)$/i) || [])[1].toLowerCase();
  const key = `recent/${id}.${ext}`;
  const [w, h] = m.web_px || m.orig_px || [];

  if (!dry) {
    const already = await fetch(`${PUBLIC}/${key}`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (!already) {
      const body = readFileSync(m.path);
      const r = await fetch(`${ORIGIN}/api/warm-assets?key=${KEY}&put=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': ext === 'png' ? 'image/png' : 'image/jpeg' },
        body,
      });
      if (!r.ok) { console.log(`  ! ${id}: upload ${r.status} ${(await r.text()).slice(0, 90)}`); continue; }
    }
  }

  const record = {
    id,
    title: fixWord(m.title_guess || id),
    title_from_manifest: true,
    group: m.group || 'painting',
    year: String(new Date().getFullYear()),
    medium: m.group === 'pixel' ? 'Acrylic on canvas' : 'Acrylic on canvas',
    edition: '1/1',
    image: `${PUBLIC}/${key}`,
    aspect: w && h ? Number((w / h).toFixed(4)) : null,
    orientation: m.orientation || null,
    // unpriced reads as Enquire until Ryan prices them
    pricing_nzd: { digital: null, painting: null, both: null },
    added: new Date(base + i * 60000).toISOString(),
  };

  const prev = byId.get(id);
  if (prev) {
    // never tread on a title or price Ryan has since corrected
    const keepTitle = prev.title_from_manifest === false || prev.title !== record.title;
    Object.assign(prev, record, {
      title: keepTitle && prev.title ? prev.title : record.title,
      title_from_manifest: keepTitle && prev.title ? false : true,
      pricing_nzd: prev.pricing_nzd || record.pricing_nzd,
      added: prev.added || record.added,
    });
    updated++;
  } else {
    src.works.push(record);
    byId.set(id, record);
    added++;
  }
}

if (!dry) writeFileSync(SOURCE, JSON.stringify(src, null, 2) + '\n');
console.log(`${added} added, ${updated} updated, ${skipped} skipped${dry ? ' (dry run, nothing written)' : ''}`);
const groups = {};
for (const w of src.works) groups[w.group || '?'] = (groups[w.group || '?'] || 0) + 1;
console.log('by group:', JSON.stringify(groups));
