export function getStorageItem(key, fallback = '') {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setStorageItem(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorageItem(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getStorageJson(key, fallback = null) {
  const raw = getStorageItem(key, '');
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setStorageJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearStorageByPrefix(prefixes = []) {
  try {
    const list = Array.isArray(prefixes) ? prefixes : [prefixes];
    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (list.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return keys;
  } catch {
    return [];
  }
}
