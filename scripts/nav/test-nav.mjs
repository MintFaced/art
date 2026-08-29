#!/usr/bin/env node
/* The nav, checked as the thing it claims to be: one component, both deploys.
 *
 * There is no route here and no store. What can go wrong with a bar that every
 * page carries is that a page stops carrying it, or carries a second one, or
 * keeps the link the bar retired ... and none of that is visible from any one
 * page. So this reads all of them at once.
 *
 *   node scripts/nav/test-nav.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/* The register is a sibling checkout rather than part of this one. Where it is
   not here ... a CI box with one repo ... its pages are said to be unchecked
   rather than quietly said to be fine. */
const PEOPLE = path.resolve(ART, '../collectors');
const havePeople = fs.existsSync(path.join(PEOPLE, 'index.html'));

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const pagesIn = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.html'))
  .map((f) => ({ name: f, dir, text: fs.readFileSync(path.join(dir, f), 'utf8') }));

/* What counts as a page of the site, checkably: one that draws on the shared
   stylesheet. Three landing pages ... On-Chain Studio, Onramp, Projects ...
   have their own fonts and their own chrome and are not in the design system
   at all, so putting this nav on them would mean bringing them into it. They
   are named below rather than quietly skipped. */
const inSystem = (p) => /mintface\.css/.test(p.text);
const artPages = pagesIn(ART).filter(inSystem);
const outsiders = pagesIn(ART).filter((p) => !inSystem(p));
const peoplePages = havePeople ? pagesIn(PEOPLE).filter(inSystem) : [];
const all = [...artPages, ...peoplePages];
const css = fs.readFileSync(path.join(ART, 'mintface.css'), 'utf8');
const runtime = fs.readFileSync(path.join(ART, 'mintface.js'), 'utf8');

head('Every page carries it, and carries it once');
{
  const without = all.filter((p) => !p.text.includes('<header class="nav" id="nav"></header>'));
  ok(!without.length, `all ${all.length} pages mount the nav`,
    without.map((p) => p.name).join(', '));

  const twice = all.filter((p) => p.text.split('class="nav" id="nav"').length > 2);
  ok(!twice.length, 'and none of them mounts it twice', twice.map((p) => p.name).join(', '));

  const old = all.filter((p) => p.text.includes('<header class="bar">'));
  ok(!old.length, 'and nothing is left of the bar it replaced', old.map((p) => p.name).join(', '));

  const noRuntime = all.filter((p) => !/mintface\.js/.test(p.text));
  ok(!noRuntime.length, 'and every one of them loads the file the nav is in',
    noRuntime.map((p) => p.name).join(', '));

  ok(havePeople && peoplePages.length >= 3,
    havePeople ? `the register's ${peoplePages.length} pages are in this too`
      : 'the register checkout is not here, so its pages are unchecked');

  /* Said out loud, so a page that quietly falls out of the design system is a
     line in this output rather than a page nobody notices has no nav. */
  ok(outsiders.every((p) => !/mintface\.css/.test(p.text)),
    `outside the design system, and so outside this: ${outsiders.map((p) => p.name).join(', ') || 'nothing'}`);
}

head('One nav, and therefore no duplicates of it');
{
  /* The links the bar used to carry on the right have retired into it. A page
     still carrying one is two navigations disagreeing about where you are. */
  const dupes = all.filter((p) => /<a class="smallcaps"[^>]*>\s*(All collections|Collections|All collectors|The register)\s*<\/a>/i.test(
    p.text.split('<footer')[0]));
  ok(!dupes.length, 'no page keeps the top-right link the nav retired',
    dupes.map((p) => p.name).join(', '));

  const work = artPages.find((p) => p.name === 'w.html');
  ok(work && !/getElementById\('up'\)/.test(work.text),
    'the work page drops its header breadcrumb, which the byline under the title already says');
  ok(work && /<a href="\/c\/\$\{e\(collection\.slug\)\}">/.test(work.text),
    'and the byline still links the collection, which is the way back it retired into');

  /* The footer was never part of this and stays as it was. */
  const feet = all.filter((p) => /<footer class="foot">/.test(p.text)).length;
  ok(feet >= 12, 'the footer stays as it is', `${feet} pages`);
}

head('It is a rule with words on it');
{
  ok(/\.nav\{[^}]*position:sticky/.test(css), 'sticky, so it is always present');
  ok(/\.nav\{[^}]*border-bottom:1px solid var\(--rule\)/.test(css), 'a hairline under it');
  ok(/\.nav\{[^}]*background:var\(--paper\)/.test(css), 'on the warm white the page is already on');
  ok(!/\.nav\{[^}]*box-shadow/.test(css), 'and no shadow: it has no weight to cast one');
  ok(/\.nav\{[^}]*height:52px/.test(css), 'slim', (css.match(/\.nav\{[^}]*height:(\d+)px/) || [])[1] + 'px');
  ok(/\.nav a,\.nav button\{[^}]*var\(--font-mono\)[^}]*text-transform:uppercase/.test(css),
    'mono small caps throughout');
}

head('It never sits over art');
{
  ok(/body\.zooming \.nav\{opacity:0;pointer-events:none\}/.test(css),
    'the lightbox suppresses it, because in there the work is the whole screen');
  ok(/document\.body\.classList\.add\('zooming'\)/.test(runtime)
    && /document\.body\.classList\.remove\('zooming'\)/.test(runtime),
    'and the lightbox is what says so, opening and closing');

  ok(/body\[data-nav="flow"\] \.nav\{position:static\}/.test(css),
    'a page whose first thing is a work keeps the bar in the flow');
  const work = artPages.find((p) => p.name === 'w.html');
  ok(work && /<body data-nav="flow">/.test(work.text),
    'and the work page is that page, because a paper bar shaving the top off a painting is the one thing this bar may not do');
  const sticky = artPages.filter((p) => /<body data-nav="flow">/.test(p.text));
  ok(sticky.length === 1, 'and it is the only one, so everywhere else the bar is always there',
    sticky.map((p) => p.name).join(', '));
}

head('Nothing hides behind a hamburger');
{
  ok(!/data-nav="(menu|burger)"|aria-expanded/.test(runtime) && !/\.nav[^{]*\{[^}]*display:none/.test(css),
    'there is no menu to open, and nothing in the bar is hidden at any width');
  const tiers = (css.match(/@media\(max-width:(\d+)px\)\{\s*\.nav\{/g) || []).length;
  ok(tiers >= 2, 'the labels tighten instead, in more than one step', `${tiers} tiers`);
  ok(/\.nav \.you\{[^}]*text-overflow:ellipsis/.test(css),
    'and the one item nobody here chose the width of is the one that gives');
}

head('One component, both deploys');
{
  ok(/MF\.ART = AT_PEOPLE \? 'https:\/\/mintface\.art' : ''/.test(runtime),
    'the nav works out which deploy it is on rather than being told twice');
  ok(/MF\.PEOPLE = AT_PEOPLE \? '' : 'https:\/\/collectors\.mintface\.art'/.test(runtime),
    'so a preview of the catalogue links to itself and not to production');
  if (havePeople) {
    const theirs = peoplePages.filter((p) => /mintface\.art\/mintface\.js/.test(p.text));
    ok(theirs.length === peoplePages.length,
      'and the register draws it from the catalogue rather than keeping a copy',
      `${theirs.length} of ${peoplePages.length}`);
    const ownNav = peoplePages.filter((p) => /\.nav\s*\{/.test(p.text));
    ok(!ownNav.length, 'with none of its own styles for it', ownNav.map((p) => p.name).join(', '));
  }
}

head('Four places to go, and Studio is one of them');
{
  ok(/>Collections<\/a>/.test(runtime) && /Collectors<\/a>/.test(runtime) && /Studio<\/a>/.test(runtime),
    'the bar carries Collections, Collectors and Studio');
  ok(/\$\{MF\.ART\}\/studio"\$\{on\('\/studio'\)\}>Studio/.test(runtime),
    'Studio points at the studio, absolute from the register and relative on the catalogue itself');
  const order = runtime.slice(runtime.indexOf('class="wordmark"'), runtime.indexOf('class="right"'));
  ok(order.indexOf('Collections') < order.indexOf('Collectors')
    && order.indexOf('Collectors') < order.indexOf('Studio'),
    'in that order, and all of them left of the cherry');
}

head('One studio surface');
{
  const studio = fs.readFileSync(path.join(ART, 'studio.html'), 'utf8');
  ok(!fs.existsSync(path.join(ART, 'chat.html')),
    'the room and the nudges are one page, not two');
  const vercel = JSON.parse(fs.readFileSync(path.join(ART, 'vercel.json'), 'utf8'));
  ok((vercel.redirects || []).some((r) => r.source === '/chat' && r.destination === '/studio' && r.permanent),
    'and /chat is a permanent redirect into it, so every link ever made still lands');

  ok(/id="banked"/.test(studio) && /id="open"/.test(studio) && /id="log"/.test(studio) && /id="speak"/.test(studio),
    'four containers, one owner each');
  const order = ['id="banked"', 'id="log"', 'id="open"', 'id="speak"'].map((k) => studio.indexOf(k));
  ok(order.every((x, i) => i === 0 || x > order[i - 1]),
    'the record above the room, the open question at the foot of it, and the composer under that',
    order.join(' < '));
  ok(/getElementById\('log'\)\.innerHTML/.test(studio) && /getElementById\('speak'\)\.innerHTML/.test(studio)
    && !/getElementById\('main'\)\.innerHTML/.test(studio),
    'the room redraws its own two and never the nudges, which hold a half-typed number');

  ok(/MF\.session\.current\(\)/.test(studio.slice(studio.indexOf('async function loadNudges'))),
    'weighing takes the wallet the room already knows rather than asking for one of its own');
  ok(!/id="connect"/.test(studio), 'so there is one connect on this page, not two');
  ok(/A nudge steers\. It never commands\./.test(studio), 'and the standing rule came across with it');

  const pages = [...artPages, ...peoplePages];
  const stale = pages.filter((p) => /href="\/chat"|mintface\.art\/chat"/.test(p.text));
  ok(!stale.length, 'and nothing still links to where it used to be', stale.map((p) => p.name).join(', '));
}

head('The cherry went global');
{
  ok(/\.cherry\{/.test(css) && !/\.cherry\{/.test(fs.readFileSync(path.join(ART, 'studio.html'), 'utf8')),
    'it is drawn from the shared stylesheet now, not from the room');
  ok(/data-nav="cherry"/.test(runtime), 'and the nav is what draws it');
  ok(/\$\{MF\.ART\}\/studio#m-\$\{n\}/.test(runtime),
    'pressing it from anywhere else on the site deep-links into the room at the mention');
  const chat = fs.readFileSync(path.join(ART, 'studio.html'), 'utf8');
  ok(/MF\.nav\.onCherry = /.test(chat),
    'and in the room it takes it over, because scrolling beats reloading the page you are on');
  ok(/location\.hash\.match\(\/\^#m-\(\\d\+\)\$\/\)/.test(chat),
    'the room reads the deep link and opens at that message rather than at the latest');
  ok(/MF\.nav\.mentions\(/.test(chat),
    'and hands the count to the nav as the poll changes it');
}

head('One session, one sentence');
{
  ok(/MF\.session = \{/.test(runtime), 'the session is in the shared runtime, where the nav can sign in with it');
  const chat = fs.readFileSync(path.join(ART, 'studio.html'), 'utf8');
  ok(!/localStorage\.getItem\('mintface\.room\.session'\)/.test(chat) && !/const KEEP = /.test(chat),
    'and the room no longer keeps its own copy of it');
  ok(/MF\.session\.sentence/.test(chat), 'nor its own copy of the sentence a wallet signs');
  ok(/const signedIn = MF\.session\.current\(\);/.test(chat),
    'a session says who you are, so the room knows before a wallet is asked anything');
}

head('One sign-in, and the browser never touches the token');
{
  ok(!/localStorage/.test(runtime.slice(runtime.indexOf('MF.session = {'), runtime.indexOf('MF.nav = {')))
    || /OLD_KEY/.test(runtime),
    'the session is a cookie now, and localStorage appears only to be cleared out');
  ok(/credentials: 'include'/.test(runtime),
    'requests to the room carry it, which on the register is cross-origin and not cross-site');
  const chat = fs.readFileSync(path.join(ART, 'studio.html'), 'utf8');
  ok(!/token: s\.token/.test(chat) && !/j\.token/.test(chat),
    'and nothing in the room handles a token any more', 'studio.html');
  ok(/domain: location\.hostname|const domain = location\.hostname/.test(runtime),
    'a sign-in names the site it was asked on');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
