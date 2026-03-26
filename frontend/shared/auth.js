import {
  AUTH_DEFAULT_REDIRECT,
  AUTH_LOGIN_PATH,
  AUTH_REGISTER_PATH,
  AUTH_RETURN_TO_KEY,
  AUTH_TOKEN_KEY
} from './config.js';
import {
  clearStorageByPrefix,
  getStorageItem,
  removeStorageItem,
  setStorageItem
} from './storage.js';

export function sanitizeReturnToPath(path) {
  if (!path) return '';
  const value = String(path).trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '';
  if (value.startsWith(AUTH_LOGIN_PATH) || value.startsWith(AUTH_REGISTER_PATH)) return '';
  return value;
}

export function getCurrentReturnToPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getReturnToFromQuery(search = window.location.search) {
  try {
    const params = new URLSearchParams(search || '');
    return sanitizeReturnToPath(params.get('returnTo'));
  } catch {
    return '';
  }
}

export function getStoredReturnTo() {
  return sanitizeReturnToPath(getStorageItem(AUTH_RETURN_TO_KEY, ''));
}

export function persistReturnTo(path) {
  const safe = sanitizeReturnToPath(path);
  if (!safe) return '';
  setStorageItem(AUTH_RETURN_TO_KEY, safe);
  return safe;
}

export function clearStoredReturnTo() {
  removeStorageItem(AUTH_RETURN_TO_KEY);
}

export function getResolvedReturnTo({
  search = window.location.search,
  fallback = AUTH_DEFAULT_REDIRECT,
  persist = true
} = {}) {
  const fromQuery = getReturnToFromQuery(search);
  if (persist && fromQuery) persistReturnTo(fromQuery);
  return fromQuery || getStoredReturnTo() || fallback;
}

export function buildAuthPageLink(basePath, returnTo) {
  const safe = sanitizeReturnToPath(returnTo);
  return safe ? `${basePath}?returnTo=${encodeURIComponent(safe)}` : basePath;
}

export function redirectToLogin({
  returnTo = getCurrentReturnToPath(),
  replace = true
} = {}) {
  const safe = persistReturnTo(returnTo) || AUTH_DEFAULT_REDIRECT;
  const target = buildAuthPageLink(AUTH_LOGIN_PATH, safe);
  if (replace) window.location.replace(target);
  else window.location.href = target;
}

export function redirectAfterAuthSuccess(returnTo, fallback = AUTH_DEFAULT_REDIRECT) {
  const target = sanitizeReturnToPath(returnTo) || fallback;
  clearStoredReturnTo();
  window.location.replace(target);
}

export function getAuthToken() {
  return getStorageItem(AUTH_TOKEN_KEY, '');
}

export function setAuthToken(token) {
  if (!token) {
    removeStorageItem(AUTH_TOKEN_KEY);
    return;
  }
  setStorageItem(AUTH_TOKEN_KEY, String(token));
}

export function clearAuthSession({ clearPinTokens = true } = {}) {
  removeStorageItem(AUTH_TOKEN_KEY);
  if (clearPinTokens) {
    clearStorageByPrefix(['pin_token_', 'pin_token_expires_']);
  }
}

export async function validateDualSession({
  token = getAuthToken(),
  profilePath = '/api/user/profile'
} = {}) {
  if (!token) return { ok: false, reason: 'missing-token' };

  try {
    const [tokenRes, cookieRes] = await Promise.all([
      fetch(profilePath, {
        headers: { Authorization: token },
        cache: 'no-store'
      }),
      fetch(profilePath, {
        cache: 'no-store'
      })
    ]);

    if (!tokenRes.ok || !cookieRes.ok) {
      return {
        ok: false,
        status: tokenRes.status || cookieRes.status,
        tokenStatus: tokenRes.status,
        cookieStatus: cookieRes.status
      };
    }

    let data = {};
    try {
      data = await tokenRes.json();
    } catch {
      data = {};
    }

    return {
      ok: true,
      data,
      user: data?.user || null,
      tokenStatus: tokenRes.status,
      cookieStatus: cookieRes.status
    };
  } catch (error) {
    return { ok: false, reason: 'network', error };
  }
}

export async function loadProfile({
  token = getAuthToken(),
  profilePath = '/api/user/profile'
} = {}) {
  const headers = token ? { Authorization: token } : undefined;
  const response = await fetch(profilePath, { headers, cache: 'no-store' });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { response, data, user: data?.user || null };
}
