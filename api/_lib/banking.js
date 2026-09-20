/* Closing a nudge, in one place.
 *
 * Two things close nudges now: the cron, at the close date, and the artist,
 * from the console, when the studio has decided not to wait. They must be the
 * same close. A second implementation that read the weighings slightly
 * differently, or forgot to re-check a delegation, would produce a record that
 * disagreed with the one the cron would have written ... and a banked record is
 * never rewritten, so that disagreement would be permanent.
 *
 * So the clamp, the COMBO re-check and the freeze live here, and the two
 * callers differ only in which nudges they hand over and whether the artist
 * named the colour.
 */
import { palette, kindOf, nudgeStore, withLive, bankCandidates, bankTally, bankingRows,
  comboReader, tally, CANDIDATES } from './nudges.js';
import { storeConfigured, pipe } from './kv.js';
import { stillDelegatedMany } from './delegate.js';

/**
 * Everything a close needs to read, gathered once.
 * @param at  (path) => parsed json, the site fetch the caller already has
 */
export async function bankingContext(at) {
  const tao = await at('data/tao.json');
  /* The file as deployed, plus anything said since. This is the one place the
     overlay absolutely has to be applied: banking freezes a record forever, and
     a nudge banked without the weighings made since the last deploy would
     freeze the wrong one. */
  const said = withLive(await at('data/nudge-weighings.json'),
    storeConfigured() ? await nudgeStore(pipe).live().catch(() => []) : []);
  const readTao = (a) => {
    const w = tao.wallets && tao.wallets[String(a).toLowerCase()];
    return w ? w.tao : 0;
  };
  return { weighings: said.weighings || [], proposals: said.proposals || [], readTao };
}

/**
 * Every COMBO any row on a closing nudge recorded, asked of the chain again.
 *
 * A registry that cannot be reached at all leaves every recorded membership
 * standing, because banking a record short by somebody's vault on the strength
 * of a network error would be the worse of the two ways to be wrong — and it is
 * a record that is never rewritten afterwards.
 */
export async function confirmCombos(rows, dropped = []) {
  const pairs = [];
  for (const r of rows) for (const v of r.combo || []) pairs.push({ hot: r.address, vault: v });
  if (!pairs.length) return rows;
  const { ok, degraded } = await stillDelegatedMany(pairs).catch(() => ({ ok: new Map(), degraded: true }));
  if (degraded) {
    dropped.push('registry unreachable at close ... recorded COMBOs left standing');
    return rows;
  }
  return rows.map((r) => {
    if (!(r.combo || []).length) return r;
    const keep = r.combo.filter((v) => ok.get(`${String(r.address).toLowerCase()}|${String(v).toLowerCase()}`));
    for (const v of r.combo) {
      if (!keep.includes(v)) dropped.push(`${String(r.address).slice(0, 10)} no longer speaks for ${String(v).slice(0, 10)}`);
    }
    return keep.length === (r.combo || []).length ? r : { ...r, combo: keep };
  });
}

/**
 * Bank one nudge. Returns the banked record without attaching it, so a caller
 * can show it to somebody before anything is written — which is what the
 * console's confirm step is.
 *
 * @param decision  { by: 'artist', hex } to lock against the thresholds, or
 *                  null to let them decide, which is the cron's case.
 */
export async function bankNudge(n, ctx, decision = null, dropped = []) {
  const rows = await confirmCombos(bankingRows(ctx.weighings, n), dropped);
  if (kindOf(n) === CANDIDATES) {
    const p = palette(rows, ctx.proposals.filter((x) => x.nudge === n.id), comboReader(ctx.readTao, rows), n);
    return { banked: bankCandidates(p, n, decision), p };
  }
  const t = tally(rows, comboReader(ctx.readTao, rows));
  return { banked: bankTally(t, n), t };
}
