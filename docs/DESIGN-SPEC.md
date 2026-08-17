# mintface.art — IA + design spec v1

Companion to CLAUDE-CODE-BRIEF.md. This is the "what it feels like" document.

## Principles
- The art is the interface. Everything else recedes.
- Light. Warm white (#FAFAF7 territory), near-black text, one accent used almost never.
- Near-zero text. Where text is unavoidable, it folds away Saatchi-style... a single word until opened.
- One quiet action per state. Never two buttons competing.
- Serif display for titles and prices (the Hafftka move, inverted to light). Letter-spaced small-caps for labels. System sans for the few functional strings.
- No em-dashes anywhere on the site... ellipses. No corporate language. Ever.

## Sitemap
```
/                       Home
/collections            Index (all groups)
/c/{slug}               Collection page
/w/{id}                 Work page
/genesis                Feature: City vs Nature → Foundation 1/1s
/10k                    Feature: 2022 (10k Project)
/vault                  The Vault (mintestate.eth)
/recent                 Recent Work
/exhibitions            Exhibition history
/provenance             Chain records table (preserved from current site)
```

## Home
- Full-bleed hero: one rotating work (curated list in catalog: `hero: true`).
- Then the collections as a quiet grid... title, year, one-line statement, count. Grouped: Core / Geodetic / AI Studies / Features / Vault / Recent.
- Footer: MintFace ... exhibitions ... provenance ... contact. Nothing else.

## Collection page
- Statement line, then the grid. Edge-to-edge images, generous gutters.
- Filter bar (only where useful, i.e. >12 works): Size / Price / Orientation / Medium / Availability. Collapsed to one row of small-caps words; taps open inline.
- Sold-out collections (Geodetica, Geodetic Moments, Geodetic Home) show a single quiet "Sold out" badge at top... grid still browsable, works show collectors.
- Geodetic set page: the five collections, then "Studies" as a smaller annexed row (Geodetic Illusions).

## Work page (the core of the site)
1. **Image first.** Full-width, tall. AR/animation works get inline player under the still.
2. **Title** in serif display.
3. **Tabs: DESCRIPTION | DETAILS** (small caps, underline active... exactly as the Hafftka screenshot).
   - DETAILS table rows: Availability (dot + word) / Year / Medium / Dimensions / Edition / Animation (if any).
   - Provenance folded row: "PROVENANCE" opens contract, standard, token ID, mint date, links (Etherscan/OpenSea/ord).
4. **PRICING** block, serif prices, right-aligned:
   - Physical collections: Digital / Painting / Both Together.
   - Digital-only: one row.
   - Currency toggle: NZD · USD · ETH (small caps, NZD default, live FX cached hourly, note "converted from NZD").
5. **Action** (one button, state-driven):
   - Available → `Acquire this artwork`
   - Reserved → small-caps line: "RESERVED UNTIL {date}" ... no button.
   - Acquired → "COLLECTED BY {name or .eth}" + optional one-line note from Ryan. No button. Classy, final.
   - Vaulted → "VAULTED · MINTESTATE.ETH" + one line: not for sale for at least 10 years.
   - Sold out editions → "SOLD OUT".
6. **Shipping** folded row (physical only): "Worldwide. Boxing, crating and freight included."

## Acquire flow (modal or slide-over, never a new page)
Step 1 ... choose what: Digital / Painting / Both (physical works only).
Step 2 ... choose how:
- **Card (NZD)** → Stripe Checkout, NZD.
- **Card (USD)** → Stripe Checkout, USD.
- **Reserve 14 days** → name + email, no payment. Work flips to Reserved. Auto-expires day 14, email reminder day 12.
- **ETH** → connect wallet, pay to mintface.eth, NFT transfers on confirmation. If painting included: "We'll be in touch within 24 hours to arrange shipping."
Post-purchase: work flips to Acquired, collector attribution appears (ENS auto, name if Ryan overlays).

## Features (Genesis, 10k)
- Long-scroll pages. Big type, the drafted stories, works inline at full width as they're mentioned, chain timestamps as small-caps captions ("MINTED APRIL 25TH 2021 · RARIBLE").
- These are the only two text-rich pages on the site. Earn it.

## The Vault
- Dark-on-light inversion is tempting... resist. Same light system, but works shown with a fine border and "VAULTED" caption.
- One paragraph at top: the 10-year hold, the bloodline inheritance. That's the whole story... let it be short and strong.

## Recent Work
- Reverse-chron grid. Each new painting gets full work-page treatment immediately.
- `scripts/add-work.mjs`: drop image → answer 6 prompts (title, year, medium, dims, price, collection or recent) → commit → live.

## Exhibitions
- The preserved history as a spare timeline. Year, title, venue. NZ Herald mention kept.

## Mobile
- Everything single column. Filter bar becomes one "FILTER" word. Pricing block full width. The Hafftka screenshot is already the mobile layout... build to it.

## Type suggestion (pending your veto)
- Display serif: Freight Display, Canela, or GT Sectra... or stay free with Playfair Display.
- Labels: same sans as current site, letter-spaced 0.15em, 11px small caps.

## Locked design decisions
- Accent: ink only. The availability dot is the single green on the site.
- Hero: one rotating curated work per visit (`hero: true` in catalog).
- Prices: inline on collection grids... browsing becomes buying.
- Geodetic set ordering: Geodetic On-Chain first (the master moulds), then World, Geodetica, Moments, Home, Memory, then Studies annex (Illusions).
