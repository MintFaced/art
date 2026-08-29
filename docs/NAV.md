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
