// Auth & access control. Enforced SERVER-SIDE on every protected route.
// Access = role + location. A MANAGER can never see the other restaurant.
import { t } from '../lib/i18n.js';

/** Require an authenticated session. */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: t('errors.forbidden') });
  }
  req.user = req.session.user;
  next();
}

/** Require one of the given roles (e.g. requireRole('DIRECTION')). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: t('errors.forbidden') });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: t('errors.forbidden') });
    }
    next();
  };
}

// Roles that see BOTH restaurants (no per-location restriction).
export const ALL_LOCATION_ROLES = ['DIRECTION', 'ORDER_MANAGER'];

/**
 * Which location IDs the user may see.
 * @returns {number[]|null} explicit list, or null meaning "all locations"
 */
export function allowedLocationIds(user) {
  if (ALL_LOCATION_ROLES.includes(user.role)) return null; // all
  return user.locationId != null ? [user.locationId] : [];
}

/**
 * Assert the user may act on `locationId`. Direction/Order Manager: any.
 * Manager: only theirs. Returns the effective locationId, or throws {status,message}.
 */
export function assertLocationAccess(user, locationId) {
  const id = Number(locationId);
  if (Number.isNaN(id)) {
    const e = new Error(t('errors.validation'));
    e.status = 400;
    throw e;
  }
  if (ALL_LOCATION_ROLES.includes(user.role)) return id;
  if (user.locationId === id) return id;
  const e = new Error(t('errors.forbidden'));
  e.status = 403;
  throw e;
}

/**
 * Resolve the location a location-scoped request targets.
 * Direction must pass ?location / body.locationId; Manager is pinned to theirs.
 */
export function resolveLocation(req) {
  // Direction / Order Manager may pass ?locationId=; a manager is pinned to theirs.
  // Fall back to the user's own location, else the first restaurant, so a
  // location-scoped call made without an explicit id doesn't 400/403.
  const requested = req.query.locationId ?? req.query.location ?? req.body?.locationId ?? req.user?.locationId ?? 1;
  if (req.user.role === 'MANAGER') return req.user.locationId;
  return assertLocationAccess(req.user, requested);
}

/** Roles allowed to reach the order lifecycle endpoints. */
export const ORDER_ROLES = ['DIRECTION', 'ORDER_MANAGER'];
/** Roles that operate a restaurant floor (stock counts, sales, reconciliation). */
export const FLOOR_ROLES = ['DIRECTION', 'MANAGER'];
