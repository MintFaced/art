# TAO — Total Art Owned, v1

Time-weighted patronage. Every day a wallet holds MintFace art it accrues TAO: **69/day per 1/1 held, 4.2/day per edition copy held** (per copy... five copies of one edition = 5 × 4.2). Computed from the Transfer-log ownership history the sweep already maintains. No new chain infrastructure.

## Computation
1. Build per-wallet holding **intervals** from the existing Transfer logs: (token, wallet, from_timestamp, to_timestamp|now). Edition-aware per copy... an ERC-1155 balance of 3 accrues 3 × 4.2 for the interval that balance held, tracking balance changes as interval boundaries.
2. **Sold means subtracted; transferred means kept.** Per (wallet, holding): TAO accrues while held. If the holding leaves via a **sale**, all TAO that holding earned for that wallet is removed from their total. If it leaves via a plain **transfer** (gift, own-wallet move... no consideration), the banked TAO stays with the sender; accrual simply stops there and begins fresh at the receiving wallet (clustering merges these properly in v2). Store per wallet: `tao_total` and `tao_rate` (current accrual/day).
2a. **Sale detection**: a transfer is a sale when its transaction shows consideration... marketplace contract involvement (Seaport, Wyvern, Blur, Foundation market, LooksRare... maintain the list as config) or ETH/WETH value flowing to the sender in the same tx. Everything else is a plain transfer. Log the classification per exit event so misclassifications are auditable; ambiguous cases default to transfer (kept) and get flagged in the report rather than silently subtracting.
3. **Per-work contribution**: store the TAO each holding has contributed per wallet (current holdings at minimum; lifetime per-work if cheap), for the hover display.
4. **Exclusions**: artist wallets (mintface.eth, ryanj.eth), mintestate.eth/escrow, contract-held tokens (e.g. PixelArcade's custody contract), burn address. Mint-to-first-collector intervals accrue to no one. Known marketplace/deployer contracts excluded from accrual... a Seaport-held second is not patronage; use the existing exclusion set.
5. **Scope**: canon + archive collections only... the same set that counts toward works-on-record. XNouns and We are The Line do NOT accrue TAO (patron context, not MintFace art). First Selfie does (canon).
6. **Precision**: compute on timestamps, day = 86,400s, fractional days count fractionally; display floored integers.
7. Wire into the daily cron: TAO recomputes with each sweep. Deterministic... same logs in, same TAO out; no stored running totals that can drift. Full recompute each run.

## Display (collectors.mintface.art)
8. Collector page header, mono, beside the works line: `TAO 428,690 · +351/DAY`. A collector who sold everything shows whatever survives their exits (transfers kept, sales subtracted); totals can legitimately decrease between runs now... the leaderboard has skin in the game.
9. Collectors index: **TAO** joins the sort row... WORKS HELD · MOST RECENT · TAO. Add a TAO column (tabular figures). This is the leaderboard sort.
10. Per-work hover/tap on a collector's wall: `THIS WORK · 48,231 TAO` (its contribution to their total).
11. One-line explainer where the metric first appears, linked from the TAO label: a small /tao page or fold... "TAO measures time. Every day a 1/1 stays with you earns 69; every edition copy earns 4.2. Sell a work and its TAO leaves with it. It cannot be bought quickly, and it can be lost in a moment." House voice, near-zero further text.

## Sanity checks before shipping
12. Spot-verify four wallets by hand: one long 1/1 holder, one edition-heavy holder, one seller (TAO visibly subtracted), one transferrer (TAO kept, rate stopped). Show the arithmetic and the sale/transfer classification in the report.
13. Report the top 10 by TAO vs top 10 by works held... the divergence between those lists is the metric working (early small collectors outranking recent whales). Flag anything absurd (a wallet with impossible totals usually means an exclusion miss or interval bug).

## Noted for later, not v1
- v2: wallet clustering (linked wallets accrue as one collector), lifetime per-work everywhere.
- Extraction: the engine becomes a public tao-engine repo (config: contracts, rates, exclusions), then a Claude Skill installer, then The Line inherits per-artist boards. Keep the computation cleanly separable from the site code with this in mind... one module, config in, JSON out.

---

## v1 as built (2026-08-23)

Where the build departed from the spec above, and why.

**"Computed from the Transfer-log ownership history the sweep already maintains."** It did not. The daily sweep keeps who holds what *now*, plus a block cursor; nothing anywhere recorded *when* a work changed hands, which is the one thing a time-weighted metric needs. So the history is built by `scripts/tao/fetch-events.mjs` and cached in `data/tao/e/{contract}.json`, one file per contract, extended nightly from a cursor. 7,000-odd events over 23 contracts.

**Two ways in.** Thirteen contracts are Ryan's own: their whole log is MintFace work, so the full range is swept and filtered to the catalogue's token ids. Five are multi-artist (the OpenSea Shared Storefront, The Memes by 6529, Foundation, Rarible, networked.art), where sweeping means reading millions of other people's transfers, so the first backfill reads those one token at a time. Once there is a cursor, a single day of any contract's log is small enough to sweep, which is what keeps the nightly run in seconds.

**An edition minted as ERC-721 is one work over many token ids.** Seize And Share is 61 works across 3,246 ids; Geodetic Memory is one work across 832. The first run asked only for each work's display id and found a 72nd of Seize And Share. Every id in `token_ids` is now followed, and each one accrues as a copy at the edition rate.

**Sale detection** reads the transaction the transfer sat in: a log from any contract in the marketplace config, or WETH landing on the wallet that gave up the art. Anything else defaults to a plain transfer and is written down with its reason in `data/tao/sales.json`. ETH paid through an unlisted contract will read as a gift ... the forgiving direction, as specified.

**Not accruing.** FrogDNA and Recursive Mind are on Bitcoin. They are canon, they count toward works held, and they earn no TAO, because there are no Ethereum Transfer logs to read. Their holders are not being slighted; there is simply nothing to measure yet.

**Files.** `api/_lib/tao.js` is the engine and knows nothing about MintFace ... events and config in, totals out. `data/source/tao.json` holds the rates, exclusions, marketplace list and scope. That separation is for the extraction path noted above.

**Checks.** `scripts/tao/test-engine.mjs` pins the accrual rules against arithmetic done by hand. `scripts/tao/check-replay.mjs` replays the whole history and compares the balances it lands on with the holders the ownership sweep found independently ... two methods agreeing, rather than one method agreeing with itself.

---

## v1.1 — integrity (2026-08-25)

Answering docs/TAO-INTEGRITY.md. What the directive asked to have proved, and what proving it turned up.

**The TAO cron is running.** It is scheduled, it authenticates, and it completes: `data/tao.json` was rewritten at 21:30 UTC on the 23rd and again on the 24th, and the totals moved by exactly one day's accrual each time. `CRON_SECRET`, `GITHUB_TOKEN`, `ETHERSCAN_API_KEY`, `RESEND_API_KEY` and `EMAIL_TO_ARTIST` are all set in production. There were no run records to show because nothing had ever been asked to write one; there are now.

**What was actually wrong was Phase C, not the arithmetic.** Three faults, all of them in what the run does with the numbers rather than in the numbers:

1. *The run shrank the register every night.* It rebuilt `data/collectors.json` from the TAO scope — canon and archive minus the patron collections — instead of from the catalogue. XNouns, We are The Line and the vault fell out, and with them 471 collectors and 296 collector pages: 3,681 people at 21:00 became 3,210 at 21:30, every night, and the morning sweep put them back. adacrow.eth's eleven works read as eight for twenty-three and a half hours out of twenty-four. TAO decides what earns. It was never meant to decide who is a collector.
2. *Nothing wrote the leaderboard.* `data/collectors-register.json` is what the register table on collectors.mintface.art reads. It is derived on every rebuild and was written by nothing but a hand-run script, so while TAO was being recomputed nightly the table showing it was dated the 23rd. Both crons write it now.
3. *A collector page carried a figure that could not be kept current.* Every one of the 808 pages moves every night, because time moved; rewriting them all is 808 commits. So the whole board is published instead as `data/tao/pages.json` — about forty kilobytes — and the page lays it over what it was served. Pages themselves are rewritten only for the wallets whose works actually changed hands. The number under a collector's name is now exact at the moment it is read, not at the moment their last trade settled.

Both crons also pass the nudge weighings through the rebuild now. They did not, so a count that exists on the record was being dropped from the index nightly.

**The run has phases.** `api/cron/tao.js` reads as A, B, C. Phase A extends the event history and produces the ownership diff before any arithmetic: what moved, from whom, to whom, and on what terms, with the transactions that arrived tonight classified ahead of the backlog so that no exit is described as a gift merely because nobody got to it. Phase B recomputes in full from the whole history, as before. Phase C writes: events, sales, totals, exits, register, leaderboard, slug map, overlay, the pages that moved, and the run record.

**Run records.** `data/tao/runs.json`, ninety kept, newest first, also at `/tao/runs`. Each says when the run started and how long it took, which blocks were scanned, how many transfers went past on our own contracts, what changed hands and how it changed hands, which wallets were affected and what their totals were before and after, what the register counted afterwards, and how many transactions are still unread. A failed run writes a record too, with the reason.

**Silence is now provable.** The run emails on: a failure; a gap since the previous run longer than 36 hours on a daily schedule, which is a run that did not happen; three runs in a row that changed nothing while our own contracts were busy; a contract with no event history, whose holders would accrue nothing without anyone noticing; and an exit that arrived tonight and went unread, since an unread exit is treated as a gift and keeps TAO that a sale would have taken.

**The acceptance cases pass.** `scripts/tao/check-integrity.mjs` runs items 6 to 10 against the real history and prints the arithmetic for each: adacrow.eth's twelve sales and the 46,717 they cost her; a Geodetic Moment sold in 2022, where the seller's 195 days are taken back and the buyer's figure is 1,586 days at 69 and not one day more; First Selfie #89 given away nine days ago, where the sender keeps 89,888 and stops earning and the receiver starts at zero; and XCOFFEE, where two of three copies sold took back 7,976 of 11,965 — two thirds, exactly — and the copy that stayed carried on at 4.2 a day. Every wallet in `data/tao.json` is also recomputed from scratch by that script and compared; the two agree to the last unit.

**Not fixed here.** `scripts/tao/check-replay.mjs` puts the replayed ownership at 98.4% agreement with the catalogue — 17 tokens of 1,075, mostly editions. That is the ownership sweep's ground to make up, not TAO's.

### The ownership sweep, which had stopped

Found while proving the above, and fixed in the same pass because the register depends on it. The sweep of 24 August 21:00 UTC wrote nothing at all: no cursor, no register, no run log. Its edition pass — new the previous morning — reads holder lists one token at a time from a paging indexer, and it runs before anything is written, so exceeding the three-hundred-second budget loses the entire night. A night that loses everything and a night when nothing moved leave behind exactly the same thing, which is why nobody was told.

That pass now stops at a deadline and reports the editions it did not reach, so the rest of the run lands. And the sweep is wrapped: anything that throws or times out writes a failed run record and emails, rather than leaving the silence that made this hard to see.
