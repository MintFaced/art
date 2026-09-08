# AVS — Artist Virtual Studio: nudges

TAO gets a voice. Collectors weigh their TAO behind a Yes or a No on studio questions... a nudge, not a vote. TAO is **weighed and kept, never spent**. The artist steers; the collectors nudge.

## Framing (page copy, Ryan's own lines... edit lightly)
"While some build at nation-state size... huge scale, complex coordination... there is also a need for smaller experiments, shorter runways, faster iteration. The Artist Virtual Studio is smol scale, needing simple coordination: a yes or a no, built on MintFace art tokens. Co-creation between the artist and collectoors... and eventually beyond."
Plus the standing rule, on every nudge: "A nudge steers. It never commands. The studio may act with, against, or without the result."

## Mechanics
1. **A nudge** is artist-authored, binary (YES / NO), one question, optional image, a close date. Lives at **/studio** as cards... open nudges first, closed banked below.
2. **Weighing**: a signed-in collector picks a side and an amount of their TAO to put behind it... any amount up to their current TAO. Weighed TAO is committed to the tally but never leaves their total... it is influence, not currency. A collector can adjust side or amount any time while the nudge is open; latest weighing stands.
3. **Anti-gaming clamp**: each weighing is capped at the collector's TAO *at close*... if they sell down after weighing, their weight clamps to what their TAO actually is when the nudge closes. Weigh what you hold, hold what you weighed.
4. **Auth**: wallet-connect signature (SIWE-style) proves the wallet; TAO read from the register. No gas, no tokens moved, off-chain tally. Signature + weighing stored as the audit trail.
5. **Public nudging**: the card shows two hairline bars (YES / NO) with mono totals and collector counts, and the full ledger beneath... each collector's name/.eth, side, and weighed amount, newest first. Register culture: influence is public.
6. **Close**: at the close date the tally banks. The card flips to a record: result, final totals, participation ('214,000 TAO across 31 collectors'), and... once the studio acts... what happened.
7. **Provenance line**: when a nudged decision becomes an artwork, the work's page carries it permanently in the provenance fold: "STEERED BY 214,000 TAO ACROSS 31 COLLECTORS · NUDGE #3". First artworks anywhere with TAO provenance.
8. **Collector pages**: a quiet NUDGES line... how many weighed in on, linked to their entries in the ledgers. Participation is part of the patron record.

## Admin
9. Nudge authoring via /mintwork: question, optional image, close date, publish. Edit while open only for typos; a question change voids and restarts the nudge.

## Pilot — Strip Paintings
10. First nudge drafted with Ryan at launch... a real Strip Painting design choice (palette warmth, wall selection, or sequence direction... his call on the question). The physical painting that results stands in Hastings CBD carrying the provenance line: collector TAO moved paint in the world.

## Noted, not v1
- Agents with TAO (earned via the AI rail) weighing on AI-collection nudges... the agentic AVS. Design nothing that precludes a wallet being an agent; the mechanics above already don't care.
- Multi-option nudges (beyond binary) only if binary proves too coarse in practice. Smol scale means yes or no until it can't.

## Acceptance
11. End to end: author a test nudge, weigh from two wallets, adjust one, close it, verify the clamp against a wallet whose TAO changed, confirm the banked record and ledger render, and the /mintwork authoring loop.

---

## One studio surface (2026-08-29)

The nudges and the room are one page at `/studio`. `/chat` is a permanent redirect into it.

**Why they were two.** They were built a fortnight apart and the room ended up called Studio while `/studio` was the nudges. That collision was flagged when STUDIO went into the nav pointing at `/chat`; this is it settled. They were always the same idea — TAO gets a voice — wearing two URLs, and the room was the livelier half by a distance: the nudges page has never had a nudge on it.

**The layout is a scroll, not a set of tabs.** Top to bottom: the masthead and the framing, the banked nudges, the room, the open nudge, the composer. The order is doing one specific job. This page opens at the latest message, the way the room always has, so anything the studio is *asking* has to be where the reader lands — hence the open nudge sits between the last message and the box you would answer it in, framed rather than ruled off, because it is a question rather than another row of the log. The banked record goes up top, above the room, because a record is a thing you go and look at.

**Four containers, one owner each.** `#banked` and `#open` belong to the nudges; `#log` and `#speak` belong to the room and are redrawn every time anybody speaks. The room used to rebuild the whole of `<main>`, which on a merged page would wipe a half-typed TAO amount every time a message arrived. The masthead is static HTML: it is the one part of this surface nothing rewrites.

**One wallet, one connect.** The nudges page asked for its own wallet and kept its own. It takes the session now, so a page carrying two connect buttons asking the same question does not exist. Weighing still signs per weighing: the room's session says this browser may speak, and a month-long permission to put any amount of somebody's TAO behind anything is not a trade this page will make on their behalf.

**Nothing about the mechanics changed.** Same `/api/nudge`, same sentence, same clamp, same ledger, same standing rule on every card. Two class names moved to stop the merge going quietly wrong — `.bar` became `.meter`, and everything the nudges draw now hangs off `.nudges` — because a `go` or an `empty` or a `bar` meaning one thing at the top of a page and another at the bottom is exactly how two components that were written apart start disagreeing.

**Still no nudge has ever been authored.** `data/nudges.json` is empty and `next_number` is 1. The empty state says so plainly and the room carries the page in the meantime, which is the argument for merging them made out loud.

---

## Candidates, and a nudge that can decline to decide (2026-08-30)

The pilot needed a shape the binary nudge does not have: a question where the collectors supply the answers as well as the weight. `kind: "candidates"` is that shape, and the Strip Painting colour is the first of them.

**A candidate is a colour, not a row somebody owns.** The hex is the identity, so two collectors proposing the same red land on one swatch rather than splitting it, and the proposals list is a record of who said it first rather than a set of things to reconcile. `#c0392b`, `#C0392B` and `#C39` are the same candidate; the board keeps `#C0392B`.

**Proposing is its own act, with its own signature, and it is not a weighing.** A colour goes on the board with nothing behind it and grows or does not — which is what a palette forming in public actually looks like, including the colours nobody backed. One proposal per wallet per nudge, and final: other people weigh on it, and a proposal that could be changed would move TAO somebody put behind one colour onto another without asking them.

**The lock is two thresholds and both must hold.** Five distinct voters **and** 500,000 TAO on the leading colour, at close. Either alone is a way to be decided by one wallet or by a crowd holding nothing, and the acceptance cases pin both: nine hundred thousand TAO from a single wallet does not lock, and five wallets holding fifty TAO between them do not either. The numbers live on the nudge, so a later one can ask for more or less without a deploy.

**And the clamp still bites.** A weighing counts for no more than the wallet's TAO at close, so a colour carried to six hundred thousand by somebody who has since sold down banks what they still hold — and may fall under the threshold because of it. What the studio undertook to paint is a colour the collectors still stood behind at close, not one they stood behind in May.

**Not locking is a real outcome and the card says which half was short.** *The leading colour has the TAO and needs 5 collectors. It has 4.* The threshold is on the card the whole time the nudge is open, because a nudge that can decline to decide has to say so before it does — and once it is closed the banked line says what happened, so the threshold line stops repeating it.

**On lock.** The swatch reads `#C0392B · CHOSEN` behind the ink rule the site marks everything with; the card banks `LOCKED · #C0392B · 512,340 TAO · 7 COLLECTORS`; the hex joins the Strip Painting Maker's palette as a marked slot, named `collectors` under it, sitting beside the red line as the other colour in that palette nobody at the screen chose. The provenance line a work carries changes voice for a locked colour — *Colour chosen by 512,340 TAO across 7 collectors · #C0392B · Nudge #1* — because "steered by" is not the whole truth where the studio undertook to paint the answer.

**The promise is on the nudge, not in the page.** `promise` is a field, and it renders in the ink-ruled voice above the board: *MintFace will paint the colour this locks. A nudge steers; this one decides.* It is a thing the studio undertook rather than a thing the page says, and a nudge without it is still only a steer. The standing rule stays where it always was, at the top of the surface.

**The first nudge is seeded and NOT published.** `data/nudges.json` carries it with the question, the note, the promise and the thresholds exactly as briefed. `published` is `false` and the close date is a placeholder thirty days out. **Two things are Ryan's**: the date, and whether to make that promise in public. Set `closes`, turn `published` to `true`, and it opens. `api/studio-api.js` now takes `kind`, `lock_voters`, `lock_tao` and `promise` on the `nudge` action — though the console still has no form that posts to it, for candidate nudges or binary ones.

**Checks.** `scripts/tao/test-nudges.mjs`, now fifty-four: the board sorted by weight with the unbacked colours still on it, the same colour proposed twice landing as one swatch with the first proposer credited, both halves of the threshold failing alone, the clamp dragging a leader back under the line, hex parsing in every form, and a signature that names its colour so it cannot be spent on another.

### The public record on a candidate card (2026-08-30)

**One row per collector, and the row is where they stand now.** Somebody who re-weighs, or moves their TAO from one colour to another, is one row on their latest position — not a history of edits. The card answers who stands where; every signature that got them there is in `data/nudge-weighings.json`, which appends and never rewrites. That is the split the AVS rules already made for binary nudges, applied to colours: side is a colour.

**A row is a chip of the colour they backed, their name, what it is worth now, and when.** Newest first, because on a board still forming the interesting question is what just moved. Register conventions throughout: a name is a door to their register page, the figures are live and clamped so a row can shrink between readings and says `clamped` when it has, and a private collector reads as *Private collector* in the muted treatment and goes nowhere — the same restraint the register table shows.

**Above it, how far the lock is.** `6 COLLECTORS · 812,000 TAO WEIGHED`, and then the leader against both thresholds as two hairline bars: `VOTERS 4 OF 5`, `TAO ON THE LEADER 402K OF 500K`. Two bars rather than one blended figure, because a nudge that has met one threshold has met neither, and a single number would be a number that does not exist. Each fills to its own fraction and stops at its own line.

**Two class collisions bit on the way in, both from the merge.** A ledger name wearing `.quiet` — the room's hover affordance — was drawn at opacity nought, so every private and unnamed collector was invisible. A colour chip wearing `.dot` inherited the availability mark, which is round, nudged up two pixels, and the one place this site uses colour to mean something. Both were obvious on screen and invisible to a route test. There are now checks that the ledger wears neither.

### A weighing is not a nightly thing (2026-08-30)

**Four minutes after nudge #1 opened, a collector proposed `#0E5890`, signed for it, was told it was on the board — and the board was empty.**

`api/nudge.js` reads `data/nudge-weighings.json` as the *deployment* serves it. The route had already committed the proposal to the repo, with its signature, correctly. But this site does not deploy on push, so the file the site was serving was the one from the last deploy, and would stay that way until somebody ran a deploy by hand. Every weighing had the same property; it had simply never mattered, because no nudge had ever been open.

So the store carries what has been said since the last deploy and every read lays it over the file — the same arrangement the names layer already makes, for the same reason: the record is a file rebuilt on a schedule, and the thing somebody just did is not. Both copies are written. The repo is the permanent record with the signature on it; the store is what the board reads in the meantime. Deduplicated by signature, which is unique per act and lives in both, so a row that has since reached the file appears once.

**The banking cron reads through the overlay too**, and that is the version that mattered most: banking freezes a record forever, and a nudge banked from the last deploy's file would have frozen the wrong one — quietly, permanently, and in favour of whoever happened to have weighed before the deploy.

The store write is never allowed to fail the request. By the time it runs the signature is already committed, and a colour that appears at the next deploy is worse than one that appears now, but far better than one refused after somebody signed for it.

### Weighing splits (2026-08-30)

**A collector spreads their TAO across as many colours as they like.** Total allocated no more than what they hold; the remainder may simply sit there.

**The reported bug is now impossible rather than fixed.** Under the model before this one a wallet had a single weighing, latest stands — so weighing a second colour silently took the weight off the first. `0xunix.eth` did it twice on nudge #1 inside an hour: blue, then red, then blue again. That is what somebody looks like fighting a model rather than using it. A wallet now holds a map of colour to amount and each signature sets one key, so changing red cannot touch blue: they are different keys and the sentence names one of them.

**A row is still an absolute amount, not a delta.** What a wallet signs is *fifty thousand on this colour*, which is a thing a person can read in a prompt and check. *Add ten thousand* is not, and a lost write would silently change the answer rather than repeat it. Nought is how a colour is taken back, and it is a change like any other rather than a deletion.

**Migration is a fold, and it carries the old rows across untouched.** Chronologically: a row from before allocations *replaces* a wallet's whole map, because that is precisely what it did at the time; a row since *sets one key*. So `0xunix.eth` still has exactly one hundred thousand on `#0E5890` — the position the old model gave them — and the red they had already moved away from does not come back to life. Their history reads honestly: five entries from three signatures, with the two that were moves marked as moves so nobody reads one act as two.

**Selling down scales, in proportion, wherever the board is read.** The clamp generalised: a single weighing clamped to the wallet's TAO, and a set of them now scales to fit it — so a collector who sells keeps the shape of what they said while losing the size of it. Nothing is rewritten; the amounts they signed for stand, and the scaling is applied on every read, which includes at lock. The board is therefore never inflated, and the wallet is told plainly: *You have 300,000 TAO spread across the board and hold 120,000. Until you bring it down, the board counts 120,000 of it, in proportion.* Floor, never round, so the scaled total is never more than what is held.

**Counting.** A wallet counts once on the nudge however many colours it split across, and counts towards a colour only for the part it actually put there. The lock is unchanged in shape and sharper in practice: the leading colour needs 500,000 TAO **and** five distinct wallets carrying some of it. A wallet that split so thinly it holds nothing on the leader is a collector on the nudge and not one of that colour's voters.

**The card.** A field per colour, pre-filled with what this wallet has on it, `WEIGH` where there is nothing and `CHANGE` where there is; then one line saying what they have on the board and what is left — *You have 250,000 TAO on the board · 1,243,717 available*. Their whole position is visible and editable in one place, which is the board itself.

**The ledger became a change log.** Where the board says what stands, the ledger says how it got there — wallet, colour, signed delta, when, newest first. That is the useful half once a wallet can be on three colours at once and a single standings row would have to pick one of them. Clamping left the ledger with it: the record is what was signed, and what a weighing is worth today is a fact about now, said on the board and in the wallet's own line rather than written back into history.

**Checks.** `scripts/tao/test-nudges.mjs`, now 128: splitting across two colours, editing one and finding the other exactly where it was, taking a colour back with nought, over-allocation refused with what is actually left, a sold-down wallet scaled in proportion with its stored amounts untouched, distinct-voter counting with split wallets, the lock reached by five split wallets and missed by four undivided ones — and `0xunix.eth`'s real three rows folding to the one position the old model gave them.

### Weighing joins the session (2026-08-30)

**No wallet prompt to weigh, propose, or adjust.** Sign in once — the same signature that opens the room — and the whole studio surface is open for thirty days.

**Why this reverses a call I made two hours earlier.** Weighing signed per act, on the reasoning that a month-long permission to put any amount of somebody's TAO behind anything was not a trade to make on their behalf. That held while a wallet had one position. It stopped holding the moment weighing split: spreading TAO across a board *invites* adjusting, and a wallet prompt per adjustment fights the thing splitting is for. Spreading across three colours and changing your mind twice was five prompts, which on a hardware wallet is five walks to the drawer. It is the argument the room already settled — a tap per sentence is right for something you do twice a year and wrong for a room.

**The risk is genuinely smaller than for speaking.** TAO never moves. A weighing is reversible by re-weighing. Every change is public in the ledger with a timestamp, so a hijacked one is visible rather than silent. The worst a stolen session does is misdirect influence in the window before it is noticed — against a session that could already post permanently in your name.

**The sentence says what it authorises.** It used to read *this browser can speak here*; it now reads *can speak here, and weigh your TAO on the studio's nudges*. A wallet that approved one thing and got two is exactly what writing the sentence out is meant to prevent. **A session minted before that wording may still speak and may not weigh** — it is asked for one more signature the first time it tries, at the moment that makes sense, and never again.

**The audit chain is made real rather than claimed.** AVS item 4 asks for the signature stored beside the weighing, and one signature now stands behind a month of acts. So the sign-in signature is written down instead of being verified and discarded, keyed by a hash of the session token — a stable public name for a session that cannot be used as one — and each weighing carries that name. Signature → session → every weighing it authorised, walkable, and the record outlives the session by a year. Signing per act is still supported and is still what happens without a session.

**Something had to replace the wallet prompt as a rate limit.** That prompt was a limiter somebody's hand enforced, and every weighing is a commit to the repository: a loop would have been a commit storm against GitHub before it was anything else. Four seconds between acts, forty in ten minutes — generous for somebody spreading TAO across a board, mean for a script.


---

## Twelve nudges, one palette (2026-09-07)

Nudge #1 asked for a colour. This is the arc that question was always the first of: **twelve slots beside the red line, one nudge each, on the same two thresholds.** When the twelfth locks, the Strip Painting Maker's community palette is complete — not migrated, not copied across, complete, because the series block in `data/nudges.json` *is* the maker's palette and always was.

### Nudge #2 asks for something #1 could not

Same mechanics, same thresholds — five collectors and five hundred thousand TAO on the leader, at close, both. Same clamp. The one difference is that a colour now has to stand clear of what is already locked, and the card is built so a voter can see what that means: colour one sits above the board as a fixed swatch marked LOCKED, and it sits again as a sliver beside every candidate. **Contrast is a relation, and a board of loose swatches quietly stops you judging one.** Proposing stays open to any wallet; what changed is that the picker will not take a clasher, and neither will the route.

### The constraint, and why it is measured this way

**Distance is perceptual, in OKLab.** Naive RGB refuses colours that plainly differ and passes colours that barely do — full blue and full green are exactly the same distance from black in RGB, and nobody has ever thought they look it. On a rule that turns somebody's proposal away, that is not a thing to get approximately right. The scale has an anchor worth stating on the card: **black to white is exactly 1.** No. 1's blue and its green are 0.17 apart; its orange and its tan are 0.08; nudge #1's two candidates are 0.29.

**Two things bound the field.** The *space* is the region the maker's own palette occupies — lightness 0.20 to 0.90, chroma no more than 0.18 — which is Strip Painting No. 1's actual range rounded out. A colour outside it is refused for not belonging on a Hastings fascia rather than for clashing, and neon is refused before any distance is measured. The red line, at chroma 0.21, sits outside it: *the red line sits outside the palette* has been printed under the maker's swatches since the start, and it is now true in the arithmetic as well.

The *floor* is the distance a candidate must keep from the nearest locked colour. Max-min, from the candidate's side: **a colour is only as distinct as its closest neighbour.**

### The floor comes down, and that is the whole design

A fixed floor is a trap, and the geometry says so rather than a preference. Hold every slot to 0.30 — a third of the way from black to white, more than No. 1's blue to its green — and simulate the collectors doing exactly what the nudge asks, choosing the colour furthest from everything locked: **the sixth colour is impossible.** Not because anybody did anything wrong. Twelve colours that far apart do not fit in a streetscape. A rule that asks for a colour which does not exist is a rule that hands the decision back to the artist, which is the one outcome this whole thing exists to avoid.

So the floor is derived rather than declared: **the highest rung of a fixed ladder that still leaves a quarter of the field open.** 0.30 down to 0.10 in eleven rungs, so it stays a round, sayable number and a card can state the rule instead of a computation. Early slots are held to 0.30 with 36% of the space still open; by the twelfth it is around 0.12 with more than that. Twelve fill when the collectors choose the furthest colour each time, and twelve fill when every choice crowds the board as hard as the rule allows. Both are checked.

The red line is in the against-set for every slot after the first. It is not a slot and nobody chose it, but it is a colour on the wall, and a nudge that let the collectors lock something 0.04 from it would have produced a painting with two colours that read as one.

**Slot one carries no constraint at all.** There was nothing to be different from, and a rule invented so that every nudge has one would be a rule for its own sake. That also happens to be the honest thing: nudge #1 is open as this is written, unconstrained, with two colours on its board — applying this retroactively would have refused proposals people have already signed for.

### A slot that does not lock

Not locking is still a real outcome, and now it has a consequence worth naming: **the slot stays empty and can be asked again.** A slot is filled by whichever of its nudges locked a colour, so a second nudge may be pointed at the same number. A palette that failed once is not a palette that is short forever, and the alternative — eleven colours because one fortnight went quiet — would have made the threshold something the studio quietly wanted to fail.

### The strip

`PALETTE` renders as twelve slots and the red at 16 beside them, on `/studio` above the banked cards and on the Strip Paintings collection page. A filled slot is the colour itself and leads to the nudge that locked it; the live one leads to the question being asked; **empty slots are drawn rather than left out**, because three swatches read as a palette of three and three swatches with nine hairlines reads as a palette of twelve that is a quarter done — which is the true thing and also the interesting one.

The collection page now names the *series* rather than a nudge. Pinned to `nudge-1` it would still have been showing nudge one when the eleventh was open.

### The maker, and a swatch that was never there

`readCommunityColour()` was called at the foot of `strip-painting-maker.html` and had never been written. The page threw a ReferenceError on every load and the marked swatch nudge #1 was supposed to produce could not have appeared, however that nudge closed. It reads the series now: every locked colour joins the palette marked with the nudge that chose it, a colour No. 1 already used is marked where it sits rather than added twice, and the copied spec names whose colours they were.

### The compound provenance

One nudge chose one colour and says so. Twelve chose the palette, and a line naming one of them would be naming a twelfth of the truth. A work painted from the finished palette carries **`Palette by 12 nudges · N collectors · N TAO`**, with a swatch per slot under it, each leading to the ledger of the nudge that locked it — which is what makes it provenance rather than a boast. `scripts/stamp-nudge.mjs --series strip-palette <work-id>` writes it, and refuses while the palette is incomplete: the line is permanent, and one frozen at seven of twelve would be wrong by the eighth.

Nudge #1's card gains a line placing it: **Colour 1 of 12.**

### Checks

`scripts/tao/test-palette.mjs`, 86: black to white is 1; the RGB failure OKLab does not make; the red line outside the space and No. 1 inside it; the floor as the highest rung leaving a quarter, with the rung above it proved not to; twelve filling under both a well-choosing and a crowding board; a fixed 0.30 failing at the sixth; a colour exactly on the floor allowed and a hair under it refused; a slot that banked without locking left empty and then filled by a second nudge; and the OKLab matrices checked character for character against the browser's copy, because two copies of a rule is two chances to drift and a picker that says yes where the route says no is worse than no picker at all.

---

## The first bank, six days early (2026-09-07)

**Nudge #1 closed on the seventh rather than the thirteenth, at Ryan's call, and `#0E5890` locked: 639,514 TAO across five collectors, on a board carrying 839,935 across seven.** Colour one of twelve. The maker's palette has its first swatch nobody at the screen chose.

Closing early takes a record off the terms it was published under — the card had said *closes 13 September* since it opened, and anyone who meant to weigh next week lost their say. Worth writing down, because the mechanism's whole integrity story is *weigh what you hold, hold what you weighed*, and the studio moving a close date is the one move that story cannot itself constrain.

### The run had never been run

Being told to close, the banking cron answered 500. **Two bugs, both live, both in the one path that cannot be run twice to check.**

The crash was the smaller one. A candidate carried a `ledger` before weighing split across colours; the fold renamed it `wallets` and this projection was never renamed with it, so freezing a board threw on the first colour. Nothing had noticed, because no candidate nudge had ever closed.

**The second would not have thrown.** The run folded a board with `latest()` — one weighing per wallet, which is right for a yes or a no and wrong for a board, because a wallet holds a map and taking only its newest row throws away every colour but the last it touched. That is `0xunix.eth`, who has a hundred thousand on the blue and a hundred thousand on the red. Drop the blue and it goes from 639,514 across five to **539,514 across four** — under the voter threshold. The run would have frozen `NO COLOUR LOCKED`, permanently, on a board that had cleared both thresholds, and the studio would have been told the collectors failed to decide a thing they had decided.

So the projection moved into `_lib/nudges.js` where it can be tested, and which rows a nudge banks from is a named thing that says out loud that the two kinds count differently. Thirteen checks pin it, including nudge #1's exact shape: a split wallet carrying the leader's fifth collector, the wrong fold losing it, the right one keeping the lock.

**Six of the arc's own checks then failed for the arc working.** They read `data/nudges.json` and pinned what it said when they were written — nudge one open, nothing locked. A check that goes red on every lock is a check nobody believes by the twelfth, so the state moved onto a fixture and the shipped config keeps only what is not supposed to move.

### Nudge #2 is open

A fortnight, to 21 September. Same thresholds, same clamp, same promise. It is the first nudge that cannot be answered with anything: a colour has to stand **0.30 clear of `#0E5890` and of the red line**, which leaves 26% of the streetscape range — the floor's quarter, only just, because the blue and the red between them cover a lot of it.

Four of Strip Painting No. 1's own twelve colours survive it: the green `#5FB25B`, the sand `#D5C089`, the grey-green `#B4BBAE` and the pale pink `#EDBFB7`. Its blue `#82B2CE` misses by four thousandths. **The warm end is gone, because the red line was already sitting in it.**

---

## Changing your mind (2026-09-08)

**A collector standing on one colour with everything they hold could not put it on another.** KeyRun had 13,749 TAO on `#E0E050`, tried to move it, and was told it was more TAO than the wallet holds. It was more than they hold *added to the position they were leaving* — a position nobody is ever in. Moving 13,749 from one colour to another is the same 13,749, and it is always legal.

**The bug is the model showing through.** Each signature set one key, so asking for the second colour asked for a map that added up to twice their TAO until they took the first one back — two acts, in an order that leaves a collector's TAO on nothing in between if the second one fails. The validation was right about the arithmetic it was given and wrong about the question: it summed what they had and what they asked for, rather than reading the position the change lands in. **A change is now checked against the state it leaves behind**, in `checkChange()`, which the route and the card both call.

**So a change is one act naming two colours, both absolute.** `from` and `from_amount` ride on the weighing: the sentence reads *#80E080 · 13,749 TAO · moved from #E0E050 · which keeps 0*, which is a thing a person can check in a prompt, where *move ten thousand* is not. The fold applies the colour it came off **before** the one it goes on, so no reading of the record ever shows the wallet on both. One row, one signature, two entries in the change log with the giving-up half marked `moved` — the same shape the migration from the single-position model already produced.

Splitting is untouched. A wallet may still spread across as many colours as it likes; what changed is that getting from one arrangement to another is a move rather than a take-back and a re-weigh.

**Where you stand is on the card, not in the fold.** `YOUR WEIGH-IN` sits under the board with a row per colour — *13,749 TAO on #E0E050* — and `CHANGE` beside each. Change opens the amount and the colour **together**, because that is one decision: this much, here. Move all of it or part of it to any colour on the board, adjust the number, save; what is left behind stays where it was and the panel says so in a line before it is signed for — *#80E080 → 13,749 · #E0E050 → 0 · 0 spare*. It was a folded line reading *You: 13.7K on #E0E050*, which answered where they stood a click late and how to change it not at all.

**WEIGH, CHANGE, MOVE HERE.** A collector already standing somewhere read `WEIGH` on another colour as *propose another one* — a different act, with its own button, which is still where it was and still says `Propose this colour`. The button now says which of the three it is, and where the TAO comes off is named on the row taking it, with what is spare offered first.

**The ledger answers both questions.** Where collectors stand is one row per collector — a wallet on two colours is one row with a chip for each, because somebody who moved their TAO twice is not two collectors — and *Every change* folds underneath it, which is where the log of how it got there belongs.

**A render bug in the same row.** The hex and the colour name were one nowrap box in a column allowed to shrink, so in the sidebar and on a phone the name ran out under the total and the button and the three drew on top of each other. The hex holds its ground and the name ellipses; under 430px, and in the 352px sidebar, the total steps under the hex and the proposer under both.

**Four checks had been quietly red since the fold.** They read `swatches` and `purse` by name, both folded into the row and the banner two refactors ago, so `indexOf` answered −1 and the slice was the page backwards. Repointed at `colourRow` and `position`. `scripts/tao/test-nudges.mjs` is now 196: moving everything legal where the sum was not, moving part leaving the rest behind, a move that tries to add to the colour it comes from refused, the fold never showing both at once, and the acceptance run end to end — weigh a colour, move it all to another, bring the number down, one row on the board at the final state.

### The row, as columns (2026-09-08)

**The overlap was two things placed in one cell.** The hex and its Pantone approximation were one box — two nowrap strings in the column that was allowed to shrink — so what ran out of the end of it was drawn over the TAO figure and the button. The first pass made that box truncate, which stops the collision and still asks the wrong question. **The row is five columns now, one thing in each**: the swatch pair, the hex, the name, the figure, the way in. Nothing shares a cell with anything else.

**Who yields is the design.** The name is decoration and gives way first, truncating with an ellipsis; the figure is the data and never truncates, right-aligned on tabular figures so a column of them compares down the page; the hex is the identity and is not abbreviated either. **Where the panel is too narrow for four things on a line the name drops beneath the hex** and the figure keeps its place — asked of the panel with a container query rather than of the window, because the same card is a 352px sidebar on a desktop and the full width on a phone, and it is the panel that decides. Where a browser cannot ask that, the five columns stand and the name truncates, which is the behaviour this row wants anyway.

**Checked as geometry, not by eye.** `test-nudges.mjs` parses every `grid-area` in the row out of the stylesheet, at both widths, and fails if any two overlap — the exact fault that shipped — plus that the figure carries `nowrap`, `text-align:right` and tabular figures and no ellipsis, and that the name carries one.

**The template was suspect everywhere it renders, and it was.** The chip carried a `grid-area` from before the slivers existed, claiming a cell the pair already had. The collector page draws the same swatch with the same hex-and-name-in-one-box and now keeps them apart. The `STANDING CLEAR OF` captions had it too — `#0E5890 · ≈ PANTONE 2154 C` as a single string in a shrinking flex item — and are now a hex that holds and a name that gives way. In the ledger and the standings the collector's name is the cell that truncates and the figure is not, two colour marks in one standings cell sit beside each other rather than stacking, and in the palette strip a long name ellipses rather than wrapping and making one slot taller than the eleven beside it. Three dead sidebar rules for a `.swatch` this page stopped drawing two refactors ago went with it.

**The Pantone approximations stay.** They were not in the spec and they are the reason a board of hexes is a board people can talk about out loud. They are simply the first thing to give up space.

### The board has to know who is looking (2026-09-08)

**KeyRun clicked WEIGH and got a colour picker, a board that said they had nothing and no TAO, and a refusal telling them to move some off a colour they were not on.** Three symptoms, one cause: **the card asked two questions and took two answers.** *May I weigh* was answered by the session cookie, read at the moment of drawing. *Where do I stand* came out of a payload fetched at some earlier moment. Arrive at /studio signed out — which is what everybody does, because the sign-in button is in the room below the board — sign in, and the first went true while the second still said nobody.

So the board drew a WEIGH button on every colour, drew the propose picker because as far as it knew this wallet had proposed nothing, said *nothing on the board yet* with no TAO beside it, and refused every amount as more than a wallet it had never heard of holds. Reproduced exactly by rendering the card from an address-less payload with a session in the browser; that is now the first case in the journey test.

**`/api/nudge` says who the board is about.** `viewer` is on the response, and the page is editable only for the reader it was fetched for. Where that is not the reader looking at it — signed in since, signed out since, a second tab — it is fetched again, once per reader, and the card says *reading where you stand* rather than *sign in*, because telling somebody who just signed in to sign in is how a page loses them in one line. Signing in on this page reloads the board immediately rather than waiting to be noticed.

**No position means the whole balance is weighable, and moving is never mentioned.** The spare check answered nought for a wallet it had not been told about; it now falls back to the TAO the route reported, and the card is not editable in that state at all. A refusal names what they hold — *you hold 13,749 TAO, so 13,749 is the most that can sit on #80E080* — and only mentions moving where there is something to move.

**One message, one place, one style.** The panel's line was printing the refusal in mono caps while the submit printed the same sentence underneath in the alert face. The panel line is a preview of where the TAO lands and nothing else; refusals go once, into the line under the board.

**And the weigh form says what it is.** `TAO TO WEIGH`, the field, their spare beside it, `WEIGH IT`. Proposing sits under its own rule and its own heading further down, so the one other field on this card cannot be mistaken for the amount box.

### The standing rule: a limited-TAO wallet, not the artist

**Every TAO rule here is a comparison against what a wallet holds, and the wallet these paths get exercised with holds enough that no cap ever binds, has proposed nothing and stands nowhere.** So the branches that only run for a collector with a modest balance shipped three times without ever having been run: the sum that refused a legal move, a spare check that answered nought for a wallet it had not been told about, and a card that offered to weigh while knowing nothing about who was weighing. KeyRun with 13,749 TAO is walking code MintFace cannot reach.

**And there is somewhere to walk it.** `node scripts/dev/serve.mjs` runs the whole studio on this machine — the real pages, the real routes, a real wallet, a real signature, a real session — with three things stubbed rather than credentialled: the register is served with one wallet's balance added on the way out (`DEV_TAO=0xaddr:69000`, the file on disk untouched, so there is nothing to commit by accident), weighings commit to `.dev-store/repo/` instead of to GitHub, and sessions, the live overlay and the rate limiter run against an in-process Redis in `.dev-store/kv.json` instead of Upstash. None of the site's own keys are needed, which is just as well: they are marked sensitive and `vercel env pull` returns `[SENSITIVE]` for every one of them. Delete `.dev-store/` to start again from the live board.

**A TAO-gated path is not tested until a limited-TAO non-artist wallet has walked it.** `scripts/tao/test-weigh-journey.mjs` is that walk in code — a wallet holding 13,749 and one holding 500, against the real route arithmetic and the real card render, through the click path: a board that does not know them offers nothing; WEIGH opens an amount form with their spare on it and no picker; the whole balance weighs; moving it all to another colour is one act naming both; adjusting down leaves one row at the final state; and no screen along the way says they hold more than they do. It runs in `npm test`. **A dedicated test wallet holding one edition is Ryan's to fund** — the automated walk pins the arithmetic and the render, and a real wallet is what pins the wallet, the session and the signature.
