# Checkout

Five ways to buy, built on Stripe, the chain, and email. No database: sale state is committed back to this repo.

## The shape of it

```
Work page                      Vercel function                 Result
────────────────────────────────────────────────────────────────────────
Acquire ......................................................  slide-over
  what:  digital / painting / both        (prices from the catalog)
  how:
    Card NZD .............. POST /api/checkout ................ Stripe Checkout
    Card USD .............. POST /api/checkout ................ Stripe Checkout
                            (NZD converted at the hour's rate)
    Ethereum .............. POST /api/eth-payment ............. verified on chain
    Bitcoin ............... email, FROGDNA only ............... arranged by hand
    Reserve ............... POST /api/reserve .................. 14 day hold

Stripe ...................... POST /api/webhook ............... work marked sold
Daily 19:00 UTC ............. GET  /api/cron/reserves ......... nudge day 12, release day 14
```

Every state change is a commit to `data/state.json`, which triggers a deploy. The pages fetch that file and overlay it on the static catalog, so a work reads as reserved or collected without a catalog rebuild. The lag between a sale and the site showing it is one deploy, about a minute.

## What is wired

- **Stripe** is provisioned through the Vercel Marketplace and connected to the `art` project. Sandbox, so test mode. `STRIPE_SECRET_KEY` and the publishable key arrive automatically.
- **The webhook endpoint** is registered at `https://mintface.art/api/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Its signing secret is in `STRIPE_WEBHOOK_SECRET` for production and preview. That URL 404s until the rebuild branch is live.
- **Resend** is provisioned, `RESEND_API_KEY` is set for production and preview.
- **Prices** come from the catalog on the server. The browser never sends a price, so a tampered request cannot set its own.
- **Fulfilment happens in the webhook**, never on the success page. A buyer can pay and close the tab, and delayed payment methods settle hours later.
- **Crypto addresses and rates** come from `/api/pay-details`, so nothing is hardcoded in the page. Ethereum resolves to mintface.eth `0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180`, Bitcoin to the Counterparty issuer `1GpCYqHS3sqvg4n837NJmcsmWLfAssXcqK`. Both steps show the address and the converted amount.
- **Email** goes out as `MintFace <art@mintface.art>`, set in `EMAIL_FROM`. The public Contact link and the enquiry button stay on `ryan@mintface.art`; `art@` appears only where a sale is already in motion, so those replies thread with the receipts. `CRON_SECRET` is set, so the reserve cron refuses unauthenticated calls.

## What still needs you

1. **`GITHUB_TOKEN`** ... a fine grained personal access token with **Contents: read and write** on `MintFaced/art`, nothing else. Without it every sale and hold returns a clear 503 saying to email you, rather than failing silently.

   ```
   vercel env add GITHUB_TOKEN production
   vercel env add GITHUB_BRANCH production     # main, or rebuild while testing
   ```

2. **Finish verifying mintface.art in Resend** so `art@mintface.art` can send. Underway. Until it clears, Resend only delivers to your own address.

3. **Test mode to live** when you are ready: claim the Stripe sandbox, swap the keys, and register the webhook again against the live account.

Already set: `EMAIL_FROM`, `BTC_RECEIVE_ADDRESS`, `CRON_SECRET`, `RESEND_API_KEY`, the Stripe test keys and `STRIPE_WEBHOOK_SECRET`.

Optional: `EMAIL_TO_ARTIST`, `ETH_RECEIVE_ADDRESS` (defaults to mintface.eth), `RESERVE_DAYS` (defaults to 14).

## Quotes

Crypto and US dollar figures are locked the moment the slide-over opens and honoured for fifteen minutes. Nothing moves under a buyer while they are deciding.

`POST /api/quote` returns the three rates and a signed token. The token carries the rates, the work and an expiry, signed with `QUOTE_SECRET`, so it travels with the buyer instead of sitting in a database. The server will not honour one it did not sign, one issued for another work, or one that has run out.

The slide-over shows a countdown. When it reaches zero the figures stop being offered and a "Take a fresh rate" button appears; nothing is charged against a stale number.

- **Card in USD** ... the quoted rate is what Stripe charges. The quote id goes into the session metadata, so a receipt can be traced back to the rate it was priced at.
- **Ethereum** ... the payment is judged against the locked rate, and a quote counts as live if it had not expired *when the block was mined*. A buyer who sends inside the window is honoured even if the transaction confirms after it.
- **Bitcoin** ... the same locked rate produces the amount shown beside the address.
- Tolerance is half a percent against a quoted rate, since only rounding should move, and two percent when someone pays without one.

## No double sales

A painting is one object. Two people must never both pay for it.

`POST /api/checkout` re-reads the ledger before it does anything, and once Stripe has a session it claims the work as `pending`, naming the session that holds it. A second buyer arriving mid-checkout is told someone is at the checkout and offered a retry, rather than being sold the same painting.

The claim is a compare and set against the GitHub contents API: the write carries the sha it read, so a losing writer gets a 409, re-reads, sees the work is now pending and stops. Ten simultaneous claims were run against a local stand-in for the API: one won, nine were refused, and a claim after the sale was refused too.

The hold lifts in three ways, so nothing can be stranded:

- the buyer pays, and `checkout.session.completed` marks it collected
- the buyer walks away, and `checkout.session.expired` puts it back on sale
- neither event arrives, and the daily cron sweeps holds five minutes past their session

A late expiry event cannot steal a newer buyer's hold: the release only fires when the pending session matches the one in the event.

Sessions expire after thirty minutes, which is the shortest Stripe allows and enough for a fifteen minute quote. `CHECKOUT_HOLD_MINUTES` changes it.

**Editions are not held.** An edition of 88 can have 88 buyers. The lock applies to unique works and to anything that includes the painting, since there is only ever one of those.

**If the ledger is unreachable, a unique work will not sell.** No `GITHUB_TOKEN`, no GitHub, and checkout returns a 503 telling the buyer to email instead. Refusing a sale is recoverable; selling one painting twice is not.

## The Ethereum path

The buyer pays mintface.eth from their own wallet, either through the connect button or by sending it themselves and pasting the transaction hash. The function then reads the chain: right recipient, enough value, actually mined, not already used. Only then does the work flip to collected.

**No key ever touches the server.** The token is transferred by you, hardware signed, after the payment lands. `token_transfer: pending` sits in the state file until you do.

## The FROGDNA path

FROGDNA is a Counterparty asset on Bitcoin, and 30 of the 88 are wrapped in an EmblemVault on Ethereum. So its work page offers both: the ETH flow buys a wrapped edition through the wallet, and the Bitcoin option opens an email, because a Counterparty transfer is arranged by hand. Same work, same provenance, no wrapper.

## Share previews

`/w/:id` is served by `api/w.js`, which fetches the static work page and writes the work's own title, description and image into the head before it goes out. A shared link previews the art rather than the site. Cached for five minutes at the edge, and it falls back to the plain page if the catalog cannot be read.

## Testing

```
vercel dev --listen 3300
curl -X POST localhost:3300/api/checkout -H 'content-type: application/json' \
  -d '{"workId":"<id>","what":"digital","currency":"NZD"}'
```

Card `4242 4242 4242 4242`, any future expiry, any CVC. For the webhook locally, `stripe listen --forward-to localhost:3300/api/webhook` gives you a different signing secret to put in `.env.local`.

The ledger can be exercised before the real token exists by pointing `GITHUB_API_BASE` at a stand-in that implements the same compare and swap. The whole reserve loop was run that way: hold taken, a second buyer refused, reminder sent once and not repeated, hold released on expiry, work back on sale, with a readable commit for each step.

Nothing sells until a work has a price. `pricing_nzd` is null everywhere in the catalog today, so the button reads "Enquire about this artwork" and opens an email instead.
