/* Static file server for the app itself — `node scripts/serve.mjs`, then open the printed URL.
 *
 * Opening index.html by double-clicking works for almost everything, but a file:// page has no
 * origin: YouTube's embedded player rejects it outright (error 153, see js/music.js), so session
 * music can't work that way. This serves the project folder over plain http instead, which gives
 * the page a real origin. Node built-ins only, no install — same rule as the rest of scripts/.
 *
 *   node scripts/serve.mjs            → http://localhost:8025
 *   node scripts/serve.mjs 3000       → http://localhost:3000
 *
 * Loopback-only, like scripts/valorant-local-server.mjs: it binds 127.0.0.1, so nothing outside
 * this machine can reach it. Ctrl+C to stop.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT) || 8025;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

const server = createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // resolve inside ROOT and verify it stayed there — a request for /../../secrets must not escape
  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  // the app's own local secrets live in scripts/.valorant-*.json — never hand those out over
  // http, even on loopback, since any page in the browser could then fetch them
  if (path.basename(filePath).startsWith('.')) {
    res.writeHead(404).end('Not found');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      // the app is edited live and reloaded constantly — a cached copy is never what you want here
      'Cache-Control': 'no-store'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Project 25 served from ${ROOT}`);
  console.log(`  → http://localhost:${PORT}    (loopback only; Ctrl+C to stop)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use — try: node scripts/serve.mjs 8026`);
  else console.error(err.message);
  process.exit(1);
});
