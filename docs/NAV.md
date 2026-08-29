# NAV — one bar, both deploys

A persistent bar at the top of every page of mintface.art and collectors.mintface.art. The mark, two places to go, and then who you are and what waited for you.

## The brief (2026-08-29)
1. Left to right: the MintFace logo (home), COLLECTIONS, COLLECTORS. Right-aligned: the 🍒 and the signed-in collector's display name, linking to their own collector page. Signed out, a quiet CONNECT in the name's place.
2. Mono small caps throughout, hairline bottom rule, warm-white ground.
3. Sticky, always present, weightless: slim, no shadow, no background change. A rule with words on it, not a toolbar.
4. On mobile the labels tighten and nothing hides behind a hamburger. Four items fit.
5. One component, both deployments, from the shared design tokens. The session means your name follows you between the sites once the cross-domain cookie fix lands.
6. The cherry goes global: it was scoped to the room's header and now lives in the nav everywhere, deep-linking into /chat at the mention.
7. The existing top-right links retire into it. One nav, no duplicates. The footer stays as it is.
8. Check it against the work-page hero and the lightbox: it should never sit over art, and the lightbox suppresses it.

---

## As built (2026-08-29)

**One component means one file, not one design.** The bar is `MF.nav` in `mintface.js` and `.nav` in `mintface.css`. Both sites already load both files — the register has pulled its stylesheet from `https://mintface.art/mintface.css` since it opened — so a page carries `<header class="nav" id="nav"></header>` and nothing else, and changing the bar is one edit that reaches twenty pages across two deploys. Copying six lines of markup into twenty files would have been the same design and not the same component: the twentieth copy is the one that drifts.

**It works out which deploy it is on.** `MF.ART` and `MF.PEOPLE` are absolute or empty depending on the hostname, so on the catalogue the catalogue links are relative and on the register they are absolute — which means a preview deploy links to itself rather than quietly sending a reviewer to production.

**Mono, not the sans.** `.smallcaps` is the sans and it is what the old bar used. A nav is a set of labels rather than a sentence, so it takes the measuring voice, which is also what the cherry's count needs to sit in.

**Sticky, and never over art.** Everywhere else what scrolls under the bar is words and thumbnails and the bar is opaque paper, so it costs nothing. The work page is different: the work is the first thing on it, full width and up to 88vh, and a paper bar shaving the top off a painting as it goes past is the one thing this bar may not do. Sliding it away would be motion; letting it come back would be a reveal-on-scroll, which is the opposite of always present. So the work page says `<body data-nav="flow">` and the bar scrolls with the page there — present at the top of the work the way it always was, and back the moment you return to it. It is the only page that says so, and there is a check that it stays the only one.

**This is the one place the brief and the build disagree, deliberately.** On a work page the cherry is not on screen while you are reading below the fold. The alternative was a bar clipping the art, and item 8 settles which of those is worse.

**The lightbox suppresses it.** `MF.zoom` puts `zooming` on the body, and the bar goes to nothing without moving — held in place rather than removed, so the page underneath does not reflow while it is covered. Stacking would have hidden it anyway; saying it outright is what stops that being true only by accident.

**The cherry is the same cherry.** Same dormant grey, same colour-arriving-is-the-event, same click behaviour. From anywhere but the room it deep-links to `/chat#m-<n>` and the room opens at that message instead of at the latest. In the room it takes the press directly and scrolls, because reloading the page you are already on to reach a message on it is absurd.

**A nav does not cost a page of the log.** `GET /api/chat?me=1&viewer=…` answers the name, the collector page and the mention count with no messages in it — the same `standing()` the room draws its own page from, so the number in the corner and the number in the room can never disagree. Signed out, the nav asks nothing at all: there is nothing to draw but CONNECT.

**CONNECT is the room's own sign-in.** Connect, then one signature for thirty days, with the button saying where it has got to — Connecting, Check your wallet, Signing in. Two wallets answering at once hands off to `/chat`, where the picker and the wallet report already live: the happy path belongs in the bar and the apparatus belongs in one place.

**Still per-origin, and the seam is one line.** The token is in this browser's storage for this hostname, so signing in on the catalogue does not yet sign you in on the register. When the cross-domain cookie lands it lands in `MF.session` and nothing else changes.

**What retired.** COLLECTIONS on the catalogue, ALL COLLECTIONS and THE REGISTER on collectors, and the work page's header breadcrumb — that last one because the byline under the title already links the collection, one line lower and better placed. The footers are untouched.

**What is outside it.** `onchain-studio.html`, `onramp.html` and `projects.html` are landing pages with their own fonts and their own chrome and have never loaded `mintface.css`. Putting this bar on them would mean bringing them into the design system, which is a larger decision than a nav. The check names them out loud rather than skipping them quietly, so the day one of them joins, it joins.

**Checks.** `scripts/nav/test-nav.mjs`, thirty-eight cases over both checkouts at once — because what goes wrong with a bar every page carries is that one page stops carrying it, and that is invisible from any single page. Every page mounts it and mounts it once, nothing is left of the bar it replaced, every page loads the file it is in, no page keeps the link it retired, the work page is the only one out of the sticky, the lightbox suppresses it at both ends, no width hides anything, the register keeps no styles of its own for it, and the room no longer holds a second copy of the session or of the sentence a wallet signs. Where the register checkout is not beside this one, it says its pages are unchecked rather than saying they are fine.

---

## One sign-in, two hosts (2026-08-29)

Signing in on the catalogue now signs you in on the register, and the other way about.

**There is no shared secret, and there is nothing for Ryan to mirror.** The brief asked for a `SESSION_SECRET` in both Vercel projects on the reasoning that the register could not decode the catalogue's session. It never had to. `collectors.mintface.art` is a static deploy with no functions of its own — every call it makes, for names, notes and the room, goes to `https://mintface.art/api/…`. So there is exactly one thing that mints sessions and one thing that validates them, and the token is an opaque random string looked up in Upstash rather than a signed blob anything decodes. A second validator would need a shared key; there is no second validator. **No new environment variable.**

**What was actually broken was the browser, not the server.** The token sat in `localStorage`, which is per-origin, so the register's pages could not see the catalogue's session even though they were talking to the catalogue's API. The fix is the cookie the brief asked for: `Domain=.mintface.art`, `Path=/`, `Secure`, `SameSite=Lax`, `HttpOnly`. The two hosts are one registrable domain, so Lax carries it and nothing here is a third-party cookie — exactly as specced, and no `SameSite=None` acrobatics.

**Two cookies, and only one of them is a credential.** `mf_room` is the token and is `HttpOnly`, so no script on either site can read it again — a straight improvement on the localStorage it replaces, where any script on the page could lift a month of somebody's session. But a nav that could not tell a signed-in reader from a signed-out one without asking would have to ask on every page, for everybody, including the many readers who have never signed in. So `mf_who` carries the two public facts the bar needs to draw itself — which wallet, and until when — and nothing else.

**A preview deploy keeps its session to itself.** `art-abc123.vercel.app` is a different registrable domain, so the cookie is set on the host with no `Domain` at all. A preview cannot set a cookie for production, and production's session does not follow a reader into a preview. Both are the right way round.

**Credentials and a wildcard are not allowed together, so the room answers twice.** The API has always replied `Access-Control-Allow-Origin: *`, and reading it has always been open to anything that asks. That is kept. What is added is that a request from either of the two hosts gets its own origin echoed plus `Allow-Credentials: true`, with `Vary: Origin` so no cache hands one reader the other's answer.

**The domain binding was added, not fixed.** The brief's item (c) assumed the signed sentence already carried a domain and that verification would reject the other host. It carried none, so nothing was failing for that reason and the session would have crossed without it. It is worth having anyway and it is there now: a sign-in reads `Domain: mintface.art` (or `collectors.mintface.art`) above the wallet line, and the server accepts the two hosts of the family plus whatever host is answering the request — the last of which is what lets a preview deploy sign into itself, and what lets the acceptance cases run on the loopback. What it buys is not the cross-host session; it is that a signature collected on some other site cannot be spent here. It is on the sign-in alone: every other action carries what it authorises in its own words and is spent at once, and a domain line on all of them would be four more lines in four more wallets for nothing.

**Who is reading, answered from the session.** `GET /api/chat` used to need `?viewer=0x…` from the page. It still takes it — the room passes it because it already knows — but a page that arrives with a cookie and nothing else is now answered from the cookie. That is the nav on the register, and it is the point of the session being a cookie rather than a string in one origin's storage.

**Everyone signs in once more.** A session held in `localStorage` cannot be moved to a cookie without a signature, so the runtime drops it rather than half-honouring it: the next page shows CONNECT, one signature, and from then on it follows you across both sites. Anyone holding a page cached from before this deploy will be told *that signature was not signed for this site* until they reload, because their copy of the sentence has no `Domain:` line in it. A reload fixes it.

**Acceptance.** Sign in on mintface.art, load collectors.mintface.art fresh: name in the nav, no second prompt. And the reverse. Checked end to end against production with a throwaway key in `scripts/nav/check-sso.mjs`, which signs the real sentence, takes the real cookies, and spends them from the register's origin.

## STUDIO in the nav (2026-08-29)

`LOGO · COLLECTIONS · COLLECTORS · STUDIO · 🍒 · NAME`, and it points at `/chat`.

**Settled 2026-08-29: STUDIO points at `/studio`, and `/studio` is now the room and the nudges together.** The collision below was real and is closed. `/chat` is a permanent redirect. What follows is the note as it was written, and it is what the merge acted on.

**The naming collision is live, not pending.** The brief allowed for nudges not being built yet. They are: `/studio` is the Artist Virtual Studio, titled that, publicly reachable, and it is where collectors weigh their TAO behind a yes or a no. So the site has a STUDIO in the nav going to `/chat` and an Artist Virtual Studio at `/studio`, and that is a real collision sitting in the open rather than a future one. **For Ryan to settle, not me.** The end-state the brief suggests — one studio surface with the room and the nudges on it — looks right from here: they are the same idea (TAO gets a voice) wearing two URLs, and the room is the livelier half. That is a page to design, not a rewrite: `/studio` grows the room into it, `/chat` keeps working, and the nav item stops being a small lie.

**Absolute, in the way the rest of the bar is absolute.** The brief said hard-code `https://mintface.art/chat`. It is `${MF.ART}/chat`, which *is* that string on the register and stays relative on the catalogue — identical behaviour from collectors, and a preview deploy links to its own room rather than jumping a reviewer to production. Same rule COLLECTIONS already follows.

**Five items still fit.** Measured in a real viewport at 320, 360, 390, 430 and 768: nothing overflows and nothing is hidden at any width. The name is the item that gives — at 320 it reads `VISC…` — which is the right one to squeeze, because everything else in the bar is a fixed label and the name has a page of its own one tap away.
