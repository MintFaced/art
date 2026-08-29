#!/usr/bin/env node
/* The fourth naming tier: one name pointing at a wallet, or none.
 *
 * No network. The subgraph is a stub that answers the query it is actually
 * sent, so the batching, the paging and the one-name rule are all exercised
 * against the shape of a real answer rather than around it.
 *
 *   node scripts/names/test-ens.mjs
 */
import { usableName, forwardName, namesPointingAt, forwardPass } from '../../api/_lib/ens.js';
import { nameFor, sourceOf, registerIndex, naming, TIERS_UNCLAIMED } from '../../api/_lib/names.js';
import { deriveCollectors } from '../../api/_lib/collectors.js';

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const addr = (n) => `0x${String(n).padStart(40, '0')}`;
const FUTURE = String(Math.floor(Date.now() / 1000) + 86400 * 365);
const PAST = String(Math.floor(Date.now() / 1000) - 86400);

/* A subgraph that answers the question it was asked, pages at a thousand, and
   counts what it was asked so the batching can be checked. */
function stubGraph(byAddress, { fail = 0 } = {}) {
  const calls = [];
  let failures = fail;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.variables);
    if (failures-- > 0) return { ok: false, status: 502 };
    const rows = [];
    for (const a of body.variables.a) {
      for (const d of byAddress[a] || []) rows.push({ ...d, resolvedAddress: { id: a } });
    }
    const page = rows.slice(body.variables.skip, body.variables.skip + 1000);
    return { ok: true, json: async () => ({ data: { domains: page } }) };
  };
  return { fetchImpl, calls };
}

head('What counts as a name');
{
  ok(usableName({ name: 'josephj.eth', expiryDate: FUTURE }), 'a live .eth name is a name');
  ok(usableName({ name: 'vault.iagof.eth' }), 'and so is a subdomain, which has no expiry of its own');
  ok(!usableName({ name: 'expired.eth', expiryDate: PAST }),
    'a name that has run out is not a name anybody is called');
  ok(!usableName({ name: '[9f8c2a].eth' }),
    'nor a label the subgraph has never seen the preimage of ... nobody is called that');
  ok(!usableName({ name: '' }) && !usableName({ name: null }), 'nor nothing at all');
  ok(!usableName({ name: 'somebody.xyz' }), 'and this tier is .eth, like every other name on the register');
  ok(!usableName({ name: 'HAS SPACES.eth' }), 'and a name that could not resolve is not one');
}

head('One name, or none');
{
  ok(forwardName(['josephj.eth']).name === 'josephj.eth', 'exactly one name names the wallet');
  const many = forwardName(['a.eth', 'b.eth']);
  ok(!many.name && many.ambiguous === 2,
    'two names name nothing ... ambiguity is never guessed at', JSON.stringify(many));
  ok(forwardName([]) === null && forwardName(null) === null, 'and no names name nothing');
  ok(forwardName(['Same.eth', 'same.eth']).name === 'same.eth',
    'the same name twice is one name, not an ambiguity');
}

head('Asking the subgraph');
{
  const one = addr(1), two = addr(2), three = addr(3);
  const graph = stubGraph({
    [one]: [{ name: 'josephj.eth', expiryDate: FUTURE }],
    [two]: [{ name: 'a.eth', expiryDate: FUTURE }, { name: 'b.eth', expiryDate: FUTURE }],
    [three]: [{ name: 'gone.eth', expiryDate: PAST }],
  });
  const found = await namesPointingAt([one, two, three, addr(4)], graph);
  ok(found.get(one).length === 1 && found.get(one)[0] === 'josephj.eth', 'one name comes back as one');
  ok(found.get(two).length === 2, 'two come back as two, for the rule to refuse');
  ok(!found.has(three), 'an expired name is dropped before the rule ever sees it');
  ok(!found.has(addr(4)), 'and a wallet nothing points at is simply absent');

  const pass = await forwardPass([one, two, three], graph);
  ok(pass.names[one] === 'josephj.eth' && !pass.names[two], 'the pass names the one and refuses the two');
  ok(pass.ambiguous[two].length === 2, 'and keeps what it refused, because that is the audit trail');
  ok(pass.counts.named === 1 && pass.counts.ambiguous === 1 && pass.counts.asked === 3,
    'and counts all three answers', JSON.stringify(pass.counts));

  /* A wallet named by a stronger tier is not asked about at all: the answer
     could not change anything, and the question is not free. */
  const skipped = await forwardPass([one, two], { ...graph, skip: new Set([one]) });
  ok(skipped.counts.asked === 1 && !skipped.names[one],
    'a wallet already named by a stronger tier is not asked about');

  const wide = stubGraph(Object.fromEntries(
    Array.from({ length: 450 }, (_, i) => [addr(i + 10), [{ name: `n${i}.eth`, expiryDate: FUTURE }]])));
  await namesPointingAt(Array.from({ length: 450 }, (_, i) => addr(i + 10)), wide);
  ok(wide.calls.length >= 3 && wide.calls.every((c) => c.a.length <= 200),
    'four hundred and fifty wallets go in batches, never in one question',
    `${wide.calls.length} questions`);

  const flaky = stubGraph({ [one]: [{ name: 'josephj.eth', expiryDate: FUTURE }] }, { fail: 2 });
  const after = await namesPointingAt([one], flaky);
  ok(after.get(one)[0] === 'josephj.eth', 'and a subgraph that stumbles twice is asked again');
}

head('Where it sits in the order');
{
  ok(nameFor({ fwd: 'josephj.eth', address: addr(1) }) === 'josephj.eth',
    'a wallet with nothing else is called what points at it');
  ok(nameFor({ ens: 'reverse.eth', fwd: 'pointer.eth' }) === 'reverse.eth',
    'a reverse record appearing anywhere outranks it');
  ok(nameFor({ self: 'Chosen', fwd: 'pointer.eth' }) === 'Chosen',
    'and so does a name somebody signed for');
  ok(nameFor({ overlay: 'Written Down', ens: 'reverse.eth', fwd: 'pointer.eth' }) === 'Written Down',
    'and so does MintFace, as it does over everything');
  ok(nameFor({ address: addr(1) }) === '0x0000…0001', 'and with none of them, the address');

  ok(sourceOf({ fwd: 'pointer.eth' }) === 'ens-forward',
    'the tier is named apart from the reverse record it reads like', sourceOf({ fwd: 'x.eth' }));
  ok(sourceOf({ ens: 'r.eth', fwd: 'p.eth' }) === 'ens',
    'so the audit trail knows which tier named whom');
  ok(TIERS_UNCLAIMED.has('ens-forward') && TIERS_UNCLAIMED.has('address')
    && !TIERS_UNCLAIMED.has('ens') && !TIERS_UNCLAIMED.has('self'),
    'and both tiers nobody signed for are the two that get the nudge');
}

head('Through the register, as a page reads it');
{
  const fields = ['address', 'name', 'ens', 'slug', 'private', 'works', 'unique', 'tao', 'rate', 'last', 'rank', 'fwd'];
  const rows = [
    [addr(1), '', '', '0x00000000', 0, 25, 25, 982859, 1725, '2025-02-05', 2, 'josephj.eth'],
    [addr(2), 'visco.eth', 'visco.eth', 'visco.eth', 0, 83, 11, 1493717, 1162, '2026-08-21', 1, 'other.eth'],
    [addr(3), '', '', '0x00000002', 0, 3, 1, 400, 4, '2026-01-01', 900, ''],
  ];
  const reg = naming(registerIndex({ fields, rows }), { [addr(3)]: 'Chosen One' });

  const one = reg.who(addr(1));
  ok(one.name === 'josephj.eth' && one.source === 'ens-forward',
    'the register names a wallet from the column and says which tier did it',
    `${one.name} / ${one.source}`);
  ok(one.fwd === 'josephj.eth' && one.ens === null,
    'and keeps the pointer apart from the reverse record it does not have');
  ok(reg.urlOf(addr(1)) === 'https://collectors.mintface.art/0x00000000',
    'the slug is the address, not the name ... a URL is minted from something somebody claimed',
    reg.urlOf(addr(1)));

  const two = reg.who(addr(2));
  ok(two.name === 'visco.eth' && two.source === 'ens',
    'a wallet with a reverse record keeps it, whatever else points at it');
  const three = reg.who(addr(3));
  ok(three.name === 'Chosen One' && three.source === 'self', 'and a chosen name is a chosen name');

  /* A register file written before this column existed still reads. */
  const old = naming(registerIndex({ fields: fields.slice(0, 11), rows: rows.map((r) => r.slice(0, 11)) }), {});
  ok(old.who(addr(1)).name === '0x0000…0001' && old.who(addr(1)).source === 'address',
    'and a register from before the column simply has no fourth tier in it',
    old.who(addr(1)).name);
}

head('The slug never adopts it');
{
  const work = (id, address, ens) => ({
    id, title: id, collection: 'c', unique: true, assets: { display: 'x.webp' },
    collector: { address, ens: ens || null, display_name: null, acquired: '2025-01-01' },
  });
  const collections = [{ slug: 'c', title: 'C', works: [work('w1', addr(1)), work('w2', addr(2), 'visco.eth')] }];
  const forward = { names: { [addr(1)]: 'josephj.eth', [addr(2)]: 'ignored.eth' } };
  const d = deriveCollectors(collections, new Map([['c', 'C']]), new Set(), null, null, forward);
  const col = Object.fromEntries(d.register.fields.map((f, i) => [f, i]));
  const rowOf = (a) => d.register.rows.find((r) => r[col.address] === a);

  ok(rowOf(addr(1))[col.fwd] === 'josephj.eth', 'the pass reaches the register file');
  ok(rowOf(addr(1))[col.name] === '' && rowOf(addr(1))[col.ens] === '',
    'without pretending to be either of the columns above it');
  ok(!/josephj/.test(String(rowOf(addr(1))[col.slug])),
    'and the page slug stays the address', rowOf(addr(1))[col.slug]);
  ok(rowOf(addr(2))[col.fwd] === '',
    'a wallet with a reverse record is never given a fourth-tier name to carry');
  ok(rowOf(addr(2))[col.slug] === 'visco.eth',
    'and keeps the slug its reverse record earned it');

  /* Nothing points anywhere: the register is what it was. */
  const bare = deriveCollectors(collections, new Map([['c', 'C']]), new Set(), null, null, null);
  const bcol = Object.fromEntries(bare.register.fields.map((f, i) => [f, i]));
  ok(bare.register.rows.every((r) => r[bcol.fwd] === ''),
    'and with no pass at all the column is simply empty');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
