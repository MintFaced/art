#!/usr/bin/env node
/**
 * Import the pricing and dimensions spreadsheet.
 *
 *   node scripts/import-sheet.mjs "docs/mintface paintings data.xlsx"
 *
 * The sheet is Ryan's word: its Status and Collector override what the chain
 * reports, because a painting can change hands without the token moving. The
 * hand data lands in data/source/overlay.json, which the catalog builder merges
 * over the chain data, so rebuilding from chain never loses it.
 *
 * Anything ambiguous is written to docs/IMPORT-REPORT.md rather than guessed.
 */
import fs from 'fs';
import XLSX from 'xlsx';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const OVERLAY = ROOT + 'data/source/overlay.json';
const CATALOG = ROOT + 'catalog.json';
const REPORT = ROOT + 'docs/IMPORT-REPORT.md';
const file = process.argv[2] || ROOT + 'docs/mintface paintings data.xlsx';

const C = {
  id: 0, title: 1, status: 2, collector: 3, listedOn: 4, listedEth: 5,
  digital: 6, painting: 7, both: 8,
  w: 9, h: 10, d: 11, hang: 12, framed: 13, cert: 14, withCollector: 15, notes: 16,
};

const num = (v) => (v === '' || v == null ? null : Number(v));
const yn = (v) => (v == null || v === '' ? null : String(v).trim().toUpperCase() === 'Y');
const str = (v) => (v == null || v === '' ? null : String(v).trim());
const isAddress = (s) => /^0x[0-9a-fA-F]{6,}$/.test(s || '');

const wb = XLSX.readFile(file);
const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const byId = new Map();
for (const c of cat.collections) for (const w of c.works || []) byId.set(w.id, { work: w, collection: c });

const overlay = {
  _note: 'Hand data from the pricing spreadsheet. Status and Collector here override the chain. The builder merges this, so a rebuild keeps it.',
  source: file.split('/').pop(),
  imported: new Date().toISOString(),
  works: {},
};

const flags = { unpriced: [], statusDiffers: [], zeroPrice: [], noPhysicalButPriced: [], vaultLooking: [], unknown: [] };
const tally = { rows: 0, priced: 0, dimensioned: 0, named: 0, sold: 0, statusOverridden: 0, paintingIncluded: 0 };

for (const sheet of wb.SheetNames) {
  if (sheet === 'Legend') continue;
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false }).slice(1)) {
    const id = str(r[C.id]);
    if (!id) continue;
    tally.rows++;

    const hit = byId.get(id);
    if (!hit) { flags.unknown.push(id); continue; }
    const { work } = hit;

    const notes = str(r[C.notes]);
    const noPhysicalNote = /no physical/i.test(notes || '');
    const digital = num(r[C.digital]);
    const painting = num(r[C.painting]);
    const both = num(r[C.both]);
    const sheetStatus = str(r[C.status]);
    const collector = str(r[C.collector]);
    const soldPhysical = yn(r[C.withCollector]) === true;

    const entry = {};

    // ---- prices ----
    // A painting priced at zero means it comes with the digital work at no extra
    // cost, so the two stop being separate purchases and become one.
    const paintingIncluded = painting === 0 && digital != null && digital > 0;
    const priced = {};
    for (const [k, v] of [['digital', digital], ['painting', painting], ['both', both]]) {
      if (v == null) { priced[k] = null; continue; }
      if (v <= 0) {
        priced[k] = null;
        if (!paintingIncluded) flags.zeroPrice.push({ id, field: k, digital, painting, both });
        continue;
      }
      priced[k] = v;
    }
    if (paintingIncluded) {
      priced.both = priced.both || digital;   // one price, one purchase
      priced.digital = null;
      entry.painting_included = true;
      tally.paintingIncluded++;
    }
    if (priced.digital != null || priced.painting != null || priced.both != null) {
      entry.pricing_nzd = priced;
      tally.priced++;
    }

    // ---- the physical work ----
    const physical = {};
    if (noPhysicalNote) physical.exists = false;
    else if (r[C.w] != null || r[C.h] != null || painting != null) physical.exists = true;
    if (num(r[C.w]) != null) physical.width_cm = num(r[C.w]);
    if (num(r[C.h]) != null) physical.height_cm = num(r[C.h]);
    if (num(r[C.d]) != null) physical.depth_cm = num(r[C.d]);
    if (yn(r[C.hang]) != null) physical.ready_to_hang = yn(r[C.hang]);
    if (yn(r[C.framed]) != null) physical.framed = yn(r[C.framed]);
    if (yn(r[C.cert]) != null) physical.certificate = yn(r[C.cert]);
    if (soldPhysical) {
      physical.sold = true;
      if (collector && !isAddress(collector) && !/mintestate/i.test(collector)) physical.collector = collector;
      tally.sold++;
    }
    if (Object.keys(physical).length) {
      entry.physical = physical;
      if (physical.width_cm != null && physical.height_cm != null) tally.dimensioned++;
    }

    // The note wins over the price columns: no physical work means there is
    // nothing to sell but the token, so the painting prices are dropped.
    if (noPhysicalNote && (painting != null || both != null)) {
      priced.painting = null;
      priced.both = null;
      if (entry.pricing_nzd) entry.pricing_nzd = priced;
      flags.noPhysicalButPriced.push({ id, notes, painting, both });
    }

    // ---- Ryan's status and collector win ----
    // Compare against what the chain said, not against a status this importer
    // may already have overridden on a previous run.
    const chainStatus = work.status_chain || work.status;
    // A work with the vault as its collector is vaulted, not sold.
    const inVault = collector && /mintestate/i.test(collector);
    const resolvedStatus = inVault ? 'vaulted' : sheetStatus;
    if (resolvedStatus && resolvedStatus !== chainStatus) {
      entry.status = resolvedStatus;
      tally.statusOverridden++;
      flags.statusDiffers.push({ id, sheet: sheetStatus, resolved: resolvedStatus, chain: chainStatus, collector });
    }
    if (inVault) flags.vaultLooking.push({ id, collector, sheet: sheetStatus });
    if (collector && !isAddress(collector) && !inVault && collector !== work.collector?.ens) {
      entry.collector_display_name = collector;
      tally.named++;
    }

    // ---- what is actually on offer, decided here rather than on the page ----
    const status = entry.status || resolvedStatus || chainStatus;
    const isEdition = work.edition && work.edition.type === 'edition';
    const artistHeld = Number(work.edition?.artist_held || 0);
    // an edition can go on selling after the 1/1 painting has gone
    const digitalStillSellable = status === 'available' || (isEdition && artistHeld > 0);
    const paintingSellable = physical.exists !== false && !physical.sold && status === 'available';

    entry.offers = {
      digital: Boolean(priced.digital && digitalStillSellable),
      painting: Boolean(priced.painting && paintingSellable),
      both: Boolean(priced.both && paintingSellable && digitalStillSellable),
    };

    const eth = num(r[C.listedEth]);
    if (eth != null && eth > 0) entry.listing = { eth, platform: str(r[C.listedOn]) };
    if (notes) entry.notes = notes;

    if (status === 'available' && !entry.offers.digital && !entry.offers.painting && !entry.offers.both) {
      flags.unpriced.push({ id, sheet, status });
    }

    overlay.works[id] = entry;
  }
}

fs.writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');

// apply now, the same merge the builder does on a rebuild
let touched = 0;
for (const c of cat.collections) {
  for (const w of c.works || []) {
    const e = overlay.works[w.id];
    if (!e) continue;
    touched++;
    if (e.pricing_nzd) w.pricing_nzd = { ...(w.pricing_nzd || {}), ...e.pricing_nzd };
    if (e.painting_included) w.painting_included = true;
    if (e.physical) w.physical = { ...(w.physical || {}), ...e.physical };
    if (e.offers) w.offers = e.offers;
    if (e.listing) w.listing = e.listing;
    if (e.notes) w.hand_notes = e.notes;
    if (e.status) { if (w.status_chain == null) w.status_chain = w.status; w.status = e.status; }
    if (e.collector_display_name) {
      w.collector = { ...(w.collector || { address: null, ens: null, note: null, acquired: null }), display_name: e.collector_display_name };
    }
  }
}
fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 2));
execFileSync('node', [ROOT + 'scripts/catalog/30-split.mjs'], { stdio: 'inherit' });

// ---- the report ----
const L = [];
L.push('# Import report');
L.push('');
L.push(`From \`${overlay.source}\`, read ${new Date(overlay.imported).toLocaleString('en-NZ')}.`);
L.push('');
L.push(`${tally.rows} rows, ${tally.priced} priced, ${tally.dimensioned} with dimensions, ${tally.named} collector names, ${tally.sold} paintings already with a collector, ${tally.statusOverridden} statuses taken from the sheet over the chain, ${tally.paintingIncluded} where the painting comes with the digital work.`);
L.push('');
L.push('Nothing here was guessed at. The settled section records rules you have confirmed and how they were applied. Anything still open is listed at the end.');
L.push('');

const section = (title, rows, note) => {
  L.push(`## ${title}`);
  L.push('');
  if (!rows.length) { L.push('Nothing to report.'); L.push(''); return; }
  if (note) { L.push(note); L.push(''); }
  L.push(...rows);
  L.push('');
};

L.push('## Settled');
L.push('');

section('Available but nothing on offer',
  flags.unpriced.map((f) => `- \`${f.id}\` (${f.sheet})`),
  'Confirmed: these show "Enquire about this artwork" rather than an Acquire button.');

section('Status taken from the sheet, against the chain',
  flags.statusDiffers.map((f) => `- \`${f.id}\` ... sheet says **${f.sheet}**${f.collector ? ` (${f.collector})` : ''}, chain says ${f.chain}${f.resolved !== f.sheet ? `, applied as **${f.resolved}**` : ''}.`),
  'The painting can change hands without the token moving, which is why these differ. The sheet wins.');

section('Prices of zero',
  flags.zeroPrice.map((f) => `- \`${f.id}\` ... ${f.field} is 0 (digital ${f.digital}, painting ${f.painting}, both ${f.both}). Treated as no price rather than free.`),
  'A painting priced at zero is read as coming with the digital work at no extra cost, which is settled. Anything else priced at zero is treated as no price rather than free, and listed here.');

section('Marked no physical, painting price dropped',
  flags.noPhysicalButPriced.map((f) => `- \`${f.id}\` ... note says "${f.notes}", so the painting price of ${f.painting} and both price of ${f.both} were dropped. The token is all there is to sell.`),
  'Confirmed: the note wins over the price columns.');

section('Collector is the vault, read as vaulted',
  flags.vaultLooking.map((f) => `- \`${f.id}\` ... collector is ${f.collector} and the sheet said ${f.sheet}, so it is recorded as vaulted.`),
  'Confirmed: a work whose collector is mintestate.eth is vaulted, not sold.');

L.push('## Still open');
L.push('');
if (!flags.zeroPrice.length && !flags.unknown.length) { L.push('Nothing. Every question from the last import has an answer.'); L.push(''); }

if (flags.unknown.length) section('Ids not in the catalog', flags.unknown.map((i) => `- \`${i}\``));

fs.writeFileSync(REPORT, L.join('\n'));

console.log('\n── imported');
console.log('   rows              ', tally.rows);
console.log('   priced            ', tally.priced);
console.log('   dimensions        ', tally.dimensioned);
console.log('   collector names   ', tally.named);
console.log('   paintings sold    ', tally.sold);
console.log('   status overridden ', tally.statusOverridden);
console.log('\n── flagged, see docs/IMPORT-REPORT.md');
console.log('   available, nothing on offer ', flags.unpriced.length);
console.log('   status against the chain    ', flags.statusDiffers.length);
console.log('   zero prices                 ', flags.zeroPrice.length);
console.log('   no physical but priced      ', flags.noPhysicalButPriced.length);
console.log('   collector is the vault      ', flags.vaultLooking.length);
