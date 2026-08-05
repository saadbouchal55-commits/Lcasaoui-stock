// Central configuration. Values come from env with sensible defaults so the
// app runs out of the box and the manager can tune the order engine later.

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',

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

    // Recent days averaged for a DAILY item's consumption.
    learningWindowDays: num(process.env.LEARNING_WINDOW_DAYS, 14),

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
