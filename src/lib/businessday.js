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

/** Day (YYYY-MM-DD) for an instant given a start-hour boundary; before it, yesterday. */
function dayFor(now, startHour) {
  const { tz } = config.business;
  const { y, m, d, hour } = localParts(now, tz);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (hour < startHour) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** Business/service day (11:00 boundary) — Ventes, Stock, Pertes. */
export const currentBusinessDay = (now = new Date()) => dayFor(now, config.business.startHour);
/** Order/production day (07:00 boundary) — Commandes + Commander Emballage. */
export const currentOrderDay = (now = new Date()) => dayFor(now, config.business.orderStartHour);

function assertEditable(user, date, currentDay, msg) {
  if (user.role === 'DIRECTION') return; // Direction may edit any day
  const target = typeof date === 'string' ? date.slice(0, 10) : ymd(date);
  if (target !== currentDay()) {
    const e = new Error(msg);
    e.status = 403;
    throw e;
  }
}

/** Non-Direction may only edit the current BUSINESS day (Ventes/Stock/Pertes). */
export function assertManagerEditableDate(user, date) {
  assertEditable(user, date, currentBusinessDay, 'Vous ne pouvez modifier que la journée en cours (historique en lecture seule).');
}

/** Non-Direction may only edit the current ORDER day (Commander Emballage). */
export function assertOrderEditableDate(user, date) {
  assertEditable(user, date, currentOrderDay, 'Vous ne pouvez modifier que la commande du jour en cours.');
}

export default { currentBusinessDay, currentOrderDay, assertManagerEditableDate, assertOrderEditableDate };
