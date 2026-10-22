/**
 * Local preview of the Pages artifact, served from the same subpath production
 * uses: http://localhost:4173/yurewatch/
 *
 * Serving from `/` would hide exactly the class of bug that breaks GitHub Pages
 * (root-absolute asset paths, `viewer/` resolving to the wrong place), so the
 * subpath is reproduced deliberately.
 *
 *   npm run site:build && npm run site:serve
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const PREFIX = '/yurewatch';
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveTarget(pathname) {
  let rel = pathname;
  if (rel === PREFIX || rel === `${PREFIX}/`) rel = '/';
  else if (rel.startsWith(`${PREFIX}/`)) rel = rel.slice(PREFIX.length);
  else return null;

  rel = normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, '');
  let target = join(OUT, rel);

  // Never serve outside the artifact directory.
  if (!target.startsWith(OUT)) return null;

  try {
    const s = await stat(target);
    if (s.isDirectory()) target = join(target, 'index.html');
  } catch {
    return null;
  }
  return target;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let pathname = url.pathname;

  // Trailing slash → directory index, matching Pages behaviour.
  if (pathname.endsWith('/')) pathname = pathname.slice(0, -1) || '/';
  if (pathname === '/yurewatch') pathname = '/yurewatch/';

  if (pathname === '/') {
    res.writeHead(302, { location: `${PREFIX}/` });
    res.end();
    return;
  }

  const target = await resolveTarget(pathname);
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 — not found: ${pathname}\n(have you run \`npm run site:build\`?)`);
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`site preview: http://localhost:${PORT}${PREFIX}/`);
  console.log(`              http://localhost:${PORT}${PREFIX}/viewer/`);
});
