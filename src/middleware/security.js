// Security middleware: HTTP hardening headers + a tiny in-memory rate limiter.
// Kept dependency-free (works cleanly on shared hosting).
import { config } from '../config.js';

// ── Security headers ────────────────────────────────────────────────────────────
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP tuned for the built Vite SPA (same-origin JS/CSS; React uses inline style attrs).
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
    ].join('; '),
  );
  next();
}

// ── Rate limiter (fixed window, in-memory) ──────────────────────────────────────
export function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }
  // Opportunistic cleanup so the map does not grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${retry}s.` });
    }
    next();
  };
}

// Login limiter: per IP + attempted username.
export const loginLimiter = rateLimit({
  windowMs: config.security.loginWindowMs,
  max: config.security.loginMaxAttempts,
  keyFn: (req) => `${req.ip}:${(req.body?.username || '').toLowerCase()}`,
});
