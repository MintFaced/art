/* EIP-4361, serialized to the grammar rather than assembled out of strings.
 *
 * WHY THIS EXISTS. The sentence this site asks a wallet to sign has always
 * been its own: house voice, named action, a date in words a person can read.
 * Every browser extension signs it without complaint, because personal_sign
 * takes bytes and does not care what they spell.
 *
 * Mobile wallets are a different proposition. They sniff a message for
 * EIP-4361 and, finding it, hand it to a signing path that a million sign-ins
 * have been down; finding anything else, they hand it to the generic one. The
 * generic path is where `an error occurred` lives. So the message gets to be
 * spec-exact, and the house voice moves into the two places the spec keeps
 * for it: the statement, and the resources.
 *
 * The grammar is ABNF in the EIP. Serializing to it is the easy half; the half
 * that matters is `validate`, which reads back what we built and refuses it if
 * it is not exactly what the spec describes ... because a message that is
 * nearly EIP-4361 is worse than one that is plainly not. A wallet that half
 * parses it shows half a sheet.
 *
 * Mirrored character for character in mintface.js as MF.siwe, and
 * scripts/chat/test-siwe.mjs fails if the two ever drift.
 */

/* The ABNF, transcribed. Named rather than inlined so that a failure can say
   which line of the message was the wrong shape. */
const RE = {
  domain: /^[A-Za-z0-9.\-]+(:[0-9]{1,5})?$/,           // authority, no userinfo
  address: /^0x[0-9a-fA-F]{40}$/,                       // EIP-55 checksum, as sent
  uri: /^[A-Za-z][A-Za-z0-9+\-.]*:[^\s]*$/,             // RFC 3986 URI
  nonce: /^[A-Za-z0-9]{8,}$/,                           // >= 8 alphanumeric
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  chainId: /^[0-9]+$/,
  statement: /^[^\n]*$/,                                // one line, no LF
};

/** The authority part of an origin, which is what `domain` means in 4361. */
export const authorityOf = (origin) => {
  try { const u = new URL(origin); return u.host; } catch (e) { return String(origin || ''); }
};

/**
 * The message, exactly as the grammar lays it out.
 *
 * Line endings are LF and only LF. The EIP says so, and a string built by
 * hand on one platform and verified on another is precisely where a stray
 * CR gets in and turns a valid signature into a mismatched one.
 */
export function serialize(f) {
  const lines = [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address,
    '',
  ];
  /* The statement is optional, and when present it sits alone between blank
     lines. One line: the grammar has no room for a second, so the copy that
     ran to three lines lives in Resources below, where it is still read out
     by every wallet that draws them. */
  if (f.statement) lines.push(f.statement, '');
  lines.push(
    `URI: ${f.uri}`,
    'Version: 1',
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  );
  /* Order is fixed by the grammar. Optional fields are omitted entirely
     rather than sent empty ... `Expiration Time: ` with nothing after it is
     not a field a parser skips, it is a parse failure. */
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  if (f.notBefore) lines.push(`Not Before: ${f.notBefore}`);
  if (f.requestId) lines.push(`Request ID: ${f.requestId}`);
  if (f.resources && f.resources.length) {
    lines.push('Resources:');
    for (const r of f.resources) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}

/**
 * Read one back. Returns the fields, or throws with the line that was wrong.
 *
 * This is the half that earns its keep: we build a message, parse our own
 * build, and refuse to send anything that does not come back identical.
 */
export function parse(message) {
  const text = String(message);
  if (text.includes('\r')) throw new Error('the message carries a carriage return');
  const lines = text.split('\n');
  const f = {};
  let i = 0;

  const head = /^([^\s]+) wants you to sign in with your Ethereum account:$/.exec(lines[i++] || '');
  if (!head) throw new Error('line 1 is not the 4361 preamble');
  f.domain = head[1];
  if (!RE.domain.test(f.domain)) throw new Error(`domain is not an authority: ${f.domain}`);

  f.address = lines[i++];
  if (!RE.address.test(String(f.address))) throw new Error(`line 2 is not an address: ${f.address}`);
  if (lines[i++] !== '') throw new Error('line 3 must be empty');

  /* Statement present when the line after the blank is not a field. The
     grammar makes it unambiguous: a statement is followed by a blank line,
     and `URI:` starts the fields. */
  if (lines[i] !== undefined && !/^URI: /.test(lines[i])) {
    f.statement = lines[i++];
    if (!RE.statement.test(f.statement)) throw new Error('statement spans more than one line');
    if (lines[i++] !== '') throw new Error('the statement must be followed by an empty line');
  }

  const field = (name, re, required) => {
    const want = `${name}: `;
    if (lines[i] === undefined || !lines[i].startsWith(want)) {
      if (required) throw new Error(`expected "${name}:" and found ${JSON.stringify(lines[i])}`);
      return null;
    }
    const v = lines[i].slice(want.length);
    if (!re.test(v)) throw new Error(`${name} is the wrong shape: ${JSON.stringify(v)}`);
    i += 1;
    return v;
  };

  f.uri = field('URI', RE.uri, true);
  const version = field('Version', /^1$/, true);
  if (version !== '1') throw new Error('Version must be 1');
  f.chainId = field('Chain ID', RE.chainId, true);
  f.nonce = field('Nonce', RE.nonce, true);
  f.issuedAt = field('Issued At', RE.datetime, true);
  f.expirationTime = field('Expiration Time', RE.datetime, false);
  f.notBefore = field('Not Before', RE.datetime, false);
  f.requestId = field('Request ID', /^[^\n]*$/, false);

  if (lines[i] === 'Resources:') {
    i += 1;
    f.resources = [];
    while (lines[i] !== undefined && lines[i].startsWith('- ')) f.resources.push(lines[i++].slice(2));
    if (!f.resources.length) throw new Error('Resources: with nothing under it');
  }
  if (i !== lines.length) throw new Error(`trailing line ${i + 1}: ${JSON.stringify(lines[i])}`);
  return f;
}

/** Build, then read our own build back. Anything that fails never goes out. */
export function strict(fields) {
  const message = serialize(fields);
  const back = parse(message);                 // throws with the offending line
  if (back.address !== fields.address) throw new Error('the address did not survive the round trip');
  if (back.domain !== fields.domain) throw new Error('the domain did not survive the round trip');
  if (back.nonce !== fields.nonce) throw new Error('the nonce did not survive the round trip');
  return message;
}

/** True when the message is exactly what the grammar describes. */
export function valid(message) {
  try { parse(message); return true; } catch (e) { return false; }
}
