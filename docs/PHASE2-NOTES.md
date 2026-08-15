# Phase 2 — decisions + amendments

Drop into docs/. Supersedes conflicting lines in CLAUDE-CODE-BRIEF.md, DESIGN-SPEC.md, catalog.seed.json. catalog.json (Phase 1 output) is now the source of truth for counts, contracts, owners.

## Accepted corrections (Phase 1 report)
- All chain-derived counts replace provenance-table numbers. Update the site's Provenance table to chain truth.
- Foundation 1/1s = 6. Fix genesis-draft.md: "Six photographs."
- Split catalog: index.json + per-collection files. Editions collapse to one record + holder count. Owners refreshed via scripts/catalog re-run.

## Dates
- City vs Nature: tell it in NZ time... minted April 26th, 2021. Update genesis-draft.md and the feature caption: MINTED APRIL 26TH 2021 · RARIBLE.
- Geodetic Moments: August 2021 stays in the prose (the walking + listing). Chain caption reads FIRST COLLECTED OCTOBER 2021.
- Geodetic Moments attribution: 78/100 from chain. Ryan supplies the missing 22 collector records (OpenSea lazy-mint sales)... leave those works' collector fields pending, render as acquired.

## Placement decisions
- Seize And Share: include as "a study of another project"... quiet archive page. Not in main nav; linked from AI Studies or footer archive. Vaulted 123 render as vaulted.
- Geodetic Sculpture 1/1s (June 2026, ryanj.eth contracts): into the Geodetic set alongside Geodetic Home.
- Recursive Mind: 9 inscriptions on chain vs 13 claimed... build with 9, flag for Ryan.

## FROGDNA checkout (special case)
- Native asset: Counterparty (Fake Rare), supply 88 locked, Ryan holds 33.
- Some wrapped via EmblemVault → purchasable with ETH; native → BTC.
- Work page offers: Stripe NZD / Stripe USD / Reserve / ETH (EmblemVault-wrapped) / BTC (native Counterparty).
- ETH + BTC crypto flows for FROGDNA: show address + amount, delivery arranged directly... no connect-wallet automation needed for BTC. Keep it simple and manual behind a classy front.

## Phase 2 kickoff prompt for Claude Code
"Read docs/PHASE2-NOTES.md, docs/DESIGN-SPEC.md and docs/CLAUDE-CODE-BRIEF.md Phase 2. Split catalog.json per the notes, then build in this order: work page with all states, collection grids + filters with inline prices, Geodetic set page, Genesis + 10k features, Vault, Seize And Share archive, Exhibitions + Provenance, Recent Work + add-work script, then checkout flows last. Work on the rebuild branch. Show me the work page for review before building the rest."

## Addendum — links + resolutions
- FROGDNA EmblemVault (ETH): contract 0x4c03bcad293fb0562d26faa7d90a0cb3ea74c919, token 112120649069925438432858119347465481415441762939268014343104260294108241684123 ... https://opensea.io/item/ethereum/0x4c03bcad293fb0562d26faa7d90a0cb3ea74c919/112120649069925438432858119347465481415441762939268014343104260294108241684123. Enumerate any further wrapped editions on this contract.
- Geodetic Moments: OpenSea Shared Storefront 0x495f947276749ce646f68ac8c248420045cb7b5e, collection slug geodetic-moments ... https://opensea.io/collection/geodetic-moments. Full 100 enumerable here; closes the 22 missing collector records via OpenSea API/events on that contract filtered to the collection.
- Recursive Mind: canon is 13. 9 inscribed as Ordinals (per-work inscription links on https://rrrecursive.com, e.g. gamma.io/ordinals/inscriptions/922dabb4...ec3ei0). 4 not yet inscribed... include as works with a new state:
  - **Uninscribed** → button reads `Enquire to have inscribed`. Opens mailto/enquiry form. Details table shows INSCRIPTION: Not yet inscribed. Once inscribed, flips to normal Available.
- State list is now: Available / Reserved / Acquired / Vaulted / Sold Out / Uninscribed (Recursive Mind only).
