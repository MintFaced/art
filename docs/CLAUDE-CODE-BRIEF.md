# mintface.art rebuild — Claude Code brief

Drop this + catalog.seed.json + genesis-draft.md into the MintFaced/art repo and point Claude Code at it.

## Context
- Repo: github.com/MintFaced/art ... single-file static site, Vercel auto-deploy, no build step. Keep that ethos.
- Rebuild mintface.art entirely. Light aesthetic (current Hafftka reference but light, not dark). Near-zero text. Art edge-to-edge.
- catalog.json is the single source of truth. Everything renders from it.

## Phase 1 — Catalog enumeration (heavy lifting)
1. Expand truncated contract addresses in catalog.seed.json to full 0x addresses via OpenSea / chain lookups.
2. Enumerate every token per contract: title, token_id, image, animation_url, metadata, current owner.
3. Resolve owner ENS names. Mark works held by mintface.eth / ryanj.eth as available; others as acquired.
4. Enumerate mintestate.eth holdings for The Vault (status: vaulted, not for sale, 10-year hold, bloodline inheritance).
5. Pull exact mint timestamps: City vs Nature (2021-04-25, Rarible, ERC-1155) and first Geodetic Moments mint (Aug 2021) for the Genesis timeline.
6. Bitcoin side: FROGDNA + Recursive Mind are Ordinals ... enumerate via Hiro/ord APIs.
7. Output: full catalog.json. Ryan then overlays NZD prices, physical dimensions, collector display names.

## Phase 2 — Site
- Sections: Collections (Core 8) / The Geodetic Collections (5 + Geodetic Illusions as Studies annex) / AI Studies (Visual Language, Panoptic, WALLΞT) / Genesis feature (City vs Nature → Foundation 1/1s) / 2022 10k Project feature / The Vault / Recent Work / Exhibition History.
- Work page: image first. Saatchi-style fold-away table (Description | Details tabs; Availability, Year, Medium, Dimensions, Edition, contract/token provenance). Hafftka pricing rows where physical exists: Digital / Painting / Both Together. Exact prices. NZD master, live FX to USD + ETH (cached hourly, client-side).
- States: Available → [Acquire] ... Reserved (14-day free hold, shows quietly) ... Acquired (collector name/.eth, classy, with Ryan's optional note) ... Vaulted (not for sale) ... Sold Out badge for Geodetica, Geodetic Moments, Geodetic Home.
- Checkout: Stripe NZD, Stripe USD, Reserve (email capture, 14-day expiry), ETH connect-wallet (buyer pays, NFT transfers from mintface.eth, shipping arranged after if physical).
- Shipping line (only text needed): worldwide, boxing/crating/freight included.
- Filters on browse: size, price, orientation, medium, availability.
- Recent Work: scripts/add-work.mjs ... drop image in assets/, answer prompts, appends to catalog.json, commit+push deploys.
- Fonts/feel: serif display for titles + prices (see Hafftka screenshot), letter-spaced small caps labels, generous white space.

## Constraints
- Static-first. No server unless Stripe webhooks demand it (use Vercel functions minimally for checkout session + reserve).
- ASSETS_BASE stays a one-line switch (Cloudflare R2 target).
- No em-dashes in any site copy... ellipses. No corporate language.
