/* The buy block at the foot of a story (f.html), kept apart so a test can hold
 * it to its markup. Two kinds of work reach it:
 *
 *   a digital work on offer    FROGDNA: the digital price, Acquire, and the
 *                              Counterparty note. This markup is held byte
 *                              for byte by scripts/catalog/test-composition-32.mjs,
 *                              so change it only on purpose.
 *   a painting, collected      Composition 32: the painting, its price, who
 *                              collected it, and no button. Read off the work
 *                              itself: the painting is sold and there is no
 *                              digital price to offer.
 *
 * e is the page's escape (MF.escape).
 */
export const collected = (w) => Boolean(w && w.physical && w.physical.sold === true
  && !(w.pricing_nzd && w.pricing_nzd.digital != null));

export function buyBlock(w, e) {
  if (!w) return '';
  if (collected(w)) return collectedBlock(w, e);
  const eth = w.wrapped ? `${w.wrapped.artist_held} of the wrapped editions are still with the artist` : null;
  const price = w.pricing_nzd && w.pricing_nzd.digital != null
    ? `$${Math.round(w.pricing_nzd.digital).toLocaleString('en-NZ')}`
    : null;
  return `<div class="prose buy">
        <div class="buy-row">
          <span class="what">The digital work</span>
          ${price ? `<span class="amt">${e(price)}</span>` : ''}
        </div>
        <a class="btn" href="/w/${encodeURIComponent(w.id)}">Acquire this artwork</a>
        <p class="note">Eighty-eight editions on Bitcoin as a Counterparty asset${eth ? `, and ${e(eth)} on Ethereum` : ''}. Paying in Bitcoin is arranged directly; the wrapped edition goes through the wallet.</p>
      </div>`;
}

function collectedBlock(w, e) {
  const p = w.pricing_nzd && w.pricing_nzd.painting;
  const amt = typeof p === 'number' && p > 0
    ? `NZD ${p.toLocaleString('en-NZ')}${w.gst_inclusive ? ' incl. GST' : ''}`
    : null;
  const who = (w.collector && w.collector.display_name) || w.collector_display_name || w.physical.collector || null;
  return `<div class="prose buy">
        <div class="buy-row">
          <span class="what">The painting</span>
          ${amt ? `<span class="amt">${e(amt)}</span>` : ''}
        </div>
        <p class="note">${who ? `Collected by ${e(who)}` : 'Collected'}</p>
      </div>`;
}
