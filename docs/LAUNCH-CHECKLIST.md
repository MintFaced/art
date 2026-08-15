# mintface.art — launch checklist

## Phase 1 — Catalog (Claude Code session 1)
- [ ] Expand all truncated contract addresses to full 0x
- [ ] Enumerate every token: ETH contracts + Ordinals (FROGDNA, Recursive Mind)
- [ ] Resolve current owners + ENS... available vs acquired flags
- [ ] Enumerate mintestate.eth → Vault list
- [ ] Verify Foundation 1/1 count (canon: 8)
- [ ] Pull mint timestamps: City vs Nature (2021-04-25), first Geodetic Moments (Aug 2021), 10k Project (2022-05-07)
- [ ] Confirm commemoration edition standard (0xe125...780 token 2)
- [ ] Output complete catalog.json... hero flags on 5-8 curated works

## Ryan overlay
- [ ] NZD prices per work (digital / painting / both for physicals; digital for rest)
- [ ] Physical dimensions W × H × D cm, ready-to-hang, framed, certificate per painting
- [ ] Which physicals already shipped to collectors
- [ ] Collector real names mapped to wallets... anonymity list
- [ ] One-line statements: PixelArcade, Artificial Flowers, Patrimora, FROGDNA, Recursive Mind
- [ ] Review Genesis + 10k drafts final pass... Matthew fact-check + link preference

## Plumbing (parallel)
- [ ] Stripe: confirm NZD account handles USD presentment; enable Checkout
- [ ] Cloudflare R2 bucket created; folder structure per catalog slugs
- [ ] High-res uploads to R2 (list generated after Phase 1)
- [ ] Vercel env vars: STRIPE keys, FX API, ASSETS_BASE
- [ ] Confirm mintface.eth as ETH receive wallet... hardware-signed transfer flow for NFT delivery

## Phase 2 — Build (Claude Code sessions)
- [ ] Work page (the product) with all 5 states
- [ ] Collection grids + filters + inline prices
- [ ] Geodetic set page (On-Chain first, Studies annexed)
- [ ] Genesis + 10k feature pages
- [ ] Vault + Exhibitions + Provenance (preserve current table)
- [ ] Recent Work + scripts/add-work.mjs
- [ ] Checkout: Stripe NZD → Stripe USD → Reserve → ETH connect-wallet
- [ ] Reserve expiry: day-12 reminder email, day-14 auto-release
- [ ] FX: hourly cached NZD→USD/ETH, "converted from NZD" note

## Pre-launch tests
- [ ] Buy a cheap work via each path: Stripe NZD, Stripe USD, ETH
- [ ] Reserve → expire cycle end to end
- [ ] Acquired state flips correctly + collector attribution renders
- [ ] Vaulted + Sold Out states render
- [ ] Mobile pass on the Hafftka layout... every work page
- [ ] Lighthouse: images lazy-loaded, LCP under 2.5s on 4G
- [ ] OG images per work for sharing
- [ ] 301s from any old mintface.art URLs that ranked

## Launch
- [ ] Flip domain on Vercel
- [ ] Announce: one work, one link... let the site speak
