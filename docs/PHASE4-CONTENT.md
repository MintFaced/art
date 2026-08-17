# PHASE4 — content + infrastructure updates

Drop into docs/ with geodetic-moment-light-datauri.txt alongside.

## 1. Geodetic Moment Light — recovered
- geodetic-onchain-1 image = the data URI in docs/geodetic-moment-light-datauri.txt.
- Provenance note on the work page: "Reconstructed from on-chain data. On-chain URI repair pending."
- Recovery basis (for the build log): the fill path is derivable from the surviving outline path via the generator's own rule (verified byte-exact against Dark's structure and against all 844 surviving bytes of Light's truncated path). Figure fill uses Dark's geometry, inverted colors: white field, black figure, matching Dark's black field / white figure.

## 2. assets.mintface.art — going live
- Zone is active on Cloudflare (ryleigh + hank nameservers confirmed answering; A, www, collectors, all four email records verified resolving).
- R2 custom domain assets.mintface.art attached, status Initializing... Cloudflare is issuing the cert. Poll until Active, then set ASSETS_BASE=https://assets.mintface.art and verify assets serve over it.
- R2 write credentials: already in Vercel env vars. Run `vercel env pull` and check actual var names before claiming they're missing.
- Then run the warm script: walk the catalog, fetch every image/animation from origin (chain/IPFS/OpenSea/Arweave), upload to R2 keyed by work id, fall back to origin URL on failure, log failures.

## 3. /c/frogdna feature page — content extracted, build it
Genesis long-scroll format. Ryan's rulings: physical is acquired (S & A Novak)... drop the burn-42 mechanic entirely. Content from frogdna.com, structured:

- Hero: FROGDNA image. Subline: FakeRare · Series 18 · Card 9.
- **DNA of a Pixelated Frog**: the largest FakeRare painting at 1.65m tall.
- **Sampling**: Pepe sampled from 88 Pepe cards across Series 0, 1 and 2 of the Fake Rare directory. Samples sequenced into 88 pixels via a greedy AI algorithm. Each pixel color-matched, then hand-painted.
- **The translation** (existing collection statement): re-grounding the pixel in the material world... digital hex codes into the richness of physical paint. Each color began as a precise digital value, interpreted into painterly recipes... the language of screens into the textures of brush and pigment. Our digital addiction plainly seen inhabiting a physical reality.
- **1966 · Gerhard Richter**: in conversation with Richter's Color Charts (1966), industrial colors arrayed into grids questioning perception, chance, and order. While Richter reorders an industrial reality, MintFace reorders our digital preoccupation.
- **Lineage**: began with 10k Project, minted May 7th 2022 (link the /10k feature). Seize and Share (June 2022) followed... a reinterpretation of 6529 Seizing Meme #1, the pixel as networked art object (link the archive page).
- **2025 · Exhibition**: FROGDNA exhibited at The Line, New Zealand.
- **Availability**: physical 1/1 collected (S & A Novak). Digital: 88 editions on the FakeRare collection, via the existing BTC dispenser + ETH EmblemVault buy paths. Keep the work-page checkout intact on the feature page.
- Airdrop paragraph (rarest 24 Seize and Share pixels) — omit unless Ryan says the airdrop still stands.
- Images: frogdna.com/assets/images image01 (hero), image02, image05, image03... pull to R2, don't hotlink.

## 4. Geodetic Moments 22 lazy-minted
- NZD is master. Convert 0.1 ETH at current rate, round clean, write pricing_nzd. FX display quotes ETH live like every other work.

## 5. Still open from Phase 3/earlier
- Item 6: year / medium / price filters + Available–Collected–Vaulted control on all collection pages.
- Item 9: minimal loading indicator... hairline bar, small-caps percentage.
- MintCherry + NFT Time - gn images: backlog, low priority.
- Hero pool proposals (6 collected + 6 available) still owed to Ryan for approval.

## Order
Light image (1) and FROGDNA page (3) are content-visible... do first. Then 4, 6, 9. Infrastructure (2) as soon as the domain shows Active. Report per item.
