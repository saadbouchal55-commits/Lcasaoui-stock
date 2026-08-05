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
 * @returns {{suggestedQty:number, mode:string, avgDaily:number, reason:string}}
 */
export function suggestOrder({ item, history, currentStock, bufferPct = 0, cfg, mode }) {
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

  // Daily item: use the recent window.
  const window = history.slice(-cfg.learningWindowDays);
  const avgDaily = mean(window);
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

export default suggestOrder;
