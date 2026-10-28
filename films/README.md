# Films

Four 20-second films and a 60-second cut for X, built from mintface.art's real data (brief: `FILMS.md` in the repo root). Remotion, kept out of the deploy (`.vercelignore`).

```
cd films && npm install        # once
npm run films                  # from the repo root: pull, capture, secret-grep, render
```

| Step | What it does |
|---|---|
| `data/pull.ts` | Snapshot of the real data → `data/snapshot.json`, `data/credits.json`; pictures into `public/snap` from our own R2 |
| `capture.ts` | DPR 2 captures of the real pages → `public/cap`, with the boxes the illustrations assemble into → `data/captures.json` |
| `secret-grep.ts` | Fails on anything naming the //Strips method, and on em-dashes in the copy |
| `render.ts` | `out/*.mp4` (H.264, 1080p60, for X), only for films whose inputs changed. `--prores` adds ProRes 422 HQ masters |
| `review.ts` | Stills for frame-by-frame review: `node review.ts 01-strips --every 0.25` |

All copy and timings are in `script.json`. Change a film's block and only that film and the 60-second cut re-render.

`data/street.json` is the one-off registration of the //Strips street photos (`data/register-street.py`, `data/street-swatches.py`, OpenCV, run once per site).

Playwright and the headless Chromium come from this machine rather than this package: set `PLAYWRIGHT_FROM` (a package.json that has Playwright) and `REMOTION_BROWSER` if they live somewhere else.
