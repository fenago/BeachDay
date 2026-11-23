// Tiny static server for the SW example. Mimics the Netlify setup:
// - /sw.js: Cache-Control: no-cache, and __BUILD_VERSION__ replaced with the current build version
// - /manifest.webmanifest: Content-Type application/manifest+json
// - /api/*: a fake Netlify Function (Cache-Control: no-store) so we can prove it is never cached
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

export function startServer({ port = 0, version = 'v1' } = {}) {
  let apiHits = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      apiHits++;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ hits: apiHits }));
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try {
      let body = await readFile(file);
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
      if (path === '/sw.js') {
        body = Buffer.from(body.toString('utf8').replace('const VERSION = "__BUILD_VERSION__"', `const VERSION = "${version}"`));
        headers['cache-control'] = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    server, port: server.address().port, apiHits: () => apiHits,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startServer({ port: Number(process.env.PORT ?? 8080), version: process.env.VERSION ?? 'dev' });
  console.log(`http://localhost:${s.port}/`);
}
