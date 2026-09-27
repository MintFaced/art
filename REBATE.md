# REBATE · the 🧧 split on AI sales

A discretionary rebate campaign on works sold through the agent rail. Half of each eligible sale is rebated: 40% to TAO holders by holdings, 10% to the scout who sent the buying AI. Framed and implemented as a one-off discretionary rebate, never a promise of returns.

Builds on AAB.md sections 1 + 3 (live at mintface.art/ai).

---

## Campaign

- One campaign record: `rebate_campaigns` {id, name "Campaign 1", starts_at, ends_at, holder_pct 40, scout_pct 10, min_tao 5000, cap_pct 5, status open|closed|paid}.
- Starts when Ryan flips it on in /mintwork. Ends at sellout of the AI works in scope, or when the current signed orders expire (30 days), whichever comes first. Ryan can close it early.
- Percentages live on the campaign record, not in code. Future campaigns may differ or not happen at all.

## Eligible sales
- Only sales filled through the agent rail (pre-signed Seaport orders served by /ai/buy) during the campaign window.
- OpenSea list-price sales, Stripe, and site ETH checkout are not eligible.
- The sale sweep already detects rail fills; tag them `rail: agent` and attach `campaign_id`.

## Scout capture
- The agent passes a scout on its request: `GET /ai/buy/{workId}?ref=<wallet | ens | @handle>` or header `X-MintFace-Ref`.
- Resolve ref → wallet via the existing name resolution (overlay > SIWE name > ENS > verified X handle). Store it on the served order record, keyed to the order hash, so the fill can be matched to its scout later.
- Valid scout: resolved wallet (or its COMBO group) holds ≥ min_tao on the sale day, and is not the buying wallet. Invalid or missing → scout share rolls into the holder pool for that sale. No error to the agent; the purchase always proceeds.
- The first ref recorded for an order hash wins. No overwriting.
- Document `ref` in llms.txt and on /ai under "For builders".

## Per-sale allocation (at sale detection)
1. `pool_holders = price × holder_pct` (+ scout share if no valid scout)
2. Snapshot = the TAO table from the most recent daily recompute before the sale block.
3. Eligible holders: resolved TAO ≥ min_tao, grouped by COMBO (one group = one holder), artist wallets excluded, buying wallet included only if it already qualifies.
4. `share = pool_holders × holder_tao / total_eligible_tao`
5. Cap: no group exceeds cap_pct of pool_holders. Excess is redistributed pro-rata to uncapped holders; iterate until stable.
6. Scout gets `price × scout_pct`.
7. Write rows to `rebate_ledger` {campaign_id, sale_tx, wallet (group primary), kind holder|scout, amount_wei, tao_at_snapshot}. Integer wei maths only. Sum of rows for a sale must equal exactly 50% of price; rounding dust goes to the largest holder row.
8. Deterministic: rerunning allocation for a sale gives identical rows. Store the snapshot id used.

## Public ledger (on /ai)
- Section: "🧧 Rebates". Campaign status, eligible sales so far, total rebated, and a table: name · kind (holder / scout) · amount owed, sorted by amount. Names link to profiles.
- Signed-in viewers see their own row pinned: "Owed to you: 0.004430 ETH".
- Per-sale expandable detail: work, price, scout, holder pool, top 10 recipients.
- Copy (RWI, final):
  - Headline: "Send an AI to look. If it buys, you get 10%."
  - Line: "Every AI sale in this campaign: half to the artist, 40% rebated to 🧧 TAO holders by holdings, 10% to whoever sent the AI."
  - Footnote, small: "Rebates are discretionary and one-off. Nothing here promises future rebates or returns. Holding MintFace art is collecting, not investing."

## Payout
- At campaign close, /mintwork shows PREPARE PAYOUT: totals per wallet, rows under 0.001 ETH listed separately as roll-forward.
- Generates a multisend batch (Disperse-style contract calldata) for all rows ≥ 0.001 ETH, split into chunks if gas requires. Ryan signs from the hardware wallet. Nothing sends automatically, and no private key ever touches the server.
- After execution, the sweep matches payout txs, marks rows paid with tx hash, campaign status → paid.
- Sub-threshold balances carry to the next campaign if there is one. If there's no next campaign within 12 months, Ryan decides: pay them in one batch or leave them. The ledger shows them honestly either way.

## Tweet bot
- Eligible sale: existing agent-sale tweet + " · 🧧 REBATED 50%" and "SENT BY @scout" when there's a valid scout with a handle.
- Campaign close: "CAMPAIGN 1 CLOSED · X.XX ETH REBATED · N COLLECTORS · N SCOUTS".
- Payout sent: "REBATES PAID · X.XX ETH".

## Guardrails
- Artist wallets (all MintFace/COMBO addresses) are hard-excluded from both holder and scout roles.
- Snapshot uses recomputed TAO only, never live balances. Buying art mid-campaign earns TAO from that point on, like always.
- Kill switch: campaign status → closed stops new allocations immediately. Existing ledger rows stand.
- The rebate is computed from on-chain fills only. If a fill can't be matched to a served order, it's still eligible for the holder pool, just with no scout.

## Acceptance
- Test campaign on a single test order (cheap work, throwaway agent wallet):
  - Fill with valid ref → scout row = 10%, holder rows sum to 40%, total exactly 50% in wei.
  - Fill with buying-wallet-as-ref → scout share rolls into holders.
  - Fill with ref under 5,000 TAO → rolls into holders.
  - Fill with no ref → rolls into holders.
- Cap test with a fixture where one group holds 20% of eligible TAO → capped at 5%, excess redistributed, totals still exact.
- Rerun allocation → identical rows.
- /ai ledger shows owed amounts; signed-in row pins.
- PREPARE PAYOUT output reconciles to the ledger to the wei, and excludes sub-0.001 rows.

## Ryan inputs
- Confirm which works are in scope for Campaign 1 (the 7.75305 ETH set).
- Flip the campaign on in /mintwork.
- Before launch: quick check with an NZ adviser on the rebate framing (Financial Markets Conduct Act). Don't go live until then.
- At close: sign the multisend batch.
