# OG-IMAGES — link previews as exhibition posters

Every shared link renders a live-generated 1200 × 630 card in the house style. One template family, generated per request from the catalog... never pre-rendered batches, never stale.

## Engine
1. **@vercel/og (Satori)** edge function at `/api/og`... params identify the page (work id, collection slug, collector slug, or a page key). Renders JSX with the real self-hosted Geist + Geist Mono woff files to PNG. Edge-cached with a sensible TTL (an hour) + cache key including the work's status and price so a sale busts the cache naturally.
2. Meta on every page: `og:image` → the function URL, `og:title` → `{Title} · MintFace`, `og:description` → the collection statement (short form), `twitter:card` → summary_large_image. Supersedes the earlier per-page OG meta work... one system.
3. Artwork source: the R2 web asset. Animated works use their still frame. Letterbox on the site's warm white to fit... never crop a work, never stretch. Extreme ratios (the strip-like paintings) letterbox generously; the card design absorbs it.

## The card — shared anatomy
Left: the artwork, full height, letterboxed on warm white. Hairline rule. Right panel: Geist for the title, Geist Mono small caps for data lines, black logo mark small at bottom-right of panel, `39.64°S 176.85°E` beneath it. Ink only... the single green dot is the one color, and only on AVAILABLE. It should read as a work page compressed to a poster.

## Variants
4. **Work, available**:
   TITLE
   COLLECTION · YEAR
   US$4,475 · 1.4 ETH   (USD from live FX + the ETH figure; digital price... the entry price; painting/both stay on the page)
   ● AVAILABLE
5. **Work, collected**:
   TITLE
   COLLECTION · YEAR
   COLLECTED BY DSANCHES-VAULT.ETH   (display name where Ryan's overlay has one)
   No price, no dot. The provenance is the poster.
6. **Work, other states**: VAULTED · MINTESTATE.ETH / RESERVED / SOLD OUT as the third line, house language, no price.
7. **Collection**: cover work (available-first rule) large; right panel: COLLECTION NAME / YEAR · GENRE · N WORKS / N AVAILABLE with dot when > 0. Features use their statement line instead of counts. Sold-out collections show MINT SOLD OUT.
8. **Collector** (collectors.mintface.art pages): their top work (highest-TAO holding) as the image; panel: NAME OR ENS / N WORKS · TAO 1,491,771 / RANK 1. Private collectors get no card (generic site card instead).
9. **Site-level pages** (home, /collections, /ai, /genesis, /10k, set pages): a curated hero work + the page's own line... /ai uses the royalty statement, features use their captions. Config-driven, not hardcoded.

## Acceptance
10. Render and eyeball: one available work (price + dot correct), one collected (attribution correct), one vaulted, one collection, one feature, one collector card. Check the letterboxing on a very wide painting and a square SVG.
11. Buy-flow truth test: flip a test work's status and confirm the card updates after cache TTL... a Monday AVAILABLE share must read COLLECTED after Tuesday's sale.
12. Validate with an OG preview tool + a real paste into X/Discord before announcing anywhere... platforms cache hard; first impressions persist.
13. Confirm font loading works in the edge runtime (Satori needs the font buffers passed explicitly) and that FX for the USD figure is the same cached rate the site uses... never a second FX source.
