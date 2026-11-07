/* /api/strips-admin: /mintwork/strips, behind the console password. Nothing
 * here can act on the chain: a tx comes back for the wallet in the browser.
 *
 * GET                                       the whole console
 * POST {action:'draft', no}                 a site's draft design, from its palette
 * POST {action:'design', no, design}        save a design, unsigned
 * POST {action:'sign', no}                  Ryan has checked it against the panel
 * POST {action:'check', key, value}         a freeze check
 * POST {action:'tx', op, ...}               a transaction to sign
 */
import { sessionOk, sessionFrom } from './_lib/studio.js';
import { consoleView, draftFor, saveDesign, setCheck, signDesign, txFor } from './_lib/strips-console.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const gate = (request) => (sessionOk(sessionFrom(request)) ? null : json({ error: 'sign in first', login: true }, 401));

export async function GET(request) {
  return gate(request) || json(await consoleView());
}

export async function POST(request) {
  const stop = gate(request);
  if (stop) return stop;
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const no = Number(b.no);
  let out;
  if (b.action === 'draft') out = draftFor(no);
  else if (b.action === 'design') out = await saveDesign(no, b.design);
  else if (b.action === 'sign') out = await signDesign(no);
  else if (b.action === 'check') out = await setCheck(b.key, b.value);
  else if (b.action === 'tx') out = await txFor(b.op, b);
  else out = { error: 'no such action' };
  return json(out, out.error ? 400 : 200);
}
