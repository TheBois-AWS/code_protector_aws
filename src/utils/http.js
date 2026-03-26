import { config } from '../config.js';

function normalizeOrigin(headers = {}) {
  return headers.origin || headers.Origin || '';
}

export function getCorsHeaders(headers = {}) {
  const origin = normalizeOrigin(headers);
  let allowOrigin = '*';

  if (config.allowedOrigins[0] !== '*') {
    allowOrigin = config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0] || '';
  }

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-pin-token,x-admin-guard-token',
    vary: 'origin'
  };
}

export function parseCookies(headers = {}) {
  const raw = headers.cookie || headers.Cookie || '';
  const parts = raw.split(';').map((entry) => entry.trim()).filter(Boolean);
  const cookies = {};
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding should not break request auth parsing.
      cookies[key] = value;
    }
  }
  return cookies;
}

export function jsonResponse(statusCode, payload, headers = {}, cookies = []) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    },
    cookies,
    body: JSON.stringify(payload)
  };
}

export function textResponse(statusCode, body, headers = {}, cookies = []) {
  return {
    statusCode,
    headers,
    cookies,
    body
  };
}

export function redirectResponse(location) {
  return {
    statusCode: 302,
    headers: { location },
    body: ''
  };
}

export function badRequest(error) {
  return jsonResponse(400, { success: false, error });
}

export function unauthorized(error = 'Unauthorized') {
  return jsonResponse(401, { success: false, error });
}

export function forbidden(error = 'Forbidden') {
  return jsonResponse(403, { success: false, error });
}

export function notFound(error = 'Not Found') {
  return jsonResponse(404, { success: false, error });
}

export function methodNotAllowed() {
  return jsonResponse(405, { success: false, error: 'Method Not Allowed' });
}

export function serverError(error = 'Internal server error') {
  return jsonResponse(500, { success: false, error });
}

export function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'] || request.headers['X-Forwarded-For'];
  const raw = forwarded ? String(forwarded).split(',')[0].trim() : (request.requestContext?.http?.sourceIp || request.ip || '127.0.0.1');
  const ipv4 = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return ipv4 ? ipv4[1] : raw;
}

export function createCookie(name, value, options = {}) {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) pieces.push(`Path=${options.path}`);
  if (options.httpOnly) pieces.push('HttpOnly');
  if (options.secure) pieces.push('Secure');
  if (options.sameSite) pieces.push(`SameSite=${options.sameSite}`);
  if (options.maxAge !== undefined) pieces.push(`Max-Age=${options.maxAge}`);
  if (options.expires) pieces.push(`Expires=${options.expires.toUTCString()}`);
  return pieces.join('; ');
}

export function parseJsonBody(request) {
  if (!request.body) return null;
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}
