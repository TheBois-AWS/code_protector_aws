import crypto from 'node:crypto';
import { routeRequest } from './router.js';
import { getCorsHeaders, jsonResponse } from './utils/http.js';
import { handleWebSocketEvent } from './websocket.js';
import { config } from './config.js';

function normalizeHeaders(rawHeaders = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    normalized[key] = value;
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function parseQuery(rawQueryString = '') {
  const query = {};
  const params = new URLSearchParams(rawQueryString || '');
  for (const [key, value] of params.entries()) {
    query[key] = value;
  }
  return query;
}

function normalizeEvent(event = {}) {
  const headers = normalizeHeaders(event.headers || {});
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  const path = event.rawPath || event.path || '/';
  const rawQueryString = event.rawQueryString || '';
  const query = parseQuery(rawQueryString);

  let body = event.body || '';
  if (event.isBase64Encoded && body) {
    body = Buffer.from(body, 'base64').toString('utf-8');
  }

  return {
    method,
    path,
    rawQueryString,
    query,
    headers,
    body,
    isBase64Encoded: false,
    requestContext: event.requestContext || {}
  };
}

function isWebSocketEvent(event = {}) {
  return !!(event?.requestContext?.connectionId && event?.requestContext?.routeKey);
}

function isOriginLockedPath(path = '') {
  return path === '/api' || path.startsWith('/api/') || path === '/files' || path.startsWith('/files/');
}

function timingSafeEquals(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left), 'utf-8');
  const rightBuffer = Buffer.from(String(right), 'utf-8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidOriginVerifyHeader(request) {
  const expected = config.apiOriginVerifySecret;
  if (!expected || config.lambdaMode !== 'lambda') return true;

  const headerName = (config.apiOriginVerifyHeader || 'x-origin-verify').toLowerCase();
  const provided = request.headers[headerName] || '';
  return timingSafeEquals(provided, expected);
}

function applyCors(response, headers) {
  const corsHeaders = getCorsHeaders(headers);
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      ...corsHeaders
    }
  };
}

export async function handler(event) {
  if (isWebSocketEvent(event)) {
    return await handleWebSocketEvent(event);
  }

  const request = normalizeEvent(event);

  if (request.method === 'OPTIONS') {
    return applyCors({
      statusCode: 204,
      headers: {},
      body: ''
    }, request.headers);
  }

  if (isOriginLockedPath(request.path) && !hasValidOriginVerifyHeader(request)) {
    return applyCors(jsonResponse(403, { success: false, error: 'Forbidden' }), request.headers);
  }

  try {
    const response = await routeRequest(request);
    return applyCors(response, request.headers);
  } catch (error) {
    console.error('Unhandled error', error);
    return applyCors(jsonResponse(500, { success: false, error: 'Internal server error' }), request.headers);
  }
}

export default { handler };
