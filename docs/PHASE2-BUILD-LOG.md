# Phase 2 build log

Branch: `rebuild`. Running record of what exists and the decisions behind it.

## Done

**Catalog split** ... `scripts/catalog/30-split.mjs` writes `data/index.json` (51 KB) plus `data/c/{slug}.json`. Run it after any `catalog.json` rebuild.

- Collapse rule: 4 or more works in one collection sharing a normalised title and an image become one edition record, with a `holders` array and `token_ids`. Edition numbers inside titles ("Traffic #156/1735") are stripped before matching.
- 1,879 records to 882. Geodetic Memory 832 to 1, Roads & Rivers 216 to 50. Nothing else collapses, so the 1/1 collections stay whole.
- `data/index.json` carries meta, groups, per-collection summaries with cover and counts, exhibition history, and a `work_index` map of work id to collection slug. The work page needs one index fetch plus one collection fetch.
- The Vault is left uncollapsed: its records use a different shape.

**Work page** ... `/w/{id}` via `w.html` + rewrite in `vercel.json`. Also answers `w.html?id={id}` for local preview without the rewrite.

- Image first, full bleed, capped at 86vh. Motion sits under the still.
- Description | Details tabs. Details rows: availability with dot, year, medium, dimensions, edition, resolution, motion.
- Folds: Provenance (chain, standard, contract, token id, mint date, Etherscan / OpenSea / Ordinals / Gamma / Tokenscan links), Collectors where an edition has named holders, Shipping on physical collections only.
- Pricing block with NZD, USD, ETH toggle. NZD is master, live rates from open.er-api.com and Coinbase spot, cached one hour in localStorage, "Converted from NZD" note on the non-NZD views.
- Five states plus burned: available, reserved, acquired (collector name, month acquired, Ryan's optional note), vaulted, sold out, burned.

**Shared runtime** ... `mintface.js`. `ASSETS_BASE` is the first line, currently the live R2 bucket. `MF.imageUrl()` prefers a local `assets.image` path when the catalog carries one and falls back to the chain metadata URL, so moving to R2 is a data change, not a code change.

**Collection pages** ... `/c/{slug}` via `c.html`, plus `/collections` via `collections.html`. Both answer `?slug=` for local preview without the rewrite.

- Masonry grid in CSS columns, four to one across the breakpoints, images at their own aspect ratio. Tiles carry title, availability dot and word, and the price inline the moment one exists.
- Filter bar builds itself from the data. `30-split.mjs` writes a `facets` block per collection and the bar only shows a facet with more than one value, so Availability and Orientation appear today and Price and Size appear on their own when you overlay them. Bar is hidden entirely under 13 works, per the spec.
- Orientation comes from the chain metadata's image dimensions, known for 430 of 794 works. The facet only appears when 70 percent or more of a collection can answer it, which is why Geodetic Moments has no orientation filter: the OpenSea storefront never recorded dimensions.
- Grid renders 48 at a time with an IntersectionObserver, so Patrimora at 181 and Geodetica at 100 open instantly.
- Sold out collections show a quiet badge in the header and stay fully browsable, collectors visible.
- The Vault renders through the same page. Its records now resolve to real work pages: the split matches contract plus token id against every enumerated work and links 87 of its 93 holdings. The six that stay unlinked are on contracts outside the catalog.
- `/collections` groups by the catalog's own groups, with the locked geodetic order (On-Chain, World, Geodetica, Moments, Home, Memory) and Studies annexed in a smaller row. Genesis and the 10k feature link to `/genesis` and `/10k` rather than to grids.

**Feature pages** ... `/genesis` and `/10k` via `f.html`, rewritten in `vercel.json`. Locally they answer `f.html?f=genesis`.

- The prose lives in `data/f/{slug}.json` as blocks, not in the markup, so you can edit the writing without touching HTML. Block types: `p`, `lead` (the short standalone lines, set larger), `close` (the last line), `work` (one work full bleed), `works` (a strip with a caption and an optional link onward).
- Every prose block is transcribed verbatim from `docs/genesis-draft.md` and `docs/10k-draft.md`, checked by script against the drafts. The only markup the text supports is `**emphasis**` and `[label](/path)` links, so work names in the prose link to their pages.
- Captions are built from chain data at render time, not typed: "City versus Nature ... Minted 26 April 2021 ... Rarible ... 5 editions" comes out of the catalog. Change the catalog and the captions follow.
- Genesis carries City vs Nature full bleed, then a strip of six Geodetic Moments, then all six Foundation 1/1s. 10k carries the 1/1 full bleed and a strip of the five commemoration editions.
- The builder now exposes the Genesis works properly: City versus Nature became a real work record with the id `city-vs-nature`, and the six Foundation pieces sit alongside it, so `/c/genesis` and the work pages both resolve.

**Geodetic set page** ... `/geodetic`, served directly by `geodetic.html` through cleanUrls, no rewrite needed. Linked from the group heading on `/collections`.

- Your locked order: On-Chain first as the master moulds, then World, Geodetica, Moments, Home, Memory, with Geodetic Illusions annexed under Studies in a smaller eight-across row. Order lives in `data/f/geodetic.json`, so reordering is a data edit.
- Each chapter carries its own real statement from the catalog, the counts, and a row of six works with available ones ranked first, so scrolling the set runs into what can actually be bought.
- The page opens on one 56 KB index fetch. Rows are skeletons until an IntersectionObserver pulls that collection's file in, which keeps a set page covering 347 works off the critical path.
- The set standfirst in `data/f/geodetic.json` is mine, not yours. It is marked `standfirst_needs_ryan` and is the one piece of prose on the site I wrote.

**The Vault** ... `/vault`, served by `vault.html` through cleanUrls. Linked from the collections index, and from the action block on every vaulted work.

- Light system throughout, no inversion. The idea carries in a fine border around each work and a Vaulted caption, so the page reads as kept rather than offered.
- One paragraph at the top, the intent line from the catalog, and nothing else: ten years, then the bloodline.
- The 93 holdings group by the collection each token actually belongs to, in catalog order, each chapter linking back to its collection. 88 of them resolve to their own work pages. The five that do not are Trouble Ahead and MintCherry, which are on chain but not yet placed in a collection, and they sit under "Also in the vault".
- Editions show the quantity held, so Geodetic Signal reads "Vaulted, 10 held".
- A quiet line at the foot notes the 157 works by other artists in the same wallet, since the wallet is a collection as well as a vault.

**Exhibitions** ... `/exhibitions`, a spare timeline grouped by year, venue in small caps, press and dates on a third line. The NZ Herald mention on Roads & Rivers survives. Six entries, straight from `exhibition_history` in the catalog.

**Provenance** ... `/provenance`, the old chain records table rebuilt on chain truth. Same five columns, and the intro line is preserved from the old site.

- One row per contract, not per collection, so Genesis shows both Rarible and Foundation, the 10k shows the 1/1 and the commemoration contract, and FROGDNA shows the Counterparty asset and the EmblemVault wrapper. 24 rows over 22 collections.
- Edition counts are phrased from the data rather than typed: "40 x 1/1, 2 editions, 168 minted" for Roads & Rivers, "6 x 1/1, 1 edition of 5" for Genesis. Burned tokens are excluded from those counts.
- A Wallets block underneath lists all five addresses with what each one is for, which is the question the table always raises next.

**Seize And Share archive** ... `/c/seize-and-share`, in a new `archive` group that renders quietly at the foot of `/collections` in the annex style, not in the main nav.

- Enumerated from scratch: 3,257 tokens on `0xe63f4E6CE4110A2faD3DE9ed38e7eA5858EB953b`, deployed June 2022, 860 owners. They resolve into 72 works across 46 named series, each a derivative of a meme card by another artist: 6529er, XCOPY, Seerlight, ROBNESS, Drift, Alejandro Cartagena, Helena Sarin and more.
- Each series is one record with its edition count and holders rather than one record per shard, which is what keeps a 3,257 token project readable. Freedom to Live alone is 927 tokens across 507 owners.
- The source artist shows as "After 6529er" on the grid tile and as an After row on the work page, since the credit is the point of the project.
- The vault's 123 Seize And Share holdings now resolve too, so the vault page went from 93 own works to 216.

**Recent Work** ... `/c/recent-work`, with the works living off chain until they sell.

- `data/source/recent-work.json` is the source of truth for work that has no chain record. The builder merges it into `catalog.json`; everything else in the catalog is still read from the chain, so a rebuild never clobbers it.
- `scripts/add-work.mjs` asks six questions, appends to that file, patches `catalog.json`, rebuilds the site data and prints the commit line. It checks the image is actually in the R2 bucket first and says so if it is not there yet. Works interactively or from a pipe.
- Not yet minted is stated three times over, in the places a buyer looks: a Provenance row in the details table reading "Tokenized on purchase", the provenance fold saying the work is tokenized at the moment it sells so the first owner written to chain is the collector rather than the artist, and a line under the collection statement.
- Prices work: the first priced work turns on the pricing block, the currency toggle and the Acquire button with no code change, and the price shows inline on the grid.

**Home** ... `home.html`, served at `/` by a rewrite in `vercel.json`. The old `index.html` is untouched on disk, so the swap at launch is deleting one rewrite line or renaming the file, not a rebuild.

- Full bleed hero, one work per visit, capped at 84vh with the caption underneath rather than over the art. Title, collection, availability, and the price when there is one. The whole thing links to the work.
- `data/f/home.json` holds two pools: `hero_collected` and `hero_available`. A visit takes one work from one pool, and the pools alternate visit to visit, so a collected work and an available one take turns. Falls back to a coin toss where localStorage is unavailable.
- A collected hero names the collector, since that is the point of showing it: "Collected by S & A Novak". Where there is no attribution it reads "Collected", and a vaulted work reads "Vaulted" rather than pretending the vault is a collector.
- An available hero shows availability and the price, taking whichever of both, painting or digital is actually on offer.
- Every pick is checked against live state before it renders, so a work that has sold since the list was written drops out of the available pool on its own. If the available pool empties the collected pool carries the page.
- While both pools are empty the hero falls back to a collection cover picked at random from anything with available work. It is a placeholder, not a curation, and it is marked as such in the file.
- Covers now prefer an available work over the first work in a collection, on the home page, the collections index and every card on the site. Browsing runs into what can be bought, which is the locked decision behind inline prices.
- Then the wordmark, the work count off the catalog, and the collections as a quiet grid in the same groups as `/collections`, with the geodetic set link and Studies and Archive annexed.
- Footer is exhibitions, provenance, the vault, contact. Nothing else.

The collection card, the group ordering and the route map moved into `mintface.js`, so home and the collections index render from one definition rather than two copies.

**Shared stylesheet** ... `mintface.css` now holds the tokens, chrome and availability dots. Each page keeps only its own layout rules inline.

## Decisions taken during the build

- **Motion is typed, not guessed.** Artificial Flowers animation URLs are `text/html`, Patrimora renders from an irys HTML page. Video extensions get a `<video>`, image extensions render inline, everything else is a click-to-load sandboxed iframe labelled "Open the living version". Nothing heavy loads until asked.
- **No prices in the data yet, so the block reads "On application"** and the button becomes "Enquire about this artwork". The moment `pricing_nzd` is filled the rows and the Acquire button appear with no code change. To see the priced layout before then: `?px=2400,9800,11500` fills digital, painting, both. Preview aid only.
- **Collapsed editions link to the contract**, not to one token, and show "156 tokens, #30 to #191" rather than a single token id.
- **The old provenance table had a collection the catalog did not: ID Please.** Chased it down while rebuilding the table. It is Meme Card 362, season 11, in The Memes by 6529, minted 27 August 2025, 328 editions across 232 holders, none held by your wallets. A MintFace work inside someone else's shared collection, the same shape as the Foundation 1/1s. Now enumerated and in the catalog as its own collection in the core group, with a note that placement is your call. Phase 1 missed it because it was not in the seed.
- **Sold out and available are not opposites here.** Geodetica, Geodetic Moments and Geodetic Home are flagged sold out in the seed, and all three still hold works in your wallets: 13, 14 and 1. A "Sold out" badge over a grid of buyable work is a lie to a collector, so `MF.availability()` now reads it as "Mint sold out" plus the live available count whenever both are true, and plain "Sold out" only when nothing is available. Same reading on the set page, the collection pages and the index. If the intent was that those works are not for sale, the fix is in the data: move them to mintestate.eth and they become vaulted. as "Burned ... returned to the zero address". 44 of them exist, mostly Roads & Rivers.
- **Images fall back rather than break.** Thumbnails try the proxy, drop to the master on error, and remove themselves if that fails too. Hosts that already serve sized images are skipped entirely: OpenSea's CDN, Google's, Highlight's. That matters for Geodetic Moments, whose images live on OpenSea's CDN rather than anywhere you control. Those are the works most in need of R2 masters.
- **Grids need thumbnails and the masters are unusable for browsing.** One Two Burdens JPEG is 15 MB. `MF.thumbUrl()` routes grid images through a resizing proxy set on one line in `mintface.js`, which turns that 15 MB into a 240 KB webp. When R2 holds real thumbs, put the path in the work's `assets.thumb` and the proxy is bypassed. Setting `THUMB_PROXY` to an empty string turns it off entirely.

## Addendum work (from PHASE2-NOTES)

**FROGDNA wrapped editions** ... enumerated. One EmblemVault ERC-1155 token on `0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919`, "FROGDNA | Series 18 Card 9", 30 copies across 10 holders: 14 with mintface.eth, 8 vaulted, 8 with collectors. There is no second wrapped token, so the ETH path has 14 to sell. The work record now carries `wrapped` alongside the native Counterparty data, plus `buy_paths` for the checkout phase. Provenance shows both chains.

**Geodetic Moments** ... still 78 of 100, and now proven so. The OpenSea API rejects every NFT endpoint without a key and the collection page is client rendered, so the fallback scan ran instead: 3,188 storefront ids probed, zero hits. Those 22 have no chain record of any kind. Either an OpenSea API key or your account export closes it.

**Recursive Mind** ... rebuilt to the canon of thirteen. rrrecursive.com lists all thirteen with title, motif, age and image, so each work now has a real record. Eight are inscribed, five are not. The RRRECURSIVE inscription is stored as the collection cover rather than a fourteenth work.

**New state: uninscribed.** Availability reads "Not yet inscribed", the details table carries an INSCRIPTION row saying the same, provenance shows chain and standard with no id, and the button reads "Enquire to have inscribed" and opens an enquiry. It flips to Available on its own the moment an inscription id lands in the data.

State list: Available / Reserved / Acquired / Vaulted / Sold Out / Uninscribed, plus Burned for the 44 tokens that went to the zero address.

**Checkout** ... five paths from one slide-over, documented in `docs/CHECKOUT.md`.

- Step one is what (digital, painting, both, from the catalog prices), step two is how (card NZD, card USD, Ethereum, Bitcoin for FROGDNA, or a fortnight's hold). Single-price works skip step one.
- Stripe Checkout Sessions for both card paths, dynamic payment methods, prices read server side so the browser cannot set its own. USD converts from NZD at the hour's rate.
- Fulfilment is in the webhook, not the success page, handling completed and async succeeded, gated on payment status, with async failed putting the work back on sale.
- Sale state commits to `data/state.json` through the GitHub API and the pages overlay it on the static catalog, so a sale shows without a catalog rebuild. Every sale has an author, a time and a diff.
- Ethereum: the buyer pays mintface.eth from their own wallet, the function verifies the transaction on chain, and the token is transferred by hand afterwards. No key on the server.
- Reserve is free for a fortnight, with Resend emails on hold, at day twelve, and on release, driven by a daily cron.
- Stripe and Resend are provisioned through the Vercel Marketplace and connected to the project. The webhook endpoint is registered and its signing secret stored.
- Still needs a `GITHUB_TOKEN` with contents write, or holds and sales return a clear 503 telling the buyer to email.

**Spreadsheet import** ... `scripts/import-sheet.mjs` reads `docs/mintface paintings data.xlsx` and writes `data/source/overlay.json`, which the catalog builder merges over the chain data. Hand data survives a rebuild from chain, the same way Recent Work does.

- 123 rows read, all matching a catalog id. 78 priced, 83 with dimensions, 5 collector names, 5 paintings already with a collector, 4 works digital only.
- A painting that has sold is no longer offered. The pricing block and the Acquire flow read one list, so the page cannot advertise something that has gone: FROGDNA now shows Digital $150 alone, with "With S & A Novak" against the painting.
- The sheet and the chain disagree on four works, and both are right: the painting sold, the token did not. The chain still decides the token's status; the sheet records where the painting went.

## Next, in order

1. Nothing. Every page and flow in the brief is built.

## Before launch

- Swap `/` properly: either drop the rewrite and replace `index.html` with the new home, or keep the rewrite and archive the old file. The old site is still on disk and still reachable at its other paths.
- Pick the hero works.
- Fill the five empty statements, the prices and the dimensions.
- Point `THUMB_PROXY` at R2 thumbnails.

## Open

- Per-work OG images need either a build step or a small Vercel function. Static HTML cannot do it alone.
- Recent Work is empty. Add the first painting with `node scripts/add-work.mjs`.
- The hero list in `data/f/home.json` is empty. Five to eight work ids, your call not mine.
- The set standfirst on `/geodetic` is mine and wants replacing in your voice. Everything else on the site is either yours or straight off chain.
- Grids depend on images.weserv.nl until R2 holds thumbnails. One line in `mintface.js` switches it.
- Trouble Ahead, MintCherry and AInception are on chain but not placed in any collection. They surface under "Also in the vault" where vaulted, and sit in `other_works` in the catalog.
