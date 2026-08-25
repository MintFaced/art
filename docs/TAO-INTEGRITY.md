# TAO-INTEGRITY — prove the sweep, harden the recompute

Items 1–2 of Ryan's batch are the TAO spec as designed... adds accrue, sells subtract, TAO never travels with a token. adacrow.eth's stale wall says execution is failing, not design. This directive is verification with teeth.

## The daily run, restructured as explicit phases
1. **Phase A... ownership diff first**: before any TAO math, sweep transfers since the last run and produce the diff: which wallets gained works (accrual starts), which lost works and HOW (sale → their TAO for that holding subtracts; plain transfer → banked TAO kept, accrual stops; receiving wallet starts from zero either way... TAO NEVER transfers with a token, sale or gift alike).
2. **Phase B... recompute**: full deterministic TAO recompute from complete interval history (as specced... no incremental totals that drift).
3. **Phase C... apply + evidence**: update register, collector pages, leaderboard, set meters. Write a run record: timestamp, blocks scanned, works changed hands (n sales / n transfers), wallets affected, TAO deltas, duration. Keep the last 90 run records queryable.

## Prove it's actually running
4. Show the last five production run records. If they don't exist: the cron isn't scheduled/authing/completing in production... find which (vercel.json crons entry, CRON_SECRET wiring, silent failure) and fix before anything else.
5. **Staleness alarm**: if a run fails, or N days pass with zero changes while chain shows transfer activity on tracked contracts, email Ryan. Silence must be provable, not assumed.

## Test cases (run against real history, show arithmetic)
6. adacrow.eth: her sold works flip, TAO subtracts... the named acceptance case.
7. A sale: seller's holding-TAO gone, buyer accruing from transfer timestamp, buyer's TAO does NOT include the seller's history.
8. A plain transfer: sender keeps banked, stops accruing; receiver starts at zero on it.
9. An edition balance change (partial sale of 3 of 5 copies): per-copy intervals adjust correctly.

## Guard rails carried forward
10. Escrow/marketplace/artist/vault exclusions, edition-aware intervals, head-block-throws, sale-vs-transfer classification with ambiguous-defaults-to-transfer... all as previously specced; re-verify each is live in the production path, not just in the scratchpad version.
