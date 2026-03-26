export const AUTH_TOKEN_KEY = 'token';
export const AUTH_RETURN_TO_KEY = 'auth_return_to';
export const AUTH_LOGIN_PATH = '/login';
export const AUTH_REGISTER_PATH = '/register';
export const AUTH_DEFAULT_REDIRECT = '/dashboard';

export const API_PREFIXES = ['/api/', '/files/'];

export const WS_RECONNECT = Object.freeze({
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  debounceMs: 300
});

export const NETWORK_MESSAGES = Object.freeze({
  offline: 'You are offline. Reconnect to continue syncing.',
  networkError: 'Network error. Check your connection and retry.',
  serverBusy: 'Server is busy right now. Retrying may help.',
  connectionIssue: 'Connection issue detected. Some actions may fail.'
});

export function isApiPath(path) {
  if (!path || typeof path !== 'string') return false;
  return API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function toRequestPath(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

export function isApiLikeRequest(input) {
  const value = toRequestPath(input);
  if (!value) return false;

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return isApiPath(url.pathname);
    } catch {
      return false;
    }
  }

  if (value.startsWith('//')) return false;
  return isApiPath(value.startsWith('/') ? value : `/${value}`);
}
