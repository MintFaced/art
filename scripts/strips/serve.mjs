/* The site for a browser test: static files from the checkout and the real API
 * handlers, on a local port. Nothing here is deployed.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const REWRITES = [
  [/^\/api\/strips-admin$/, 'api/strips-admin.js'], [/^\/api\/strips\/.+/, 'api/strips.js'], [/^\/api\/strip-render/, 'api/strip-render.js'], [/^\/api\/strip-sites/, 'api/strip-sites.js'],
];
const PAGES = [[/^\/c\/strip-paintings\/strips\/\d+$/, 'strips-token.html'], [/^\/mintwork\/strips$/, 'mintwork/strips.html']];

async function api(file, req, res, url) {
  const mod = await import(pathToFileURL(join(ROOT, file)).href);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost${url.pathname}${url.search}`, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
  const handler = mod[req.method];
  if (!handler) { res.writeHead(405); res.end(); return; }
  const r = await handler(request);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

export function serve(port = 0, { stub = {} } = {}) {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      try {
        if (stub[url.pathname]) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(stub[url.pathname])); return; }
        const hit = REWRITES.find(([re]) => re.test(url.pathname));
        if (hit) { await api(hit[1], req, res, url); return; }
        const page = PAGES.find(([re]) => re.test(url.pathname));
        let path = page ? page[1] : normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
        let file = join(ROOT, path || 'index.html');
        const s = await stat(file).catch(() => null);
        if (!s || s.isDirectory()) file = `${file.replace(/\/$/, '')}.html`;
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch (e) {
        res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
        res.end(String(e.message));
      }
    }).listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
