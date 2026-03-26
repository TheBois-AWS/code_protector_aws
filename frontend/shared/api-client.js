import { AUTH_TOKEN_KEY, isApiLikeRequest } from './config.js';
import { getStorageItem } from './storage.js';

function normalizeHeaders(headers) {
  if (!headers) return new Headers();
  if (headers instanceof Headers) return new Headers(headers);
  return new Headers(headers);
}

function hasHeader(headers, name) {
  return headers.has(name) || headers.has(name.toLowerCase());
}

function resolveToken(tokenProvider) {
  if (typeof tokenProvider === 'function') {
    try {
      return tokenProvider() || '';
    } catch {
      return '';
    }
  }
  return getStorageItem(AUTH_TOKEN_KEY, '');
}

function dispatchApiEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function createApiError({ response = null, data = null, path = '', message = '' } = {}) {
  const status = response?.status || 0;
  const derived = message
    || data?.error
    || data?.message
    || response?.statusText
    || 'Request failed';

  const error = new Error(String(derived));
  error.name = 'ApiError';
  error.status = status;
  error.path = path;
  error.data = data;
  error.response = response;
  error.retryable = status === 0 || status >= 500;
  return error;
}

export async function readResponseData(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

let installed = false;
let nativeFetch = null;

export function installApiClient({
  tokenProvider,
  onUnauthorized,
  onForbidden,
  onHttpError,
  onNetworkError,
  onServerError,
  requestDefaults = {}
} = {}) {
  if (installed) return;

  installed = true;
  nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const isApi = isApiLikeRequest(input);

    let nextInit = init;
    let path = '';

    if (isApi) {
      const headers = normalizeHeaders(init.headers);
      const token = resolveToken(tokenProvider);

      if (token && !hasHeader(headers, 'Authorization')) {
        headers.set('Authorization', token);
      }

      if (!hasHeader(headers, 'X-Requested-With')) {
        headers.set('X-Requested-With', 'fetch');
      }

      nextInit = {
        credentials: 'same-origin',
        ...requestDefaults,
        ...init,
        headers
      };

      path = typeof input === 'string' ? input : (input?.url || '');
    }

    try {
      const response = await nativeFetch(input, nextInit);

      if (isApi) {
        if (response.status >= 500) {
          dispatchApiEvent('app:api:server-error', { path, status: response.status });
          if (typeof onServerError === 'function') {
            onServerError({ path, status: response.status, response });
          }
        }

        if (response.status === 401 && typeof onUnauthorized === 'function') {
          onUnauthorized({ path, response });
        }

        if (response.status === 403 && typeof onForbidden === 'function') {
          onForbidden({ path, response });
        }

        if (!response.ok && typeof onHttpError === 'function') {
          onHttpError({ path, response, status: response.status });
        }
      }

      return response;
    } catch (error) {
      if (isApi) {
        dispatchApiEvent('app:api:network-error', { path, error });
        if (typeof onNetworkError === 'function') {
          onNetworkError({ path, error });
        }
      }
      throw error;
    }
  };
}

export async function apiJson(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers,
    cache = 'no-store'
  } = options;

  const nextHeaders = normalizeHeaders(headers);
  const hasBody = body !== undefined && body !== null;

  let payload = body;
  if (hasBody && typeof body !== 'string' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
    if (!hasHeader(nextHeaders, 'Content-Type')) {
      nextHeaders.set('Content-Type', 'application/json');
    }
    payload = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method,
    headers: nextHeaders,
    cache,
    body: hasBody ? payload : undefined
  });

  const data = await readResponseData(response);
  if (!response.ok || data?.success === false) {
    throw createApiError({ response, data, path });
  }

  return { response, data };
}
