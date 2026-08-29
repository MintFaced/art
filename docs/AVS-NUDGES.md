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
