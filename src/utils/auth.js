import crypto from 'crypto';
import { base64UrlDecode, base64UrlEncode } from './crypto.js';
import { appConfigRepo, usersRepo } from '../services/repositories.js';
import { forbidden, parseCookies, unauthorized } from './http.js';

const TOKEN_PREFIX = 'v2';
const AUTH_SECRET_KEY = 'auth_secret';
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BYTES = 32;
const SYSTEM_ADMIN_ROLE = 'admin';

function base64UrlEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecodeBytes(value) {
  let padded = value.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

async function getOrCreateAuthSecret() {
  const current = await appConfigRepo.get(AUTH_SECRET_KEY);
  if (current) return String(current);
  const created = base64UrlEncodeBytes(crypto.randomBytes(48));
  await appConfigRepo.set(AUTH_SECRET_KEY, created);
  return created;
}

export async function getAuthSecret() {
  return await getOrCreateAuthSecret();
}

function hmacBase64(secret, data) {
  return base64UrlEncodeBytes(crypto.createHmac('sha256', secret).update(data).digest());
}

export async function hashPassword(password) {
  return await new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(PBKDF2_SALT_BYTES);
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, 'sha256', (error, derived) => {
      if (error) return reject(error);
      resolve(`pbkdf2$${PBKDF2_ITERATIONS}$${base64UrlEncodeBytes(salt)}$${base64UrlEncodeBytes(derived)}`);
    });
  });
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash) return { ok: false, needsUpgrade: false };

  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 4) return { ok: false, needsUpgrade: false };
    const iterations = Number(parts[1]);
    const salt = base64UrlDecodeBytes(parts[2]);
    const expected = parts[3];
    if (!iterations || !expected) return { ok: false, needsUpgrade: false };

    return await new Promise((resolve) => {
      crypto.pbkdf2(password, Buffer.from(salt), iterations, PBKDF2_KEY_BYTES, 'sha256', (error, derived) => {
        if (error) return resolve({ ok: false, needsUpgrade: false });
        const actual = base64UrlEncodeBytes(derived);
        resolve({ ok: timingSafeEqual(actual, expected), needsUpgrade: iterations < PBKDF2_ITERATIONS });
      });
    });
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    return { ok: timingSafeEqual(legacy.toLowerCase(), storedHash.toLowerCase()), needsUpgrade: true };
  }

  return { ok: false, needsUpgrade: false };
}

export async function generateAuthToken(userId, ttlSeconds = 60 * 60 * 24 * 7) {
  const secret = await getOrCreateAuthSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload = { uid: String(userId), iat: now, exp: now + ttlSeconds, v: TOKEN_PREFIX };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacBase64(secret, encoded);
  return `${TOKEN_PREFIX}.${encoded}.${signature}`;
}

export async function getTokenFromRequest(request) {
  let token = request.headers.authorization || request.headers.Authorization || '';
  if (!token) {
    const cookies = parseCookies(request.headers);
    token = cookies.token || '';
  }
  if (token.startsWith('Bearer ')) token = token.slice(7);
  return token || null;
}

export async function getUserIdFromRequest(request) {
  const token = await getTokenFromRequest(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;

  const secret = await getOrCreateAuthSecret();
  if (!timingSafeEqual(hmacBase64(secret, parts[1]), parts[2])) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.uid || !payload.exp || now >= Number(payload.exp)) return null;

  const user = await usersRepo.getById(String(payload.uid));
  if (!user || user.status !== 'active') return null;
  if (user.password_changed_at && payload.iat && Number(payload.iat) < Number(user.password_changed_at)) return null;

  return String(user.id);
}

export async function getUserFromRequest(request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return null;
  return await usersRepo.getById(String(userId));
}

export function isSystemAdmin(user) {
  return Boolean(user && String(user.status || 'active') === 'active' && String(user.role || '').toLowerCase() === SYSTEM_ADMIN_ROLE);
}

export async function isSystemAdminByUserId(userId) {
  if (!userId) return false;
  const user = await usersRepo.getById(String(userId));
  return isSystemAdmin(user);
}

export async function requireSystemAdmin(request) {
  const user = await getUserFromRequest(request);
  if (!user) return { ok: false, response: unauthorized() };
  if (!isSystemAdmin(user)) return { ok: false, response: forbidden() };
  return { ok: true, user };
}

export { SYSTEM_ADMIN_ROLE, TOKEN_PREFIX };
