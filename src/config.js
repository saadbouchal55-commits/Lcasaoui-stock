// Central configuration. Values come from env with sensible defaults so the
// app runs out of the box and the manager can tune the order engine later.

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',

  // ── Business day ─────────────────────────────────────────────────────────────
  // A "business day" runs from startHour to startHour next morning (11:00→11:00),
  // so a late-night closing count belongs to the day that just ended. Managers can
  // only edit the CURRENT business day; Direction can edit any day.
  business: {
    tz: process.env.BUSINESS_TZ || 'Africa/Casablanca',
    startHour: num(process.env.BUSINESS_DAY_START_HOUR, 11),
  },

  // ── Security ───────────────────────────────────────────────────────────────
  security: {
    // Login rate limit (per IP + username) to blunt brute-force attempts.
    loginWindowMs: num(process.env.LOGIN_WINDOW_MS, 15 * 60 * 1000), // 15 min
    loginMaxAttempts: num(process.env.LOGIN_MAX_ATTEMPTS, 10),
    sessionTtlMs: num(process.env.SESSION_TTL_MS, 12 * 60 * 60 * 1000), // 12h
  },

  // ── Auto-order engine ──────────────────────────────────────────────────────
  order: {
    // Order at night -> produced next morning -> delivered midday. One delivery
    // covers ~1 day; the morning before delivery runs on the previous night's
    // leftover. Coverage is deliberately a simple constant the manager adjusts.
    coverageDays: num(process.env.COVERAGE_DAYS, 1),
    morningFraction: num(process.env.MORNING_FRACTION, 0.25),

    // Recent days averaged for a DAILY item's consumption (flat fallback).
    learningWindowDays: num(process.env.LEARNING_WINDOW_DAYS, 14),

    // Weekday-aware learning: a day's need is predicted from the same weekday in
    // recent weeks (Mondays learn from Mondays). Falls back to the flat average
    // until there are enough same-weekday samples, so it works from day one.
    sameWeekdayCount: num(process.env.SAME_WEEKDAY_COUNT, 4), // how many past same-weekdays
    minSamples: num(process.env.WEEKDAY_MIN_SAMPLES, 2), // need at least this many, else fallback

    // Guardrail: a generated qty above this multiple of the item's recent max
    // daily need is treated as absurd (likely a typo) → the order is HELD for review.
    absurdFactor: num(process.env.ORDER_ABSURD_FACTOR, 3),

    // Bulk classification: an item is "periodic-bulk" (order lumpy, whole
    // packages, overstock OK) rather than "daily" when it is used on few days
    // and in irregular amounts.
    bulk: {
      // If it is used on fewer than this fraction of days -> lean bulk.
      maxActiveDayFraction: num(process.env.BULK_MAX_ACTIVE_FRACTION, 0.4),
      // ...and its usage is lumpy (coefficient of variation above this).
      minCoefVariation: num(process.env.BULK_MIN_CV, 1.0),
      // Bulk restock target = this many days of average usage on hand.
      coverageDays: num(process.env.BULK_COVERAGE_DAYS, 7),
      // Reorder when current stock drops below this many days of usage.
      reorderDays: num(process.env.BULK_REORDER_DAYS, 3),
    },
  },
};

export default config;
