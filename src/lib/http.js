// Small HTTP helpers.

/** Wrap an async route so thrown errors reach the Express error handler. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse a YYYY-MM-DD date at UTC midnight (dates are day-granular here). */
export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** YYYY-MM-DD string for a Date (UTC). */
export function ymd(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10);
}

/** The day before a Date (UTC). */
export function prevDay(d) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - 1);
  return x;
}
