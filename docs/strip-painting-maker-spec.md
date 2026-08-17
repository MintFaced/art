# Strip Painting Maker ... implementation spec for mintface.art

Build the Strip Painting Maker as a page on mintface.art (repo: MintFaced/art). A working reference implementation is provided in `strip-configurator.jsx`... port it to match the repo's existing stack and page patterns rather than bolting it on as-is. Match the site's visual language: light, classy, almost no text, quiet grotesque for titles, mono for data.

## What it is

A public tool where a shop owner or landlord designs a colourway for a MintFace Strip Painting on their fascia and gets an indicative price. Colours come from the street itself... they upload a photo of the neighbouring signs and the facade above the site, and the tool samples the palette from it.

## Page

- Route: `/strip-painting-maker` (or match existing route conventions)
- Title: **Strip Painting Maker**
- Intro copy, exact: "Design a colourway for your Strip Painting by MintFace. Colours are sampled from the neighbouring signs and the facade above after uploading a photo."
- Copy voice: RWI... no em-dashes (use ellipses), fragments fine, no corporate language

## Inputs

- **Width**: metres, editable, default 6
- **Height**: mm, editable, default 550
- **Strip intensity**, three tiers:
  - Low ... ~23 strips ... 24mm grid only
  - Medium ... ~33 strips ... 12 / 24mm grid
  - High ... 55 strips ... 6 / 12 / 24mm grid (the Strip Painting No. 1 spec)
- **Sequence slider**: calm (0) to vibrant (100), default 70
- **Site photo**: image upload

## The red line ... hard rule

- The 16th strip **from the bottom** is always `#d32011`, always 12mm
- Labelled "red line" everywhere in UI and spec output... never "memorial" in public copy
- Marked in the preview ("16") and flagged in the copied spec as `RED LINE (16th from bottom)`

## Palette

- On photo upload: downsample, bucket-quantize (4-bit per channel), take top 12 distinct dominant colours with frequency as dominance weight
- Tap the photo to sample a specific colour... replaces the least dominant swatch when full (max 12)
- Tap a swatch to remove it (minimum 4 colours)
- No photo yet: default to the Strip Painting No. 1 palette with weights equal to each colour's mm share of the wall (see reference jsx `DEFAULT_PALETTE`)
- The red line is always additional to the 12, shown separately in the palette row

## Strip generation

- Bottom-up fill to exactly the entered height, strip heights snapped to the intensity's grid, remainder absorbed into the final strip
- Colour choice is weighted random, seeded (mulberry32) so Regenerate is reproducible and the slider morphs one design rather than reshuffling
- Dominant colours lean toward larger strip heights
- Sequence slider drives adjacency scoring:
  - score = weight × (0.1 + (1 − vib) × 0.6 + vib × 4 × contrast²)
  - contrast = 0.5 × normalised RGB distance + 0.5 × normalised luminance jump vs the previous strip
  - calm end additionally allows same-colour doubled strips (~12% when vib < 0.45)... the paired-run feel of No. 1
- Preview renders strips top-down at fixed height, labelled "preview not to scale"

## Pricing

- NZD, rate per metre at 550mm height, scaled linearly by height factor (height ÷ 550):
  - High: $1,000 / m
  - Medium: $800 / m
  - Low: $650 / m
- Show the working: rate, width, height factor, estimated days on site (High 1.17 / Medium 0.83 / Low 0.67 days per metre × height factor), then total
- Footer copy, exact: "High $1,000/m ... Medium $800/m ... Low $650/m, scaled by height. Prices are indicative ... every commission is quoted after a site visit."
- Do NOT publish the cost breakdown (labour rate, paint, ply) anywhere on the page

## Actions

- **Regenerate pattern**: new seed
- **Copy spec**: plain-text spec to clipboard... dimensions, intensity, sequence setting, strip count, price working, then the full bottom-up strip list (`NN  #hex  HHmm`), red line flagged
- Enquiry path: TBD by Ryan... likely "email the spec to ryan@ryanjennings.net" as v1, Stripe deposit later. Leave a clear TODO if unresolved.

## Acceptance checks

- Height 550, High: strip count lands at ~55 and heights sum exactly to input height
- Strip 16 from bottom is #d32011 at 12mm at every intensity and any height ≥ ~400mm
- Slider at 0 vs 100 on the same seed produces visibly calmer vs higher-contrast adjacencies without a full reshuffle
- Photo upload replaces the default palette only when ≥ 4 colours extract cleanly
- Copied spec round-trips everything needed to recreate the design
- Mobile: preview, slider, and photo tap-sampling all usable at phone width

## Reference

- `strip-configurator.jsx` ... working single-file React implementation of all of the above, inline styles. Treat logic as canonical, styling as a starting point to be reconciled with the site's system.
