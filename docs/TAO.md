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
