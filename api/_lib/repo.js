// Reading and writing any file in the repo. Sale state has its own module with
// compare-and-set logic because two buyers can race; this is for the studio,
// where the only writer is Ryan on a phone.
import { credentialAlarm, isAuthFailure, noteTokenExpiry } from './credentials.js';

const REPO = process.env.GITHUB_REPO || 'MintFaced/art';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const API = process.env.GITHUB_API_BASE || 'https://api.github.com';
const WHERE = 'repo';

export const repoConfigured = () => Boolean(TOKEN);

const api = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  /* Out of band, because the usual way of reporting a failure is the repo, and
     the repo is what just refused us. Neither call throws or alters `r`. */
  if (isAuthFailure(r.status)) await credentialAlarm({ response: r, where: WHERE });
  else await noteTokenExpiry(r, WHERE);
  return r;
};

export async function readFile(path) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const r = await api(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404) return { sha: null, text: null };
  if (!r.ok) throw new Error(`github read ${r.status}`);
  const j = await r.json();
  return { sha: j.sha, text: Buffer.from(j.content, 'base64').toString('utf8') };
}

export async function writeFile(path, text, message, sha) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const r = await api(`/repos/${REPO}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(text, 'utf8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) throw new Error(`github write ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
