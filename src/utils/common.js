import crypto from 'crypto';

export function randomId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

export function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function sortByDateDesc(items, field = 'created_at') {
  return [...items].sort((left, right) => String(right?.[field] || '').localeCompare(String(left?.[field] || '')));
}

export function isProbablyId(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}
