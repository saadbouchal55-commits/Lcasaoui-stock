// Business-day logic. The trading day runs from `startHour` (11:00) to the same
// hour next morning, in the restaurant's timezone — so a 02:00 closing count still
// belongs to the day that just ended. Managers may only edit the CURRENT business
// day; Direction may edit any day.
import { config } from '../config.js';
import { ymd } from './http.js';

/** Morocco-local (or configured tz) wall-clock parts for an instant. */
function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour };
}

/** Current business day as 'YYYY-MM-DD'. Before startHour we're still in yesterday. */
export function currentBusinessDay(now = new Date()) {
  const { tz, startHour } = config.business;
  const { y, m, d, hour } = localParts(now, tz);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (hour < startHour) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Throw 403 if a non-Direction user tries to edit a day other than the current
 * business day. Direction may edit any day.
 * @param {{role:string}} user
 * @param {Date|string} date  target date (Date or 'YYYY-MM-DD')
 */
export function assertManagerEditableDate(user, date) {
  if (user.role === 'DIRECTION') return;
  const target = typeof date === 'string' ? date.slice(0, 10) : ymd(date);
  if (target !== currentBusinessDay()) {
    const e = new Error('Vous ne pouvez modifier que la journée en cours (historique en lecture seule).');
    e.status = 403;
    throw e;
  }
}

export default { currentBusinessDay, assertManagerEditableDate };
