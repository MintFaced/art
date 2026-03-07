# MintFace Art — mintface.art

Personal art site for MintFace. Single-file static site, deployed via Vercel.

---

## Deploying

This is a single `index.html` file. Push to GitHub, Vercel auto-deploys on every commit. No build step, no config needed.

---

## Changing where images are hosted

All 35 artwork images are controlled by **one line** near the top of `index.html`:

```javascript
const ASSETS_BASE = 'https://mintface.art/assets';
```

Change this value to wherever your `assets/` folder lives:

| Hosting | Value |
|---|---|
| Old site (temporary) | `'https://mintface.art/assets'` |
| Same server / Vercel (assets uploaded) | `'/assets'` |
| Cloudflare R2 | `'https://your-bucket.r2.dev/assets'` |
| AWS S3 + CloudFront | `'https://your-cdn.cloudfront.net/assets'` |
| Bunny.net | `'https://your-zone.b-cdn.net/assets'` |

That's the only line you need to touch when migrating storage.

---

## Asset folder structure (on your current server)

When you're ready to self-host the images, the folder structure expected is:

```
assets/
  images/
    gallery03/   → Two Burdens (painting)
    gallery04/   → Recursive Mind (illustration)
    gallery05/   → Geodetica (AI)
    gallery06/   → Patrimora (generative)
    gallery07/   → Geodetic Moments (photography)
    gallery09/   → Artificial Flowers (painting/AI)
    gallery13/   → Roads & Rivers (photography)
  videos/
    video01.mp4 … video12.mp4   → Artificial Flowers AR demos
```

Copy this folder from the old `mintface.art` server before decommissioning it.

---

## Migration checklist

- [ ] Launch on Vercel — `ASSETS_BASE` pointing to old site ✓
- [ ] Upload `assets/` folder to chosen storage (Cloudflare R2 recommended)
- [ ] Update `ASSETS_BASE` in `index.html`, commit, push
- [ ] Verify all images load from new storage
- [ ] Point `mintface.art` DNS to Vercel
- [ ] Decommission old server

---

## Collections

| Collection | Year | Medium | Editions |
|---|---|---|---|
| Artificial Flowers | 2025 | Painting / AI / AR | 21 × 1/1 |
| FROGDNA | 2025 | Painting | 1 work, 88 ed. |
| Patrimora | 2025 | Generative | 1/1 + 469 ed. |
| ID Please | 2025 | Illustration | 1/1 + 328 ed. |
| Recursive Mind | 2023–25 | Illustration | 13 × 1/1 |
| Two Burdens | 2024 | Painting | 36 × 1/1 |
| Geodetic World | 2023 | AI | 95 × 1/1 |
| Roads & Rivers | 2022 | Photography | 36 × 1/1 |
| Geodetic On-Chain | 2022 | Illustration | 5 works, 2×100 ed. |
| Geodetica | 2022 | AI | 100 × 1/1 |
| Geodetic Memory | 2022 | Photography | 1 work, 823 ed. |
| Geodetic Illusions | 2022 | Neural Painting | 87 × 1/1 |
| Geodetic Moments | 2021 | Photography | 100 × 1/1 |
| 1/1s on Foundation | 2021 | Photography | 7 × 1/1 |
| City vs Nature | 2021 | Photography | 1 work, 5 ed. |

---

## Contact

mintface@digitalartisteconomy.com  
[x.com/mintface](https://x.com/mintface)  
[instagram.com/thelinegallery](https://instagram.com/thelinegallery)
