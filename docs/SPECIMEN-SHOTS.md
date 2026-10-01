# Specimen shots · Strip Paintings

Every site gets the same photographs, taken the same way, so the plates on
/c/strip-paintings and in the dossier read as one set. Up to four frames per
site. A missing frame isn't a gap on the page: the plate shows what exists and
leaves the rest out.

## The four frames

**Gallery.** The painting on The Line's wall.
- Frontal: camera square to the wall, painting level, no keystone.
- Even light, no hotspots or reflections across the strips.
- No spectators.
- Leave a margin of wall all round. The page crops to a 420 px tall frame on
  desktop and 4:3 on a phone.

**Before.** The empty fascia, before the painting goes up.
- Daytime, straight on, the fascia centred left to right and a little above
  the middle of the frame.
- No vehicles if possible; wait for the gap.
- **Mark the spot.** The After is taken from exactly here. Note the paving
  joint, kerb mark or pole you stood against, and the lens or zoom
  (phone: 1×, never the ultra-wide).

**After.** The same fascia with the painting installed.
- The same standing position, lens and framing as the Before. The page lays
  the two over each other with a slider, so any shift in position shows as a
  jump at the line.
- Daytime, similar light to the Before (same time of day if you can).
- The first site's After is the page hero and the link-preview picture, so
  shoot it wide enough to crop to a banner.

**Detail.** The painted surface close up.
- Raking light from one side, low and across the strips, so the edges and
  brushwork show.
- Close, a handful of strips filling the frame. Include the red line where
  it falls naturally.

## Files

- Name: `strip-{no}-{gallery|before|after|detail}.jpg`, where `{no}` is the
  site number in `data/strip-sites.json` (1 to 9), e.g. `strip-1-after.jpg`.
- JPEG, long edge 2400–4000 px, sRGB.
- Upload to R2 under `strip-paintings/`, then set the key on the site:

  ```json
  "specimens": { "gallery": "strip-paintings/strip-1-gallery.jpg", "before": "strip-paintings/strip-1-before.jpg", "after": "strip-paintings/strip-1-after.jpg", "detail": "strip-paintings/strip-1-detail.jpg" }
  ```

That is the whole step: the page, the register's SPECIMENS column and the
dossier all read the keys. Before and After together turn on the slider;
either one alone shows plain with its label.

## What the page does with them

| Frames present | Plate shows |
|---|---|
| Gallery | In the gallery |
| Before + After | Slider: AFTER · DRAG · BEFORE |
| Before or After alone | That photograph, labelled |
| Detail | A further figure, "Detail · raking light" |
| None | The painting's render band and its facts only |
