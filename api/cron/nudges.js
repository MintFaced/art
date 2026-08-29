import { readFile, writeFile } from '../_lib/repo.js';
import { tally, latest, palette, kindOf, CANDIDATES } from '../_lib/nudges.js';

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
  const said = await at('data/nudge-weighings.json');
  const weighings = said.weighings || [];
  const proposals = said.proposals || [];
  const file = await readFile('data/nudges.json');
  const store = JSON.parse(file.text);
  const readTao = (a) => {
    const w = tao.wallets && tao.wallets[String(a).toLowerCase()];
    return w ? w.tao : 0;
  };

  const now = Date.now();
  const banked = [];
  for (const n of store.nudges || []) {
    if (n.banked || n.published === false) continue;
    if (new Date(n.closes).getTime() > now) continue;
    const rows = latest(weighings, n.id);

    /* A nudge with candidates banks a colour, or banks the fact that no colour
       reached the threshold. Both are records and the second is not a failure:
       the studio undertook to paint what locked, and a lock that would have
       been carried by three people or by one wallet's holding is not the thing
       that was promised. */
    if (kindOf(n) === CANDIDATES) {
      const p = palette(rows, proposals.filter((x) => x.nudge === n.id), readTao, n);
      n.banked = {
        number: n.number, kind: CANDIDATES, rule: p.rule,
        total: p.total, collectors: p.collectors,
        leader: p.leader, locked: p.locked, why: p.why,
        candidates: p.candidates.map((c) => ({
          hex: c.hex, total: c.total, voters: c.voters, share: c.share,
          proposed_by: c.proposed_by || null, proposed_name: c.proposed_name || null,
          ledger: c.ledger.map((r) => ({ address: r.address, name: r.name || null,
            candidate: r.candidate, weight: r.weight, at: r.at, clamped: Boolean(r.clamped) })),
        })),
        banked_at: new Date().toISOString(),
      };
      banked.push(`#${n.number} ${p.locked ? `locked ${p.locked.hex}` : 'no colour locked'}`
        + ` ... ${Math.round(p.total)} TAO across ${p.collectors}`);
      continue;
    }

    const t = tally(rows, readTao);
    n.banked = {
      number: n.number, totals: t.totals, counts: t.counts, total: t.total,
      collectors: t.collectors, share: t.share, result: t.result,
      ledger: t.ledger.map((r) => ({ address: r.address, name: r.name || null, side: r.side, weight: r.weight, at: r.at, clamped: Boolean(r.clamped) })),
      banked_at: new Date().toISOString(),
    };
    banked.push(`#${n.number} ${t.result} ... ${Math.round(t.total)} TAO across ${t.collectors}`);
  }

  if (banked.length && !dry) {
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n',
      `Nudges: banked ${banked.length}`, file.sha);
  }
  const summary = `nudges: ${banked.length} banked`;
  console.log(summary, banked.join('; '));
  return new Response(JSON.stringify({ summary, banked, dry }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
