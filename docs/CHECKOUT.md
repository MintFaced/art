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

## What still needs you

1. **`GITHUB_TOKEN`** ... a fine grained personal access token with **Contents: read and write** on `MintFaced/art`, nothing else. Without it every sale and hold returns a clear 503 saying to email you, rather than failing silently.

   ```
   vercel env add GITHUB_TOKEN production
   vercel env add GITHUB_BRANCH production     # main, or rebuild while testing
   ```

2. **Verify mintface.art in Resend** so email comes from you rather than a shared sandbox domain. A couple of DNS records. Until then Resend only delivers to your own address.

3. **`CRON_SECRET`** ... any long random string, set on the project. The reserve cron refuses unauthenticated calls once it is set.

4. **Test mode to live** when you are ready: claim the Stripe sandbox, swap the keys, and register the webhook again against the live account.

Optional: `EMAIL_FROM`, `EMAIL_TO_ARTIST`, `ETH_RECEIVE_ADDRESS` (defaults to mintface.eth), `RESERVE_DAYS` (defaults to 14).

## The Ethereum path

The buyer pays mintface.eth from their own wallet, either through the connect button or by sending it themselves and pasting the transaction hash. The function then reads the chain: right recipient, enough value, actually mined, not already used. Only then does the work flip to collected.

**No key ever touches the server.** The token is transferred by you, hardware signed, after the payment lands. `token_transfer: pending` sits in the state file until you do.

## The FROGDNA path

FROGDNA is a Counterparty asset on Bitcoin, and 30 of the 88 are wrapped in an EmblemVault on Ethereum. So its work page offers both: the ETH flow buys a wrapped edition through the wallet, and the Bitcoin option opens an email, because a Counterparty transfer is arranged by hand. Same work, same provenance, no wrapper.

## Testing

```
vercel dev --listen 3300
curl -X POST localhost:3300/api/checkout -H 'content-type: application/json' \
  -d '{"workId":"<id>","what":"digital","currency":"NZD"}'
```

Card `4242 4242 4242 4242`, any future expiry, any CVC. For the webhook locally, `stripe listen --forward-to localhost:3300/api/webhook` gives you a different signing secret to put in `.env.local`.

Nothing sells until a work has a price. `pricing_nzd` is null everywhere in the catalog today, so the button reads "Enquire about this artwork" and opens an email instead.
