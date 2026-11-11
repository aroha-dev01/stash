import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether `given` is the configured secret, in constant time. Both sides are
 * hashed first, so neither the comparison's timing nor a length mismatch says
 * anything about the secret. An unset or empty secret never matches.
 */
export function sameSecret(given, expected) {
  if (!expected || !given) return false;
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

/** The bearer token from an Authorization header, or ''. */
export function bearerOf(req) {
  const h = req.headers.get('authorization') || '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}
