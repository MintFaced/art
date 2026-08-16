# PHASE3 — checkout hardening to launch

Drop into docs/. Work on the rebuild branch. Sequence is deliberate... run top to bottom.

## Now (no GitHub token needed)

*Items 1 to 6 are done. Notes against each.*

1. ~~**Pin crypto quotes.**~~ Done. Signed 15 minute quotes from `/api/quote`, countdown in the slide-over, requote button on expiry. USD card path honours the same lock, so Stripe charges the figure that was shown. An ETH payment is judged against the rate that was locked when its block was mined, so sending inside the window is honoured even if it confirms after.
2. ~~**Double-sale protection on 1/1s.**~~ Done. Compare and set claim against the ledger, 30 minute session TTL, released by `checkout.session.expired` or swept by the cron. Ten simultaneous buyers were raced against one painting: one won, nine were refused. Pending renders as "At the checkout" with the reserve dot. Editions are not held. If the ledger is unreachable a unique work refuses to sell rather than risk selling twice.
3. ~~**Reserve loop end to end.**~~ Done against a stand-in ledger. Hold taken, second buyer and checkout both refused, day 12 reminder sent once and not repeated, day 14 release, work back on sale. The cron now fails closed: no secret in production is a 503 rather than an open endpoint.
4. ~~**Reserve copy fix.**~~ Done. Reads "Reserve ... until 30 Aug".
5. ~~**OG meta per work page.**~~ Done. `/w/:id` goes through `api/w.js`, which writes the work's title, statement and image into the head. Twitter card is `summary_large_image` when there is an image.
6. ~~**Still Water:**~~ Stripped. No price was supplied, so Recent Work is empty again. `node scripts/add-work.mjs` adds the real first entry.

## Tomorrow (GITHUB_TOKEN arrives)

7. **Wire the webhook.** checkout.session.completed → write sale to data/state.json → work flips to Collected on deploy. Include payment path, amount, currency, what was bought (digital/painting/both).
8. **Two emails on completion.** Buyer: receipt/thank-you, what they acquired, what happens next (token transfer within a day; shipping contact if physical). Ryan: what sold, how, buyer details, shipping address if physical. Both from EMAIL_FROM.
9. **Full 4242 loop.** Buy → webhook → state flip → attribution renders → both emails land. Test digital-only, painting, and both-together paths.
10. **ETH path test.** Paste-the-hash flow: submitted hash → pending state → Ryan confirmation flow documented (manual transfer from hardware wallet for v1).

## Ryan inputs (merge as they arrive, don't wait)

- ~~NZD prices per work~~ Imported 16 Aug from `mintface paintings data.xlsx`: 78 works priced, 83 with dimensions. Acquire is live on PixelArcade (all 64), Artificial Flowers (13) and FROGDNA. Two Burdens came through with no prices, so those still read "Enquire".
- Hero ids → data/f/home.json
- ~~Physical dimensions + ready-to-hang/framed/certificate~~ Imported. Five paintings are marked as already with a collector, four Artificial Flowers as digital only.
- One-line statements: PixelArcade, Artificial Flowers, Patrimora, FROGDNA, Recursive Mind
- Collector display names: five real names came through (K Jensen, Liza, S & A Novak). The rest of the sheet repeated the wallet address, so those still show as ENS or a short address. Anonymity list still open.
- /projects decision: 301 to / or rebuild in new design with footer link
- BTC address signing confirmed by Ryan before live
- Image source decision: R2 bucket (ASSETS_BASE switch) or chain/IPFS for launch

## Pre-launch (from LAUNCH-CHECKLIST.md, condensed)

- Mobile pass on the Vercel branch preview... every template, phone in hand
- Buy a cheap work via every path with live keys in test-first order: Stripe NZD, Stripe USD, ETH
- Reserve expiry cycle verified with real dates
- Acquired/Vaulted/Sold Out/Burned/Uninscribed states spot-checked
- Lighthouse: lazy images, LCP < 2.5s on 4G
- 301s: any old mintface.art URLs that ranked, /projects per Ryan's call
- Swap Stripe test keys → live keys, re-register webhook on live mode
- Flip: remove the home.html rewrite line / rename, old index retired
- Announce: one work, one link... let the site speak

## Standing rules
- rebuild branch until the flip. Nothing on main.
- No live keys until the pre-launch section.
- No em-dashes in site copy... ellipses. No corporate language.
- Every new page: light, ink-only, single green availability dot, art edge to edge.
