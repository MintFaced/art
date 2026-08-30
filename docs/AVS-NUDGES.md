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

