# LINE-RESTYLE.md

Full visual refresh of theline.wtf toward a MoMA-style system: white ground, black Franklin grotesque, one accent, hairlines, whitespace. Reference screenshots in this repo under `design/moma/` (Ryan's five screenshots... drop them there).

**Hard rule: no structural or content changes.** Same routes, same components, same section order, same copy, same data. This is fonts, colors, sizes, spacing, and the removal of decorative chrome. If a change requires touching markup semantics or moving content, stop and flag it.

---

## Design tokens (build these first)

Single source of truth. Everything below routes through CSS variables (or the Tailwind theme if that's what the site uses... match the existing mechanism, don't introduce a second one).

```
--bg:            #ffffff
--ink:           #111111        near-black, never pure #000 for body
--muted:         #757575        meta text, dates, counts
--hairline:      #e5e5e5        1px rules, table row separators
--accent:        (existing Line gold)   buttons + connected-wallet state ONLY
--accent-ink:    #111111        text on accent
```

Type:
```
--font-sans:     'Libre Franklin', -apple-system, sans-serif
--font-mono:     (keep existing mono)   wallet addresses + numeric table columns ONLY
```
- Load Libre Franklin weights 400, 600, 800 (self-host the woff2s, no Google Fonts request... privacy + speed).
- Kill the serif entirely. Kill letterspaced-caps as a style (nav, headers, buttons all lose the tracking).

Type scale (desktop / mobile):
```
--t-hero:    64/40px  w800  tight leading (~1.0)    page titles: "Welcome"-class
--t-h1:      40/32px  w800                          section headers: The Artist, The Works, The Collectors, The Line
--t-h2:      24/20px  w800                          card titles, artist names in lists
--t-body:    17/16px  w400  leading 1.5
--t-meta:    14px     w400  --muted
--t-label:   14px     w600                          buttons, nav
```

Spacing: 8px base unit. Section gaps ~96px desktop / 56px mobile. Content max-width ~1200px, left-aligned, generous right rag... MoMA never centers.

## Theme decision

One theme, light, everywhere... including Storyline, Gallery, TAO boards, and page chrome around 3D embeds. The 3D canvases themselves are untouched. No dark mode, no per-section exceptions. (If a specific art surface genuinely dies on white, flag it with a screenshot rather than silently keeping it dark.)

## Component translations

- **Nav**: white bar, black w600 labels, sentence case ("Artists" not "ARTISTS"). Active page = 2px black underline (MoMA-style). Wallet chip: the one accent element in the header... accent bg, black text, no border. The 0–1000 slider stays functionally, restyled to hairline + black handle.
- **Buttons**: primary = solid accent, black text, square corners, w600 sentence case. Secondary = 1px black border, white bg. The gold-outline `ALL COLLECTORS →` / `ENTER THE LINE …` buttons become secondary style, arrow kept, tracking removed.
- **Section headers**: roman numerals stay (they're structure), restyled: numeral small in --muted, title in --t-h1 w800. No serif.
- **Image-backed heroes (exception to black-on-white)**: wherever a title block sits over artwork, all text in that block is near-white, not black:
  ```
  --ink-on-image:   #f5f5f5
  --muted-on-image: rgba(245,245,245,0.72)
  ```
  Applies to: the artist profile hero on every profile (TL numbers + medium line, artist name, Verified Artist tag... e.g. /artists/tokyo-luv) and the Storyline article hero (category/read-time line + headline... e.g. /storyline/fotofest-geodetic-moments-leith-jennings), plus any other title-over-image surface found in the sweep. Same type scale and weights as the light system, only the ink swaps. If legibility needs help, a subtle bottom-up black gradient scrim (max 40% at the baseline, fading to 0 by mid-image) is allowed; no text shadows. Below the hero, the page returns to black-on-white immediately.
- **Tables (TAO boards, top-10)**: white bg, hairline row separators, no row hover fill darker than #fafafa. Column heads --t-meta sentence case. TAO figures + `1/1 · ED` + addresses in mono; names in sans w600. Rank in --muted. 6529 pill and X mark stay, monochrome.
- **Cards/lists (artists index, works)**: MoMA collection-grid pattern... image unadorned, name w800 below, meta in --muted. No borders, no shadows, no rounded corners anywhere on the site.
- **Hairlines** replace every current border/box/rule. If something needs separation, it gets one 1px --hairline line or whitespace, nothing else.
- **Footer**: white, hairline top rule, --t-meta.

## Rollout order

1. **Tokens + font** in, nothing else... site will look half-changed, that's fine on a branch.
2. **Pilot: home page + `/artists/apocalypse` (profile incl. The Collectors) + `/artists/apocalypse/tao` (board).** Deploy to preview, stop, Ryan reviews by eye.
3. On approval: **Artists index, Storyline, Gallery, Collect, About, Join**, and every page under those tabs. Sweep for hardcoded colors/fonts that bypass tokens... grep for hex values and font-family declarations outside the token file, migrate them.
4. Final pass: 404/empty states, "being prepared" placeholders, form inputs, the /tao pages fleet-wide.

## Acceptance (pilot)

- Zero serif, zero letterspaced caps, zero dark surfaces (image-backed heroes excepted), zero rounded corners/shadows on the pilot pages.
- Hero text on profiles and Storyline articles is --ink-on-image over the artwork, legible on both light and dark artworks (check tokyo-luv and one pale-image artist).
- Gold appears exactly twice per page class: primary buttons, wallet chip.
- Side-by-side with `design/moma/` screenshots: a stranger should read them as the same family.
- Mobile: hero and h1 scale down per the table, tables don't overflow.
- Lighthouse: no regression from font loading (self-hosted, `font-display: swap`, preload the two weights above the fold).

## Out of scope

- Any copy, route, data, or component-structure change.
- The 3D environments' internals.
- Dark mode.
- Logo/wordmark redesign... "THE LINE" set in Libre Franklin w800 is the wordmark for now.
