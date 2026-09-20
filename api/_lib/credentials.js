/* The credential alarm.
 *
 * A dead GitHub token is the one failure this site cannot report through its
 * usual channel. Every cron writes its run record to the repo, so when the
 * token goes, the record of the token going cannot be written either: the runs
 * file simply stops, and a file that stopped looks exactly like a quiet night.
 * That is how a token can expire on the 15th and be noticed on the 20th.
 *
 * So a 401 or 403 from GitHub is mailed out of band, before the error is
 * thrown on. Resend needs no repo. The mail is deduped through the store, so a
 * token that dies on a Sunday sends one alarm rather than one per cron per
 * night until somebody looks.
 *
 * The same module watches the expiry header GitHub returns on every
 * authenticated request, and says something while there is still time to act.
 * An alarm after the fact is a postmortem; a week's notice is a maintenance task.
 */
import { send } from './email.js';
import { one, storeConfigured } from './kv.js';

/* Ops first, artist as the fallback ... this is machinery, not a sale, but an
   alarm nobody reads is worse than an alarm sent to the wrong inbox. */
const OPS = () => process.env.EMAIL_TO_OPS || process.env.EMAIL_TO_ARTIST || null;
const REPO = () => process.env.GITHUB_REPO || 'MintFaced/art';
const QUIET_HOURS = Number(process.env.CREDENTIAL_ALARM_HOURS || 12);
const WARN_DAYS = Number(process.env.CREDENTIAL_WARN_DAYS || 10);

export const isAuthFailure = (status) => status === 401 || status === 403;

/* One alarm per key per window. The store is Upstash, which has nothing to do
   with GitHub, so it still answers when the token is the thing that is broken.
   No store configured means we send ... noise beats silence here. */
async function firstInWindow(key, hours) {
  if (!storeConfigured()) return true;
  try {
    const got = await one('SET', `alarm:${key}`, Date.now(), 'NX', 'EX', Math.round(hours * 3600));
    return got === 'OK';
  } catch (e) {
    return true;
  }
}

/* A 403 from GitHub is two different problems wearing the same number: a token
   that may not do this, and a token that has done too much this hour. Telling
   them apart in the subject line is the difference between minting a new token
   and simply waiting. */
function diagnose(status, headers, body) {
  const remaining = headers.get('x-ratelimit-remaining');
  const retryAfter = headers.get('retry-after');
  if (status === 403 && (remaining === '0' || retryAfter)) {
    const reset = headers.get('x-ratelimit-reset');
    const when = reset ? new Date(Number(reset) * 1000).toISOString() : 'shortly';
    return {
      kind: 'rate',
      subject: 'GitHub: rate limited, not a credential problem',
      text: `GitHub refused with 403 because this token has spent its allowance, not because it lacks permission.\n\n`
        + `The allowance resets at ${when}. Nothing needs replacing. If this repeats nightly the crons are asking for too much, too often.`,
    };
  }
  if (status === 401) {
    return {
      kind: 'dead',
      subject: 'GitHub: the token is dead ... nothing can be written',
      text: `GitHub refused with 401 Bad credentials.\n\n`
        + `A 401 means the token is not valid at all: expired, revoked, or mistyped. It does not mean the scopes are wrong ... `
        + `an alive token with the wrong permissions answers 403, never 401.\n\n`
        + `Until it is replaced, every cron still runs and still reads the chain, but nothing is committed. `
        + `Totals on the site are frozen at the last good night, and the run record cannot even write down that it failed.`,
    };
  }
  return {
    kind: 'scope',
    subject: 'GitHub: the token is alive but not allowed to do this',
    text: `GitHub refused with 403.\n\n`
      + `A 403 with allowance remaining means the token authenticated but is not permitted here: `
      + `wrong repository, or Contents is read-only rather than read and write.\n\n`
      + `This one is fixed by editing the token's permissions, not by minting a new one.`,
  };
}

/**
 * Called on any 401 or 403 from GitHub. Never throws and never changes the
 * caller's error ... the original failure still travels up as it always did.
 */
export async function credentialAlarm({ response, where }) {
  try {
    const to = OPS();
    if (!to) { console.error('credential alarm, nowhere to send it:', where, response.status); return; }

    const body = await response.clone().text().catch(() => '');
    const d = diagnose(response.status, response.headers, body);

    if (!(await firstInWindow(`github:${d.kind}`, QUIET_HOURS))) return;

    await send({
      to,
      subject: d.subject,
      text: `${d.text}\n\nWhere: ${where}\nRepo: ${REPO()}\nGitHub said: ${body.slice(0, 200)}\nAt: ${new Date().toISOString()}\n\n`
        + `The token lives in GITHUB_TOKEN on the art project. Replacing it:\n\n`
        + `  vercel env rm GITHUB_TOKEN production\n`
        + `  vercel env add GITHUB_TOKEN production\n\n`
        + `It needs Contents: read and write on ${REPO()} and nothing else. Write the new expiry date into docs/CHECKOUT.md.\n\n`
        + `This is the only alarm for the next ${QUIET_HOURS} hours.\n\nMintFace`,
    });
  } catch (e) {
    console.error('credential alarm failed to send', String(e));
  }
}

/**
 * GitHub returns the expiry on every request made with a fine grained token.
 * Reading it costs nothing and turns an outage into a diary entry.
 */
export async function noteTokenExpiry(response, where) {
  try {
    const raw = response.headers.get('github-authentication-token-expiration');
    if (!raw) return;                                  // classic or non-expiring
    /* GitHub sends either "2026-09-15 21:30:00 UTC" or "... +0000". Neither is
       ISO, and Date is only reliable on ISO, so normalise before trusting it. */
    const at = new Date(raw.trim()
      .replace(/\s+UTC$/, 'Z')
      .replace(/\s+([+-]\d{2}):?(\d{2})$/, '$1:$2')
      .replace(' ', 'T'));
    if (Number.isNaN(at.getTime())) return;

    const days = (at.getTime() - Date.now()) / 86400000;
    if (days > WARN_DAYS || days < 0) return;

    const to = OPS();
    if (!to) return;
    if (!(await firstInWindow(`github:expiry:${at.toISOString().slice(0, 10)}`, 24))) return;

    await send({
      to,
      subject: `GitHub: the token expires in ${Math.floor(days)} days`,
      text: `The GitHub token on the art project expires ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC, `
        + `which is ${Math.floor(days)} days away.\n\n`
        + `When it goes, every cron keeps running and nothing gets committed: totals freeze at the last good night `
        + `and the run record cannot write down why. Replacing it now costs a minute.\n\n`
        + `  vercel env rm GITHUB_TOKEN production\n`
        + `  vercel env add GITHUB_TOKEN production\n\n`
        + `Contents: read and write on ${REPO()}, nothing else. Then write the new expiry into docs/CHECKOUT.md.\n\n`
        + `Seen at: ${where}\n\nMintFace`,
    });
  } catch (e) {
    console.error('token expiry note failed', String(e));
  }
}
