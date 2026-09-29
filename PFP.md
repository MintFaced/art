# PFP · hexagon profile pictures

Every collector gets a face. A hexagon, in the site's own quiet language, filled from wherever the collector already has a picture, and swappable with one tap.

---

## The hexagon
- Pointy-top regular hexagon, clipped with an SVG clipPath (one shared component, used at every size). No border at rest. No shadow. Sizes: 120 (profile header), 32 (register + ledger rows), 28 (studio chat, beside the name), 22 (nav menu), 160 (OG cards).
- Image: 512×512 webp in R2, centre-cropped, lazy-loaded with srcset for the small sizes. One asset per collector, regenerated whenever the source changes.
- Hover / tap (200ms ease-out): the hexagon's outline draws itself around the picture (1px ink, stroke-dashoffset animation) and the picture lifts 2px. That's the whole rest-state interaction. Same on tap for touch, releasing on tap-end.

## Where it appears
- Collector profile header: 120px, left of the name, vertically centred on the name line. The green dot stays where it is.
- Register (collectors.mintface.art index): 32px in the COLLECTOR column, before the name. Mobile keeps it.
- Nudge ledger and "every change" rows: 32px.
- Studio chat: 28px beside the author name on the first message of a run. Replies and quoted parents show it at 22px.
- Nav menu (signed in): 22px beside your name.
- Collector OG card: 160px hexagon on the left, name and TAO to the right.
- Tweet-bot cards for weigh-ins and locks: the backer's hexagon beside their handle when a picture exists; nothing when it doesn't (absence is silent).

## Sources, in order
1. **Uploaded** by the collector (or the artist).
2. **OpenSea** profile image: OpenSea API v2 `GET /api/v2/accounts/{address}` → `profile_image_url`. Use the existing OpenSea API route and key. Skip OpenSea's default placeholder avatars (detect the default-avatar host/pattern and treat as none).
3. **ENS avatar** text record, for collectors with an ENS name (handles `https`, `ipfs://`, and `eip155:…/erc721:…` NFT avatars via the existing image pipeline).
4. **X** profile image, for accounts with a verified X link: `profile_image_url` from users/me, with the `_normal` suffix removed to get full size.
5. **Placeholder**: the collector's longest-held work, rendered inside the hexagon at 35% opacity over paper. On your own profile it carries a small mono line beneath: "ADD A PICTURE". On anyone else's, nothing.

Every fetched image passes through the same pipeline as uploads: fetched server-side, re-encoded, metadata dropped, resized to 512, stored in R2. Never hotlink OpenSea or X.

## Backfill and refresh
- One-off backfill: all collectors on the register, in batches inside OpenSea's rate limits, starting from rank 1 so the top of the register fills first. Log hits per source.
- Refresh: monthly cron re-checks sources 2–4 for collectors without an upload, and only replaces the picture if the source changed. Uploaded pictures are never overwritten by a refresh.
- Store on the profile: `pfp_source` (upload | opensea | ens | x | none), `pfp_url`, `pfp_updated`, `pfp_uploaded_by` (self | artist).

## Upload
- Tap your own hexagon (profile header, or the nav menu) → picker. Accepts JPEG, PNG, WebP, HEIC (converted server-side). Max 12MB.
- Inline crop, in the hexagon itself: drag to position, pinch or scroll to zoom, within the same panel. No filters, no rotation controls (EXIF orientation is applied automatically). SAVE / CANCEL.
- After saving, the new picture fades in everywhere it's rendered on the page.
- USE OPENSEA / USE ENS / USE X / REMOVE as small mono options under the crop, so a collector can switch back to an auto source. REMOVE returns them to the placeholder and sets source none, which the refresh respects (it won't re-fill someone who chose none).
- Auth: SIWE session or X session with a linked wallet, own profile only.

## Artist master rights
- /mintwork collector overlay gains a PFP block: upload, pick a source, remove. Same crop UI.
- `pfp_uploaded_by: artist` is recorded but not shown. If the collector later uploads their own, theirs wins from then on.
- Artist can remove any picture (moderation). No public notice.

## The magic
- **Press and hold** (or hover 600ms on desktop) on any hexagon with a real picture: it crossfades to the collector's longest-held work, with a mono caption beneath: "HELD 412 DAYS · GEODETIC WORLD 14". Release, and it fades back. The picture is who they are; the hold is what they've kept. Works on the profile header and register rows. Off in chat, where it would be noise.
- **First reveal**: on a collector's own profile, the first time the backfilled picture is shown to them (flag on the session), the hexagon draws its outline once, unprompted, then settles. A one-time hello. Never again.
- **Register row hover**: the hexagon outline draws, nothing else moves. Rows stay calm.
- Nothing rotates, bounces, or glows. The green dot remains the only colour that isn't the art or the person.

## Acceptance
- visco.eth (rank 1) shows an OpenSea, ENS or X picture after backfill without anyone uploading. A collector with none of the three shows the placeholder work.
- Upload from iPhone: HEIC in, crop in the hexagon, saved, EXIF absent in R2, renders in header, register, chat, nav and OG card within one deploy.
- USE X after an upload switches the source; REMOVE sets none and survives the monthly refresh.
- Artist sets a picture for a top-10 collector from /mintwork; that collector's own later upload replaces it.
- Press-and-hold on a header hexagon shows the longest-held work with the caption; release restores.
- Register with 3,678 rows: pictures lazy-load, no layout shift, first paint unchanged.
- No hotlinks to opensea.io or pbs.twimg.com anywhere in the DOM.

## Ryan inputs
- Confirm the source order (upload > OpenSea > ENS > X > placeholder).
- Which top collectors to set manually first, and their pictures.
- Whether tweet cards should carry hexagons from day one or wait until the register is mostly filled.
