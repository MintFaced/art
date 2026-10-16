/* A commission's render as a PNG: the strips an order was given, drawn the
 * way the home page draws them (portrait stands them up, landscape lays them
 * from the bottom up), at the order's own proportions. This is the picture
 * on the order, in R2, in both emails and on the X card.
 *
 * Edges are running totals rounded once, so no seam is a colour of its own.
 */
import sharp from 'sharp';

const LONG_PX = 1600;

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** PNG bytes for {length_cm, width_cm, orientation, strips:[{hex, mm}]}. */
export async function stripPNG({ length_cm: L, width_cm: Wd, orientation, strips }) {
  const portrait = orientation === 'portrait';
  const k = LONG_PX / Math.max(L, Wd);
  const W = Math.max(1, Math.round((portrait ? Wd : L) * k));
  const H = Math.max(1, Math.round((portrait ? L : Wd) * k));
  const px = Buffer.alloc(W * H * 3);
  const total = strips.reduce((n, s) => n + s.mm, 0) || 1;
  const across = portrait ? W : H;
  let mm = 0;
  for (const s of strips) {
    const a = Math.round((mm / total) * across);
    const b = Math.round(((mm + s.mm) / total) * across);
    const [r, g, bl] = rgb(s.hex);
    if (portrait) {
      for (let y = 0; y < H; y += 1) for (let x = a; x < b; x += 1) { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = bl; }
    } else {
      for (let y = H - b; y < H - a; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = bl; }
    }
    mm += s.mm;
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
}
