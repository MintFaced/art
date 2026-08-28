#!/usr/bin/env node
/* The text layer, and the guard in front of the previews.
 *
 * Rules only, so all of it runs in memory: no store, no origin, and no request
 * ever leaving. The one thing that would leave ... the preview fetch ... is
 * given a fetch of the test's own, which is the honest way to check redirect
 * handling without loosening the checks that make it safe.
 *
 *   node scripts/chat/test-text.mjs
 */
import { renderProse, linksIn, safeHref, shownUrl, escape } from '../../api/_lib/text.js';
import { mayFetch, readCard, fetchCard, familyKind } from '../../api/_lib/cards.js';

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const tag = (start, len, name, url) => ({ start, len, name, url });

/* ================= links ================= */
head('A pasted URL is a link');
{
  const html = renderProse('the thread is at https://x.com/mintface/status/1934 if you missed it');
  ok(html.includes('<a class="lnk" href="https://x.com/mintface/status/1934"'),
    'a bare URL renders as one, without anybody having written any markup', html);
  ok(html.includes('target="_blank"') && html.includes('rel="nofollow ugc noopener noreferrer"'),
    'somebody else\'s site opens beside the room, and carries nothing away with it');

  const home = renderProse('see https://mintface.art/w/10k-project');
  ok(home.includes('href="https://mintface.art/w/10k-project"') && !home.includes('target='),
    'and one of ours opens in this tab, like any other page of the site', home);

  ok(renderProse('see https://mintface.art/chat.').includes('>mintface.art/chat</a>.'),
    'a full stop after a link is a full stop, not part of the address');
  ok(renderProse('(https://mintface.art/chat)').includes('>mintface.art/chat</a>)'),
    'and a bracket the URL did not open belongs to the sentence');
  ok(renderProse('https://en.wikipedia.org/wiki/Nabis_(art)').includes('/wiki/Nabis_(art)</a>'),
    'while one it did open is part of the address');

  const long = `https://example.com/${'a'.repeat(90)}`;
  const shown = shownUrl(long);
  ok(shown.length === 60 && shown.endsWith('…') && shown.startsWith('example.com/'),
    'a long one is worn short, domain first', shown);
  ok(renderProse(long).includes(`href="${long}"`), 'and still goes where it says');

  ok(renderProse('www.mintface.art/notes').includes('href="https://www.mintface.art/notes"'),
    'a URL without its scheme is still a URL');
  ok(!renderProse('write to ryan@mintface.art').includes('<a'),
    'an email address is not one');
  ok(safeHref('javascript:alert(1)') === null && safeHref('data:text/html,x') === null
    && safeHref('https://user:pw@x.com/') === null,
    'and nothing but http and https ever becomes an href');
}

/* ================= markdown ================= */
head('A very small markdown');
{
  ok(renderProse('**this** matters').startsWith('<strong>this</strong>'), 'bold');
  ok(renderProse('*this* matters').startsWith('<em>this</em>'), 'italic');
  const linked = renderProse('read [the notes](https://mintface.art/notes) first');
  ok(linked.includes('<a class="lnk" href="https://mintface.art/notes">the notes</a>'),
    'a link with words on it', linked);

  ok(renderProse('# not a heading') === '# not a heading', 'no headings');
  ok(renderProse('![art](https://evil.example/x.png)').includes('!<a class="lnk"'),
    'no images ... the URL is a link and the bang is a bang');
  ok(renderProse('`code`') === '`code`', 'no code');
  ok(renderProse('> quoted') === '&gt; quoted', 'no quotes, and the character is escaped');

  ok(renderProse('**unclosed and 2*3') === '**unclosed and 2*3',
    'markdown that does not come off is the characters that were typed');
  ok(renderProse('[nowhere](javascript:alert(1))') === '[nowhere](javascript:alert(1))',
    'and a link to nowhere is text, never a broken tag', renderProse('[nowhere](javascript:alert(1))'));
  ok(renderProse('a \\*b\\* c') === 'a *b* c', 'an escaped asterisk is an asterisk');

  const both = renderProse('**a [link](https://x.com/y) inside**');
  ok(both.includes('<strong>a <a class="lnk"') && both.endsWith(' inside</strong>'),
    'one thing may sit inside another, once', both);
}

/* ================= the log is permanent ================= */
head('Nothing a collector types is ever markup');
{
  const attempts = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[x](https://x.com/" onmouseover="alert(1))',
    '**<b>bold</b>**',
    "<a href='#'>click</a>",
    '<iframe src="https://evil.example"></iframe>',
  ];
  for (const bad of attempts) {
    const html = renderProse(bad);
    const tags = (html.match(/<[a-z]+[^>]*>/gi) || [])
      .filter((t) => !/^<(a class="lnk"|a class="tag"|span class="tag"|strong|em)[ >]/.test(t));
    ok(tags.length === 0, `${bad.slice(0, 34)} renders as text`, tags.join(' '));
  }
  ok(renderProse('<script>alert(1)</script>').startsWith('&lt;script&gt;'),
    'the angle brackets are shown, which is what makes it readable rather than gone');
}

/* ================= names still outrank ================= */
head('A name is not markup');
{
  const text = 'morning @visco.eth and **@visco.eth**';
  const tags = [tag(8, 10, 'visco.eth', 'https://collectors.mintface.art/visco.eth'),
    tag(25, 10, 'visco.eth', 'https://collectors.mintface.art/visco.eth')];
  const html = renderProse(text, tags);
  ok((html.match(/class="tag"/g) || []).length === 2, 'both tags survive the pass', html);
  ok(html.includes('<strong><a class="tag"'), 'and one of them is inside bold');

  /* A tag's own characters are never read as markup: a collector called
     *starlight* would otherwise italicise the sentence around them. */
  const odd = renderProse('hi @a*b*c there', [tag(3, 6, 'a*b*c', null)]);
  ok(odd === 'hi <span class="tag">@a*b*c</span> there', 'a name carrying markup is still a name', odd);
}

/* ================= what gets fetched ================= */
head('The links a message points at');
{
  ok(JSON.stringify(linksIn('a https://x.com/a. b [w](https://mintface.art/w/1) c'))
    === JSON.stringify(['https://x.com/a', 'https://mintface.art/w/1']),
    'read off the text, in the order they were written');
  ok(linksIn('**[hidden](https://x.com/y)**').length === 1, 'including one wrapped in bold');
  ok(linksIn('a https://a.com/1 b https://b.com/2 c https://c.com/3 d https://d.com/4').length === 3,
    'three at most ... a message is not a link farm');
  ok(linksIn('same https://x.com/a twice https://x.com/a').length === 1, 'and the same link once');
}

head('The room is not an SSRF tool');
{
  const refused = [
    'http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://metadata.google.internal/',
    'https://x.com:8080/', 'file:///etc/passwd', 'gopher://x.com/', 'https://user:pw@x.com/',
    'http://kubernetes.default.svc.cluster.local/',
  ];
  for (const u of refused) ok(mayFetch(u) === false, `refused: ${u}`);
  ok(mayFetch('https://x.com/mintface/status/1934') === true, 'and a plain public URL is fetched');
}

head('Following a redirect is deciding again');
{
  const page = (html) => ({
    status: 200, ok: true,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => html,
  });
  const moved = (to) => ({ status: 302, ok: false, headers: new Headers({ location: to }) });

  const seen = [];
  const hop = async (url) => {
    seen.push(url);
    if (url === 'https://t.co/abc') return moved('https://x.com/mintface/status/1934');
    return page('<head><title>MintFace on X</title><meta property="og:title" content="A thread about Geodetica"><meta property="og:description" content="Nine works, one road."></head>');
  };
  const card = await fetchCard('https://t.co/abc', { get: hop });
  ok(card && card.title === 'A thread about Geodetica' && card.domain === 'x.com',
    'a shortener is followed to what it stands for', JSON.stringify(card));
  ok(card.description === 'Nine works, one road.', 'and the description comes with it');

  const trap = [];
  const bad = async (url) => {
    trap.push(url);
    return moved('http://169.254.169.254/latest/meta-data/');
  };
  const none = await fetchCard('https://x.com/looks-fine', { get: bad });
  ok(none === null && trap.length === 1,
    'a hop into a private address is not taken, and is not asked about twice', trap.join(' '));

  const notHtml = await fetchCard('https://x.com/a.pdf', {
    get: async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/pdf' }), text: async () => '%PDF' }),
  });
  ok(notHtml === null, 'and a page that is not a page has nothing to read');

  const dead = await fetchCard('https://x.com/gone', { get: async () => { throw new Error('timeout'); } });
  ok(dead === null, 'a fetch that fails degrades to nothing, silently');
}

head('Reading a page');
{
  const c = readCard('<head><title>Fallback</title><meta name="twitter:title" content="Twitter first"></head>', 'https://www.example.com/a');
  ok(c.title === 'Twitter first' && c.domain === 'example.com',
    'what a site says about itself outranks its tab title', JSON.stringify(c));
  ok(readCard('<head><title>Ampersands &amp; entities &#39;n things</title></head>', 'https://example.com/')
    .title === "Ampersands & entities 'n things", 'entities are read back into characters');
  ok(readCard('<html><body>nothing</body></html>', 'https://example.com/') === null,
    'a page with nothing to say gets no card');
  const long = readCard(`<head><meta property="og:title" content="${'x'.repeat(400)}"></head>`, 'https://example.com/');
  ok(long.title.length === 120, 'and a title is a title, not an essay', String(long.title.length));
  ok(escape('<&">\'') === '&lt;&amp;&quot;&gt;&#39;', 'everything that can close a tag or an attribute is escaped');
}

head('The family discount');
{
  ok(JSON.stringify(familyKind('https://mintface.art/w/10k-project')) === '{"kind":"work","id":"10k-project"}',
    'a work URL is a work');
  ok(JSON.stringify(familyKind('https://collectors.mintface.art/visco.eth')) === '{"kind":"collector","slug":"visco.eth"}',
    'a collector URL is a collector');
  ok(familyKind('https://mintface.art/c/genesis').kind === 'collection', 'a collection URL is a collection');
  ok(familyKind('https://x.com/a') === null, 'and everybody else is fetched like everybody else');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
