# SETS + OPENSEA-DEFAULT — collector-curated sets, instant digital transfer

## The Geodetic Set (v1)
1. **Definition**: one work from each of five variants... Geodetic World, Geodetic Moments, Geodetic Memory, Geodetic On-Chain (Light OR Dark satisfies this slot), Geodetica. Geodetic Home excluded (gallery-launch POAP).
2. **Collector curates**: /set/geodetic is a builder... five slots in a row, each slot opens the available works of that variant (image, title, price). Pick one per slot. The composed set previews as five images side by side... the buyer sees their wall.
3. **Pricing**: sum of the five chosen works, stated as ONE number (USD default, currency selector applies). No discount... completeness is the incentive, not price.
4. **Availability honesty**: header line "N complete sets remain" where N = the scarcest variant's available count. First build step: verify every variant has available inventory... if any slot is empty (Geodetica especially... confirm the recent 0.05 ETH pricing pass found available works), report before building.
5. **Checkout**: one action for the whole set.
   - Card: single Stripe session, five line items, one total.
   - ETH: batch-fill... five Seaport orders in one transaction, one signature, five tokens land atomically. Uses the same pre-signed orders/listings as everything else.
   - Reserve: reserves all five as a unit, one expiry.
6. **Placement**: a quiet "Complete the set" strip on each participating collection page (mono, one line, links to /set/geodetic). Nothing louder.
7. **After purchase**: the five works flip collected individually with shared attribution; the buyer's confirmation lists the set as a set.

## The Painting Set (v2, spec now, build after Geodetic proves it)
- One each from PixelArcade, Two Burdens, Artificial Flowers. Same builder, same one-number pricing.
- Physical bonus stated at checkout: the three paintings crate and ship together, worldwide, included... one freight, one arrival.
- Hold until Geodetic Set flow is proven live.

## Buy via OpenSea — default for digital
8. Wherever the buyer selects a **digital-only** acquisition and the work has a live OpenSea/Seaport listing: the ETH option becomes **"Buy now... instant transfer"** as the DEFAULT selection, filling the existing listing via the OpenSea API (fulfillment endpoint returns the fillable order; buyer's wallet fills it; payment + NFT atomic).
9. Fallback order when no listing exists: the current connect-wallet manual-transfer path, clearly marked "transfer within a day". As listings are matched (Ryan's session with the listing/signing work), works graduate to instant automatically.
10. Painting or Both selections keep the existing flow... physical fulfilment is inherently non-instant, no need to route those through OpenSea.
11. Label honestly by mechanism, not brand, on the button: "Instant transfer"... the OpenSea mention lives in the fine print line beneath ("Fills the on-chain listing. Token arrives with payment confirmation.").

## Report
Per item, with the set builder shown on preview before production, and the variant inventory counts from step 4.
