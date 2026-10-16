/* What a commissioned Strip Painting costs. One function, read by the home
 * page's slider, the Maker, and the checkout when it comes, so no two of them
 * can ever quote the same painting differently (docs: STRIP-HOME).
 *
 * The numbers are code, never copy: a page shows the total and nothing of how
 * it was reached.
 *
 *   length ... NZD 169 for every 10 cm along the strips
 *   width .... up to 60 cm included; over 60 to 120 cm, twice the rate
 *   frame .... 500 to 120 cm long, 900 above, only when framed
 *   shipping . worldwide, boxed: 900 to 120 cm long, 1,200 above; 0 to collect
 *
 * Past 240 cm long a frame or shipping has no price yet, and past 120 cm wide
 * nothing does: those come back null, which a page says as "quoted after we
 * talk" rather than inventing a number.
 */

export const NZD_PER_10CM = 169;
export const WIDTH_INCLUDED_CM = 60;
export const WIDTH_MAX_CM = 120;
export const LENGTH_MAX_CM = 240;
export const STRIP_ETH_NZD = 5000;

/** NZD for one painting, or null where it is quoted rather than priced. */
export function stripPrice({ lengthCm, widthCm = WIDTH_INCLUDED_CM, framed = false, shipping = false } = {}) {
  const L = Number(lengthCm);
  const W = Number(widthCm);
  if (!(L > 0) || !(W > 0) || W > WIDTH_MAX_CM) return null;
  const rate = W <= WIDTH_INCLUDED_CM ? NZD_PER_10CM : 2 * NZD_PER_10CM;
  let nzd = Math.round((L / 10) * rate);
  if (framed || shipping) {
    if (L > LENGTH_MAX_CM) return null;
    if (framed) nzd += L <= 120 ? 500 : 900;
    if (shipping) nzd += L <= 120 ? 900 : 1200;
  }
  return nzd;
}

/** ETH at the fixed Strip Painting rate, to the hundredth. */
export const stripEth = (nzd) => Math.round((nzd / STRIP_ETH_NZD) * 100) / 100;

export const fmtNZD = (n) => `NZD ${Math.round(n).toLocaleString('en-NZ')}`;
export const fmtETH = (n) => `${stripEth(n).toFixed(2)} ETH`;
export const fmtUSD = (n, usd) => (usd ? `USD ${Math.round(n * usd).toLocaleString('en-US')}` : null);
