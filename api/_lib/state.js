// Sale and reserve state is committed back to the repo, so catalog.json stays the
// single source of truth and every state change has an author, a time and a diff.
// A commit triggers a Vercel deploy, so the site catches up in about a minute.
const REPO = process.env.GITHUB_REPO || 'MintFaced/art';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const PATH = 'data/state.json';
const TOKEN = process.env.GITHUB_TOKEN;

const API = process.env.GITHUB_API_BASE || 'https://api.github.com';

const api = (path, init = {}) => fetch(`${API}${path}`, {
  ...init,
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    ...(init.headers || {}),
  },
});

export function stateConfigured() {
  return Boolean(TOKEN);
}

export async function readState() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set, cannot read or write sale state');
  const r = await api(`/repos/${REPO}/contents/${PATH}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404) return { sha: null, state: { works: {} } };
  if (!r.ok) throw new Error(`github read ${r.status}`);
  const j = await r.json();
  const body = Buffer.from(j.content, 'base64').toString('utf8');
  return { sha: j.sha, state: JSON.parse(body) };
}

/**
 * Apply a change to one work and commit it.
 * Retries once on a 409, which is what a concurrent write looks like.
 */
export async function writeWorkState(id, patch, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, state } = await readState();
    state.works = state.works || {};
    state.works[id] = { ...(state.works[id] || {}), ...patch, updated: new Date().toISOString() };
    state.updated = new Date().toISOString();

    const r = await api(`/repos/${REPO}/contents/${PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (r.ok) return state.works[id];
    if (r.status !== 409) throw new Error(`github write ${r.status} ${await r.text()}`);
  }
  throw new Error('github write conflict twice');
}

/**
 * Compare and set. Claims a work only if it is currently in one of `expect`,
 * which is what stops two buyers holding the same painting. A conflicting write
 * sends us round again to re-read and re-check rather than blindly overwriting.
 */
export async function claimWork(id, { expect, patch, message, fallbackStatus = 'available' }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, state } = await readState();
    state.works = state.works || {};
    const current = state.works[id];
    const status = current?.status || fallbackStatus;

    if (!expect.includes(status)) {
      const err = new Error(status === 'pending'
        ? 'someone is at the checkout with this one, try again in a few minutes'
        : `this work is ${status}`);
      err.code = 'claimed';
      err.status = status;
      throw err;
    }

    state.works[id] = { ...(current || {}), ...patch, updated: new Date().toISOString() };
    state.updated = new Date().toISOString();

    const r = await api(`/repos/${REPO}/contents/${PATH}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64'),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (r.ok) return state.works[id];
    if (r.status !== 409) throw new Error(`github write ${r.status} ${await r.text()}`);
    // someone else wrote first, loop and look again
  }
  const err = new Error('the checkout is busy, try again in a moment');
  err.code = 'contended';
  throw err;
}

export async function workState(id) {
  const { state } = await readState();
  return (state.works || {})[id] || null;
}
