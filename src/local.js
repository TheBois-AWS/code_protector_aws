import http from 'http';
import { URL } from 'url';
import { config } from './config.js';
import { handler } from './index.js';

function toHeadersMap(headers) {
  const map = {};
  for (const [key, value] of Object.entries(headers || {})) {
    map[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return map;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${config.port}`}`);
    const rawBody = await readBody(req);

    const event = {
      version: '2.0',
      routeKey: '$default',
      rawPath: url.pathname,
      rawQueryString: url.searchParams.toString(),
      headers: toHeadersMap(req.headers),
      requestContext: {
        http: {
          method: (req.method || 'GET').toUpperCase(),
          path: url.pathname,
          sourceIp: req.socket?.remoteAddress || '127.0.0.1'
        }
      },
      body: rawBody.length ? rawBody.toString('utf-8') : '',
      isBase64Encoded: false
    };

    const response = await handler(event);
    res.statusCode = response.statusCode || 200;

    for (const [key, value] of Object.entries(response.headers || {})) {
      res.setHeader(key, value);
    }

    if (Array.isArray(response.cookies) && response.cookies.length) {
      res.setHeader('Set-Cookie', response.cookies);
    }

    res.end(response.body || '');
  } catch (error) {
    console.error('Local server error', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
});

server.listen(config.port, () => {
  console.log(`code_protector_aws local API listening on http://localhost:${config.port}`);
});
