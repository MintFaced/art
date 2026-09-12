/* The sign-in sentence, checked against the spec and against itself.
 *
 * Two things can go wrong here and both are silent. The message can drift out
 * of EIP-4361's grammar, which a desktop extension will sign anyway and a
 * phone will refuse with a house error that names nothing. And the page's copy
 * of the serializer can drift from the route's, which verifies as `that
 * signature does not match the wallet` ... a sentence that sends a collector
 * looking at their wallet for a problem that is in our own two files.
 *
 * So: build it, parse it back, check every field against the ABNF, and then
 * run the browser's copy on the same fields and compare the bytes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serialize, parse, strict, valid, authorityOf } from '../../api/_lib/siwe.js';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failed += 1;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
};

const FIELDS = {
  domain: 'mintface.art',
  address: '0x5B93FF82faaF241c15997ea3975419DDDd8362c5',
  statement: 'Sign in to MintFace for 30 days.',
  uri: 'https://mintface.art/studio',
  chainId: '1',
  nonce: 'a3f9c21b8e4d7605a3f9c21b8e4d7605',
  issuedAt: '2026-09-12T03:14:15.926Z',
  expirationTime: '2026-10-12T03:14:15.926Z',
  resources: ['https://mintface.art/studio'],
};

console.log('EIP-4361, the grammar');
const message = strict(FIELDS);
console.log(`\n${message.split('\n').map((l) => `    | ${l}`).join('\n')}\n`);

const back = parse(message);
ok('it parses back', true);
ok('domain survives', back.domain === FIELDS.domain, back.domain);
ok('the address is the checksummed spelling', back.address === FIELDS.address, back.address);
ok('the statement is one line', back.statement === FIELDS.statement);
ok('URI survives', back.uri === FIELDS.uri);
ok('chain id survives', back.chainId === '1');
ok('the nonce is alphanumeric and long enough', /^[A-Za-z0-9]{8,}$/.test(back.nonce));
ok('issued at is ISO-8601', back.issuedAt === FIELDS.issuedAt);
ok('expiration time is ISO-8601', back.expirationTime === FIELDS.expirationTime);
ok('the resource survives', back.resources.join('|') === FIELDS.resources.join('|'));
ok('no carriage returns anywhere', !message.includes('\r'));
ok('no trailing whitespace on any line', message.split('\n').every((l) => l === l.replace(/\s+$/, '')));
ok('the preamble is the exact spec sentence',
  message.startsWith('mintface.art wants you to sign in with your Ethereum account:\n'));

console.log('\nwhat it refuses');
const refuses = (name, patch) => {
  try { strict({ ...FIELDS, ...patch }); ok(name, false, 'it was accepted'); }
  catch (e) { ok(`${name} ... ${e.message}`, true); }
};
refuses('a statement with a line break in it', { statement: 'one\ntwo' });
ok('the statement is the one Ryan wrote', FIELDS.statement === 'Sign in to MintFace for 30 days.');
refuses('a nonce of fewer than eight', { nonce: 'abc' });
refuses('a nonce that is not alphanumeric', { nonce: 'aaaa-bbbb-cccc' });
refuses('an issued-at that is not a datetime', { issuedAt: '12 September 2026' });
refuses('a domain with a scheme on it', { domain: 'https://mintface.art' });
refuses('a domain with a trailing slash', { domain: 'mintface.art/' });
refuses('a URI that is not a URI', { uri: '/studio' });
refuses('an address that is not an address', { address: '0xnope' });
refuses('a chain id that is not a number', { chainId: 'mainnet' });

/* The chain the wallet says it is on, whatever that is. A wallet that parses
   4361 checks this line against where it actually is, and a hardcoded 1 is a
   sheet that renders perfectly and refuses at Confirm. */
console.log('\nthe chain is the wallet\'s, not ours');
for (const id of ['1', '8453', '10', '137', '42161']) {
  const m = strict({ ...FIELDS, chainId: id });
  ok(`chain ${id} serializes and parses`, parse(m).chainId === id);
}

console.log('\nwhat the wallet browser loads it as');
ok('apex and www are different domains, and both are authorities',
  authorityOf('https://mintface.art/studio') === 'mintface.art'
  && authorityOf('https://www.mintface.art/studio') === 'www.mintface.art');
ok('a port survives into the authority', authorityOf('http://localhost:8777/studio') === 'localhost:8777');
ok('a message built for one host does not claim another',
  parse(strict({ ...FIELDS, domain: 'www.mintface.art' })).domain === 'www.mintface.art');

console.log('\nthe page and the route build the same bytes');
/* MF.siwe, lifted out of mintface.js and run here. Not a copy of it ... the
   file itself, so a change to one and not the other is what this catches. */
const js = readFileSync(join(here, '../../mintface.js'), 'utf8');
const start = js.indexOf('  siwe(f) {');
const end = js.indexOf('\n  },', start);
ok('MF.siwe is where the test expects it', start > 0 && end > start);
const body = js.slice(start + '  siwe(f) {'.length, end);
// eslint-disable-next-line no-new-func
const browserSiwe = new Function('f', body);
const theirs = browserSiwe(FIELDS);
ok('byte for byte the same message', theirs === message,
  theirs === message ? '' : `page:\n${JSON.stringify(theirs)}\nroute:\n${JSON.stringify(message)}`);
ok('and the page\'s build passes the grammar too', valid(theirs));

/* The house sentence is still accepted, and is still not 4361 ... which is the
   whole reason this exists. */
console.log('\nthe sentence we had');
const { chatMessage } = await import('../../api/_lib/chat.js');
const house = chatMessage({
  action: 'sign in', address: '0x5b93ff82faaf241c15997ea3975419dddd8362c5',
  issued: FIELDS.issuedAt, until: FIELDS.expirationTime, domain: 'mintface.art',
});
ok('it is not an EIP-4361 message, and never was', !valid(house));
ok('which is what a phone was being handed', true);

/* The serializer being identical is half of it. The other half is the two
   literals it is fed ... the statement and the resource ... which live once in
   each file and would drift in silence, because a message that is valid 4361
   and says something slightly different still verifies as a mismatch. */
console.log('\nthe copy is the same copy');
const routeSrc = readFileSync(join(here, '../../api/chat.js'), 'utf8');
/* The expression is read out of each file and evaluated, not compared as
   source: the two are indented differently and that is not a difference in
   what the wallet shows. What is compared is the string it comes to. */
const statementOf = (src) => {
  /* The 4361 statement, which is a template literal in both files. Matched on
     its own opening rather than on `Signing opens Studio`, which is the house
     sentence mintface.js also holds ... matching that would compare the wrong
     pair and pass while the real pair drifted. */
  const m = /`Sign in to MintFace for \$\{[^}]*\} days\.`/.exec(src);
  // eslint-disable-next-line no-new-func
  return m ? new Function('days', `return ${m[0].replace(/\$\{[^}]*\}/, '${days}')}`)(30) : null;
};
const pageStatement = statementOf(js);
const routeStatement = statementOf(routeSrc);
ok('the statement is found in both files', Boolean(pageStatement && routeStatement));
ok('and it is the same statement', pageStatement === routeStatement,
  `page: ${pageStatement}\n       route: ${routeStatement}`);
const resourceOf = (src) => {
  const m = /resources: \[('[^']*')\]/.exec(src);
  return m ? m[1] : null;
};
ok('the resource is found in both files', Boolean(resourceOf(js) && resourceOf(routeSrc)));
ok('and it is the same resource', resourceOf(js) === resourceOf(routeSrc),
  `page: ${resourceOf(js)}  route: ${resourceOf(routeSrc)}`);
ok('and it is an absolute URI, not a path the grammar would refuse',
  /^'https:\/\//.test(String(resourceOf(js))));

/* THE ROUND TRIP THAT ACTUALLY MATTERS. A real key signs what the page builds,
   and the route rebuilds it from the fields on the wire and verifies. If those
   two ever build different bytes this is the test that says so, in the one
   place a collector would otherwise see `that signature does not match the
   wallet` and go looking at their wallet. */
console.log('\nsigned by a key, rebuilt by the route');
const { privateKeyToAccount } = await import('viem/accounts');
const { verifyMessage } = await import('viem');
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

/* What the page sends. Note the two spellings: `address` is lowercase, as this
   site keys everything, and `spelled` is what the wallet calls itself, which is
   what went into the message. */
const wire = {
  address: account.address.toLowerCase(),
  spelled: account.address,
  domain: 'mintface.art',
  uri: 'https://mintface.art/studio',
  nonce: 'a3f9c21b8e4d7605a3f9c21b8e4d7605',
  issued: FIELDS.issuedAt,
  until: FIELDS.expirationTime,
};
const pageBuilt = browserSiwe({
  domain: wire.domain,
  address: wire.spelled,
  statement: FIELDS.statement,
  uri: wire.uri,
  chainId: '1',
  nonce: wire.nonce,
  issuedAt: wire.issued,
  expirationTime: wire.until,
  resources: ['https://mintface.art/studio'],
});
const signature = await account.signMessage({ message: pageBuilt });

/* The route's rebuild, from the wire fields only. */
const routeBuilt = strict({
  domain: wire.domain,
  address: wire.spelled,
  statement: FIELDS.statement,
  uri: wire.uri,
  chainId: '1',
  nonce: wire.nonce,
  issuedAt: wire.issued,
  expirationTime: wire.until,
  resources: ['https://mintface.art/studio'],
});
ok('the route rebuilds the same bytes from the wire', routeBuilt === pageBuilt);
ok('and the signature verifies against the lowercase address',
  await verifyMessage({ address: wire.address, message: routeBuilt, signature }));
ok('a message built for another domain does not verify',
  !(await verifyMessage({ address: wire.address, signature,
    message: strict({ domain: 'www.mintface.art', address: wire.spelled, statement: FIELDS.statement,
      uri: wire.uri, chainId: '1', nonce: wire.nonce, issuedAt: wire.issued,
      expirationTime: wire.until, resources: ['https://mintface.art/studio'] }) })));
ok('nor does one with a different nonce',
  !(await verifyMessage({ address: wire.address, signature,
    message: strict({ domain: wire.domain, address: wire.spelled, statement: FIELDS.statement,
      uri: wire.uri, chainId: '1', nonce: 'b3f9c21b8e4d7605a3f9c21b8e4d7605', issuedAt: wire.issued,
      expirationTime: wire.until, resources: ['https://mintface.art/studio'] }) })));
/* The lowercase spelling in the address line is a different message, which is
   why the page has to send the spelling it used and the route has to use it. */
ok('the lowercase spelling is a different message and does not verify',
  !(await verifyMessage({ address: wire.address, signature,
    message: strict({ domain: wire.domain, address: wire.address, statement: FIELDS.statement,
      uri: wire.uri, chainId: '1', nonce: wire.nonce, issuedAt: wire.issued,
      expirationTime: wire.until, resources: ['https://mintface.art/studio'] }) })));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
