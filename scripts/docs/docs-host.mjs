import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DOCS_HOST_PORT || 4180);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const MOCK_API_ORIGIN = process.env.MOCK_API_ORIGIN || `http://127.0.0.1:${process.env.DOCS_MOCK_API_PORT || 4181}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8'
};

function hasExtension(pathname) {
  return path.posix.basename(pathname).includes('.');
}

function withinFrontend(candidate) {
  const normalizedRoot = `${path.resolve(FRONTEND)}${path.sep}`;
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === path.resolve(FRONTEND) || normalizedCandidate.startsWith(normalizedRoot);
}

function buildCandidatePaths(pathname) {
  const clean = pathname || '/';

  if (clean === '/' || clean === '') {
    return [path.join(FRONTEND, 'index.html')];
  }

  if (clean === '/login' || clean === '/register' || clean === '/dashboard') {
    return [path.join(FRONTEND, clean.slice(1), 'index.html')];
  }

  if (clean.startsWith('/workspace') && !hasExtension(clean)) {
    return [path.join(FRONTEND, 'workspace', 'index.html')];
  }

  const rawPath = clean.replace(/^\/+/, '');
  const direct = path.join(FRONTEND, rawPath);

  if (hasExtension(clean)) {
    return [direct];
  }

  return [
    path.join(FRONTEND, rawPath, 'index.html'),
    direct,
    path.join(FRONTEND, 'index.html')
  ];
}

async function readFileSafe(file) {
  if (!withinFrontend(file)) return null;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function serveStatic(pathname, res) {
  const candidates = buildCandidatePaths(pathname);

  for (const file of candidates) {
    const body = await readFileSafe(file);
    if (!body) continue;

    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
    return true;
  }

  return false;
}

async function proxyRequest(req, res, url) {
  const target = new URL(url.pathname + url.search, MOCK_API_ORIGIN);
  const body = ['GET', 'HEAD'].includes(req.method || 'GET')
    ? undefined
    : await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const response = await fetch(target, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([name]) => name.toLowerCase() !== 'host')),
    body
  });

  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export function startDocsHost(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);

    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) {
        await proxyRequest(req, res, url);
        return;
      }

      const served = await serveStatic(url.pathname, res);
      if (served) return;

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (error) {
      console.error('docs host error', error);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal docs host error');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`Docs host listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDocsHost().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}