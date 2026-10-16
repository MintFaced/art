/* /api/commission-admin: the studio's view of Strip Painting commissions,
 * behind the console password (the mf_studio cookie /api/studio-api?do=login
 * sets). Everything on an order is here, the buyer's details included.
 *
 * GET  ?status=paid                 the list, newest first, filtered
 * GET  ?id=SP-2026-0041             one order, whole
 * GET  ?id=SP-2026-0041&strips=1    its strip data, as a file
 * POST {id, action:'status', status, note?, tracking?}
 * POST {id, action:'note', note}
 * POST {id, action:'mark-paid', method, ref?, note}   paid by hand, once
 * POST {id, action:'photo', data, type}               a photograph of it, to R2
 */
import { sessionOk, sessionFrom } from './_lib/studio.js';
import { listOrders, getOrder, studioUpdate, markPaid, renderUrl, STATUSES, commissionsConfigured } from './_lib/commissions.js';
import { specLine } from './_lib/commission-spec.js';
import { putObject, r2Configured } from './_lib/r2.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const gate = (request) => {
  if (!commissionsConfigured()) return json({ error: 'no store' }, 503);
  if (!sessionOk(sessionFrom(request))) return json({ error: 'sign in first', login: true }, 401);
  return null;
};
const whole = (o) => {
  const { key_hash, ...rest } = o;
  return { ...rest, spec_line: specLine(o.spec), render_url: renderUrl(o) };
};

export async function GET(request) {
  const stop = gate(request);
  if (stop) return stop;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const o = await getOrder(id);
    if (!o) return json({ error: 'no such order' }, 404);
    if (url.searchParams.get('strips') === '1') {
      return new Response(JSON.stringify({ id: o.id, spec: o.spec, strips: o.strip_data }, null, 1), {
        headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${o.id}-strips.json"`, 'cache-control': 'no-store' },
      });
    }
    return json({ order: whole(o), statuses: STATUSES });
  }
  const status = url.searchParams.get('status') || null;
  const orders = await listOrders({ status });
  return json({
    statuses: STATUSES,
    orders: orders.map((o) => ({
      id: o.id, created: o.created, spec_line: specLine(o.spec), method: o.method, status: o.status,
      nzd: o.price.nzd, eth: o.price.eth, paid_amount: o.paid_amount, name: o.name,
    })),
  });
}

export async function POST(request) {
  const stop = gate(request);
  if (stop) return stop;
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const id = String(b.id || '');

  if (b.action === 'mark-paid') {
    if (!['card', 'eth', 'bank', 'cash', 'other'].includes(b.method)) return json({ error: 'method is card, eth, bank, cash or other' }, 400);
    if (!String(b.note || '').trim()) return json({ error: 'say why, in the note' }, 400);
    const r = await markPaid(id, { method: b.method, ref: b.ref || null, amount: b.amount || null, note: String(b.note).slice(0, 2000), by: 'studio' });
    if (r.error) return json({ error: r.error }, 404);
    return json({ order: whole(r.order), already: Boolean(r.already) });
  }

  if (b.action === 'photo') {
    if (!r2Configured()) return json({ error: 'R2 is not configured here' }, 503);
    const type = ['image/jpeg', 'image/png', 'image/webp'].includes(b.type) ? b.type : null;
    if (!type || !b.data) return json({ error: 'a JPEG, PNG or WebP, as data' }, 400);
    const o = await getOrder(id);
    if (!o) return json({ error: 'no such order' }, 404);
    const bytes = Buffer.from(String(b.data), 'base64');
    if (bytes.length > 4 * 1024 * 1024) return json({ error: 'under 4 MB, please' }, 413);
    const key = `commissions/${id}/photo-${(o.photos || []).length + 1}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
    await putObject(key, bytes, type);
    const r = await studioUpdate(id, { photo: key }, 'studio');
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ order: whole(r.order) });
  }

  if (b.action === 'status' || b.action === 'note') {
    const r = await studioUpdate(id, { status: b.action === 'status' ? b.status : undefined, note: b.note, tracking: b.tracking }, 'studio');
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ order: whole(r.order) });
  }

  return json({ error: 'unknown action' }, 400);
}
