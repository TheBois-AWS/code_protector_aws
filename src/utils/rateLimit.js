import { rateLimitsRepo } from '../services/repositories.js';
import { unixNow } from './common.js';

export async function checkRateLimit(key, windowSeconds, max) {
  const now = unixNow();
  const windowStart = now - (now % windowSeconds);
  const current = await rateLimitsRepo.get(key);

  if (!current || Number(current.window_start) !== windowStart) {
    await rateLimitsRepo.set(key, {
      key,
      window_start: windowStart,
      count: 1,
      expires_at: now + Math.max(windowSeconds, 3600)
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const count = Number(current.count || 0);
  if (count >= max) {
    return { allowed: false, retryAfterSeconds: Math.max(1, windowSeconds - (now - windowStart)) };
  }

  await rateLimitsRepo.increment(key, windowStart, now + Math.max(windowSeconds, 3600));
  return { allowed: true, retryAfterSeconds: 0 };
}

export function buildRateLimitKey(scope, request, extra = '') {
  const sourceIp = request.headers['x-forwarded-for'] || request.requestContext?.http?.sourceIp || request.ip || 'unknown';
  return `${scope}:${String(sourceIp).split(',')[0].trim()}${extra ? `:${extra}` : ''}`;
}
