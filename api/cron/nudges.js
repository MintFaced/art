import { readFile, writeFile } from '../_lib/repo.js';
import { tally, palette, kindOf, nudgeStore, withLive, bankCandidates, bankTally, bankingRows, comboReader, CANDIDATES } from '../_lib/nudges.js';
import { storeConfigured, pipe } from '../_lib/kv.js';
import { stillDelegatedMany } from '../_lib/delegate.js';

/* Banking a nudge.
 *
 * At the close date the tally stops being a live reading and becomes a record.
 * The clamp is applied one last time here, against the TAO each collector
 * actually holds at close: someone who weighed a hundred thousand and then
 * sold down banks only what they still hold. Weigh what you hold, hold what
 * you weighed.
 *
 * Banked figures are frozen into the nudge, so the record never moves again
 * however the register changes afterwards.
 *
 * AND THE SAME CLAMP FALLS ON A REVOKED DELEGATION. This is the third and last
 * moment the COMBO is read against the chain. A vault that has left a COMBO
 * since the weighing, or sold down, weighs nothing here ... which is not a
 * punishment and not a special case: it is the identical rule the whole board
 * runs on, which is that you bank what you still hold at the close. A vault
 * you no longer speak for is TAO you no longer hold.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const site = process.env.SITE_ORIGIN || 'https://mintface.art';
  const at = async (p) => (await fetch(`${site}/${p}`, { headers: { accept: 'application/json' } })).json();

  const tao = await at('data/tao.json');
  /* The file as deployed, plus anything said since. This is the one place the
     overlay absolutely has to be applied: banking freezes a record forever, and
     a nudge banked without the weighings made since the last deploy would
     freeze the wrong one. */
  const said = withLive(await at('data/nudge-weighings.json'),
    storeConfigured() ? await nudgeStore(pipe).live().catch(() => []) : []);
  const weighings = said.weighings || [];
  const proposals = said.proposals || [];
  const file = await readFile('data/nudges.json');
  const store = JSON.parse(file.text);
  const readTao = (a) => {
    const w = tao.wallets && tao.wallets[String(a).toLowerCase()];
    return w ? w.tao : 0;
  };

  /**
   * Every COMBO any row on a closing nudge recorded, asked of the chain again.
   *
   * One batch for the whole run. A pair the registry no longer confirms is
   * struck off the row before anything is tallied; a registry that cannot be
   * reached at all leaves every recorded membership standing, because banking
   * a record short by somebody's vault on the strength of a network error
   * would be the worst of the two ways to be wrong ... and it is a record that
   * is never rewritten afterwards.
   */
  const confirm = async (rows) => {
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
  };
  const dropped = [];

  const now = Date.now();
  const banked = [];
  for (const n of store.nudges || []) {
    if (n.banked || n.published === false) continue;
    if (new Date(n.closes).getTime() > now) continue;
    /* A yes or a no keeps one weighing per wallet; a board of colours folds
       every row a wallet ever signed. Taking the latest on a board throws away
       every colour but the last one touched, which on nudge #1 was the whole
       difference between a colour locking and nothing locking at all. */
    const rows = await confirm(bankingRows(weighings, n));

    /* A nudge with candidates banks a colour, or banks the fact that no colour
       reached the threshold. Both are records and the second is not a failure:
       the studio undertook to paint what locked, and a lock that would have
       been carried by three people or by one wallet's holding is not the thing
       that was promised. */
    if (kindOf(n) === CANDIDATES) {
      const p = palette(rows, proposals.filter((x) => x.nudge === n.id), comboReader(readTao, rows), n);
      n.banked = bankCandidates(p, n);
      banked.push(`#${n.number} ${p.locked ? `locked ${p.locked.hex}` : 'no colour locked'}`
        + ` ... ${Math.round(p.total)} TAO across ${p.collectors}`);
      continue;
    }

    const t = tally(rows, comboReader(readTao, rows));
    n.banked = bankTally(t, n);
    banked.push(`#${n.number} ${t.result} ... ${Math.round(t.total)} TAO across ${t.collectors}`);
  }

  if (banked.length && !dry) {
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n',
      `Nudges: banked ${banked.length}`, file.sha);
  }
  const summary = `nudges: ${banked.length} banked`
    + (dropped.length ? `, ${dropped.length} delegation${dropped.length === 1 ? '' : 's'} clamped` : '');
  console.log(summary, banked.join('; '), dropped.join('; '));
  return new Response(JSON.stringify({ summary, banked, dropped, dry }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
