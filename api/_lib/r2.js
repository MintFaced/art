import { createHash, createHmac } from 'node:crypto';

// R2 speaks the S3 API, which means SigV4. Signing it by hand keeps the
// functions free of a very large SDK for what is two request shapes.
const ACCOUNT = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
const REGION = 'auto';
const SERVICE = 's3';

export const r2Configured = () => Boolean(ACCOUNT && BUCKET && KEY && SECRET);

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

function signingKey(date) {
  let k = hmac(`AWS4${SECRET}`, date);
  k = hmac(k, REGION);
  k = hmac(k, SERVICE);
  return hmac(k, 'aws4_request');
}

/**
 * Shared SigV4 signing for a single request against the bucket.
 */
function signed(method, key, body, contentType, query) {
  const host = `${ACCOUNT}.r2.cloudflarestorage.com`;
  const path = key === ''
    ? `/${BUCKET}`
    : `/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  // S3 wants the query sorted by key and encoded its own way
  const qs = Object.keys(query || {}).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body || '');

  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');
  const canonical = [method, path, qs, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
  return {
    url: `https://${host}${path}${qs ? `?${qs}` : ''}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export async function deleteObject(key) {
  if (!r2Configured()) throw new Error('R2 is not configured');
  const { url, headers } = signed('DELETE', key, '');
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`r2 delete ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  return key;
}

/**
 * One object into the bucket. Returns the key on success and throws with the
 * body on failure, so a caller can log which asset refused and why.
 */
export async function putObject(key, body, contentType) {
  if (!r2Configured()) throw new Error('R2 is not configured');
  const host = `${ACCOUNT}.r2.cloudflarestorage.com`;
  const path = `/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);

  const headers = {
    host,
    'content-type': contentType || 'application/octet-stream',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');
  const canonical = ['PUT', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');

  const res = await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`r2 put ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return key;
}

/**
 * Every key in the bucket with its size. R2 pages at 1000, so this follows the
 * continuation token until it runs out. Used to survey what a warm run actually
 * put there, which is how you find out you have been storing 30MB masters.
 */
export async function listObjects(prefix = '') {
  if (!r2Configured()) throw new Error('R2 is not configured');
  const out = [];
  let token;
  do {
    const query = { 'list-type': '2', 'max-keys': '1000' };
    if (prefix) query.prefix = prefix;
    if (token) query['continuation-token'] = token;
    const { url, headers } = signed('GET', '', '', undefined, query);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`r2 list ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = (m[1].match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
      const size = Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1] || 0);
      if (key) out.push({ key: key.replace(/&amp;/g, '&'), size });
    }
    token = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) token = null;
  } while (token);
  return out;
}

// Cheap existence check against the public domain, so a warm run can skip what
// it has already done without needing a signed HEAD.
export async function alreadyThere(publicBase, key) {
  try {
    const r = await fetch(`${publicBase}/${key}`, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}
