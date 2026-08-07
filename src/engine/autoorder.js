// Auto-order engine. Pure functions. The system SUGGESTS; a human decides.
//
// Per (location, item):
//  - Classify DAILY vs PERIODIC-BULK from history (bulk = lumpy, infrequent, large).
//  - Daily:  suggestion = avg daily need × (coverage + morning) × (1 + buffer%) − stock
//  - Bulk :  restock in whole packages when stock drops below a reorder point,
//            up to a multi-day target (overstock OK for long-life items).
//  - Learning: history is the series of daily quantities (consumption early on,
//    ACTUAL SENT once entered). Team-flagged anomalies are excluded upstream.

import { roundOrderQty } from './units.js';

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

/**
 * Decide whether an item behaves as periodic-bulk or daily.
 * @param {number[]} history recent daily quantities (native unit), oldest→newest
 * @param {object} cfg config.order
 * @returns {'bulk'|'daily'}
 */
export function classify(history, cfg) {
  const days = history.length;
  if (days === 0) return 'daily';
  const active = history.filter((q) => q > 0);
  const activeFraction = active.length / days;
  // Lumpiness over the WHOLE series: many zeros + occasional big orders -> high CV.
  const m = mean(history);
  const cv = m > 0 ? stdev(history) / m : 0;

  if (activeFraction < cfg.bulk.maxActiveDayFraction && cv >= cfg.bulk.minCoefVariation) {
    return 'bulk';
  }
  return 'daily';
}

/**
 * Suggest an order quantity for one item.
 *
 * @param {object} args
 * @param {{unit:string, packSize?:number|null}} args.item
 * @param {number[]} args.history   recent daily quantities (native unit), oldest→newest
 * @param {number} args.currentStock native unit
 * @param {number} [args.bufferPct]  e.g. 10 = +10%
 * @param {object} args.cfg          config.order
 * @param {'daily'|'bulk'} [args.mode] force a mode (else auto-classified)
 * @param {number|null} [args.dailyAvgOverride] precomputed daily average (e.g. weekday-aware)
 * @returns {{suggestedQty:number, mode:string, avgDaily:number, reason:string}}
 */
export function suggestOrder({ item, history, currentStock, bufferPct = 0, cfg, mode, dailyAvgOverride = null }) {
  const stock = Number(currentStock) || 0;
  const buffer = 1 + (Number(bufferPct) || 0) / 100;
  const resolvedMode = mode || classify(history, cfg);

  if (resolvedMode === 'bulk') {
    // Average daily usage across ALL days (bulk items sit idle most days).
    const avgDaily = mean(history);
    const target = avgDaily * cfg.bulk.coverageDays * buffer;
    const reorderPoint = avgDaily * cfg.bulk.reorderDays;
    let raw = 0;
    if (stock <= reorderPoint) raw = target - stock; // top up to target
    const suggestedQty = roundOrderQty(item.unit, raw);
    return {
      suggestedQty,
      mode: 'bulk',
      avgDaily,
      reason:
        stock <= reorderPoint
          ? `stock ${round1(stock)} ≤ reorder point ${round1(reorderPoint)}; top up to ~${round1(target)}`
          : `stock ${round1(stock)} above reorder point ${round1(reorderPoint)}; no order`,
    };
  }

  // Daily item: use the weekday-aware average when provided, else the flat window.
  const window = history.slice(-cfg.learningWindowDays);
  const avgDaily = dailyAvgOverride != null ? dailyAvgOverride : mean(window);
  const coverage = cfg.coverageDays + cfg.morningFraction;
  const raw = avgDaily * coverage * buffer - stock;
  const suggestedQty = roundOrderQty(item.unit, raw);
  return {
    suggestedQty,
    mode: 'daily',
    avgDaily,
    reason: `avg ${round1(avgDaily)}/day × ${round1(coverage)} coverage${
      bufferPct ? ` +${bufferPct}%` : ''
    } − stock ${round1(stock)}`,
  };
}

function round1(x) {
  return Math.round((Number(x) || 0) * 10) / 10;
}

/**
 * Weekday-aware daily average: predicts a day's need from the same weekday in
 * recent weeks (Mondays learn from Mondays). Falls back to the flat recent
 * average until enough same-weekday samples exist — so it works from day one and
 * sharpens as data accumulates.
 *
 * @param {number[]} values  daily series (oldest→newest)
 * @param {string[]} days    matching 'YYYY-MM-DD' for each value
 * @param {string} targetYmd the day the order is for ('YYYY-MM-DD')
 * @param {object} cfg       config.order
 * @returns {number}
 */
export function weekdayAverage(values, days, targetYmd, cfg) {
  const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
  const targetDow = dow(targetYmd);
  const sameWeekday = [];
  for (let i = 0; i < values.length; i++) {
    if (days[i] && dow(days[i]) === targetDow && values[i] > 0) sameWeekday.push(values[i]);
  }
  const recent = sameWeekday.slice(-(cfg.sameWeekdayCount || 4));
  if (recent.length >= (cfg.minSamples || 2)) return mean(recent);
  // Fallback: flat average of recent days that had activity.
  const nz = values.filter((v) => v > 0).slice(-cfg.learningWindowDays);
  return nz.length ? mean(nz) : 0;
}

export default suggestOrder;
