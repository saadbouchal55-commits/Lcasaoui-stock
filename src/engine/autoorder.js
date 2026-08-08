// Smart auto-order engine. Pure functions — no DB. The system SUGGESTS; a human decides.
//
// Per (restaurant, food item, target date):
//  1. Predict the day's consumption from the SAME WEEKDAY over the last 4 weeks,
//     recent weeks weighted more (4/3/2/1). Each restaurant learns its own rhythm.
//  2. Baseline is recipe-based use (sales × recipe), gradually corrected by real
//     stock-count usage once counts are stable (median ratio, clamped, blended).
//  3. Coverage = 1 day + morning-gap fraction (config).
//  4. Per-item buffer: Direction's saved value wins; otherwise a smart default
//     from demand variability, capped by storage zone (perishables stay small).
//  5. need = predicted × coverage × (1 + buffer%); subtract stock on hand AND
//     inbound already ordered; floor at 0.
//  6. Round to real order units (whole packages/units; kg to an increment).
//  7. Low confidence → flag the line, don't guess (caller HOLDs the order).
//  8. Bulk/long-life items keep the periodic restock logic (weekdays don't apply).

import { roundOrderQty } from './units.js';

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(x) {
  return Math.round((Number(x) || 0) * 10) / 10;
}
function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
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
 * Recent-weighted same-weekday average. Takes the last `sameWeekdayCount`
 * occurrences of the target weekday (newest first) and weights them by
 * cfg.weekdayWeights (index 0 = most recent). Falls back to the flat recent
 * average when there are too few samples — and says so.
 *
 * @param {number[]} values  daily series (oldest→newest)
 * @param {string[]} days    matching 'YYYY-MM-DD' per value
 * @param {string} targetYmd the CONSUMPTION day the order covers
 * @param {object} cfg       config.order
 * @returns {{avg:number, samples:number, usedFallback:boolean}}
 */
export function weightedWeekdayAverage(values, days, targetYmd, cfg) {
  const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
  const targetDow = dow(targetYmd);
  const wanted = cfg.sameWeekdayCount || 4;

  const same = []; // newest → oldest
  for (let i = values.length - 1; i >= 0 && same.length < wanted; i--) {
    if (days[i] && dow(days[i]) === targetDow && values[i] > 0) same.push(values[i]);
  }

  if (same.length >= (cfg.minSamples || 2)) {
    const weights = cfg.weekdayWeights || [4, 3, 2, 1];
    let num = 0;
    let den = 0;
    same.forEach((v, i) => {
      const w = weights[i] ?? 1;
      num += v * w;
      den += w;
    });
    return { avg: den ? num / den : 0, samples: same.length, usedFallback: false };
  }

  // Fallback: flat average of recent active days.
  const nz = values.filter((v) => v > 0).slice(-cfg.learningWindowDays);
  return { avg: nz.length ? mean(nz) : 0, samples: same.length, usedFallback: true };
}

/**
 * Correction factor from actual-vs-recipe usage ratios (one ratio per counted
 * day: (recipe consumption + unexplained variance) / recipe consumption).
 * Only applied once there are enough count-days AND they are consistent;
 * median, clamped to a sane range. Until then the recipe baseline stands (1.0).
 *
 * @param {number[]} ratios oldest→newest, one per counted day (only days with use)
 * @param {object} cfg      config.order
 * @returns {{factor:number, applied:boolean, stable:boolean, samples:number}}
 */
export function correctionFromRatios(ratios, cfg) {
  const c = cfg.correction;
  const recent = ratios.slice(-c.window);
  if (recent.length < c.minCountDays) {
    return { factor: 1, applied: false, stable: true, samples: recent.length };
  }
  if (stdev(recent) > c.maxStd) {
    // Counts exist but disagree wildly day-to-day — don't trust them yet.
    return { factor: 1, applied: false, stable: false, samples: recent.length };
  }
  const factor = Math.min(c.clampMax, Math.max(c.clampMin, median(recent)));
  return { factor: round2(factor), applied: factor !== 1, stable: true, samples: recent.length };
}

/**
 * Smart per-item buffer default: more day-to-day variability → bigger buffer,
 * capped by storage zone (fridge R small — spoilage risk; ambient A larger).
 * Direction's saved buffer (if any) overrides this entirely — caller decides.
 *
 * @param {object} args
 * @param {number[]} args.history daily series
 * @param {string|null} args.zone 'R' | 'C' | 'A'
 * @param {object} args.cfg       config.order
 * @returns {number} pct
 */
export function smartBufferDefault({ history, zone, cfg }) {
  const sb = cfg.smartBuffer;
  const nz = history.filter((v) => v > 0);
  if (nz.length < 3) return sb.min; // not enough signal — stay conservative
  const m = mean(nz);
  const cv = m > 0 ? stdev(nz) / m : 0;
  const cap = sb.zoneCap[zone] ?? sb.zoneCap.A;
  return round1(Math.min(cap, Math.max(sb.min, cv * sb.cvFactor)));
}

/**
 * Confidence check for one suggested line. LOW confidence = flag for review
 * (the caller HOLDs the order) instead of silently guessing.
 * Reasons are short French strings shown to Direction/Order Manager.
 */
export function assessConfidence({ mode, samples, usedFallback, correctionUnstable, predicted, flatAvg, recentMax, suggestedQty, cfg }) {
  // Nothing predicted and nothing suggested → nothing to worry about.
  if ((predicted || 0) <= 0 && (suggestedQty || 0) <= 0) return { low: false, reasons: [] };

  const reasons = [];
  if (mode !== 'bulk') {
    if (usedFallback || samples < (cfg.minSamples || 2)) reasons.push('historique insuffisant');
    if (correctionUnstable) reasons.push('comptages instables');
    if (flatAvg > 0 && predicted > 0) {
      if (predicted > cfg.confidence.deviationHigh * flatAvg) reasons.push('prédiction très au-dessus de la normale');
      else if (predicted < cfg.confidence.deviationLow * flatAvg) reasons.push('prédiction très en-dessous de la normale');
    }
  }
  if (recentMax > 0 && suggestedQty > (cfg.absurdFactor || 3) * recentMax) reasons.push('quantité anormale');
  return { low: reasons.length > 0, reasons };
}

/**
 * Suggest an order quantity for one item.
 *
 * need = predicted_consumption × coverage × (1 + buffer%)
 * suggested = need − stock_on_hand − inbound_not_yet_delivered   (floored at 0)
 *
 * @param {object} args
 * @param {{unit:string, packSize?:number|null}} args.item
 * @param {number[]} args.history   recent daily quantities (native unit), oldest→newest
 * @param {number} args.currentStock native unit
 * @param {number} [args.pendingInbound] confirmed-sent but not yet delivered
 * @param {number} [args.bufferPct]  e.g. 10 = +10%
 * @param {object} args.cfg          config.order
 * @param {'daily'|'bulk'} [args.mode] force a mode (else auto-classified)
 * @param {number|null} [args.dailyAvgOverride] weekday-aware prediction (pre-correction)
 * @param {number} [args.correctionFactor] count-derived correction (1 = pure recipe)
 * @returns {{suggestedQty:number, mode:string, avgDaily:number, predicted:number, reason:string}}
 */
export function suggestOrder({
  item, history, currentStock, pendingInbound = 0, bufferPct = 0, cfg, mode,
  dailyAvgOverride = null, correctionFactor = 1,
}) {
  const stock = Number(currentStock) || 0;
  const inbound = Number(pendingInbound) || 0;
  const buffer = 1 + (Number(bufferPct) || 0) / 100;
  const kgInc = cfg.rounding?.kgIncrement ?? 0.5;
  const resolvedMode = mode || classify(history, cfg);

  if (resolvedMode === 'bulk') {
    // Long-life items: restock to a multi-day target when below the reorder point.
    const avgDaily = mean(history);
    const target = avgDaily * cfg.bulk.coverageDays * buffer;
    const reorderPoint = avgDaily * cfg.bulk.reorderDays;
    const have = stock + inbound;
    const raw = have <= reorderPoint ? target - have : 0;
    const suggestedQty = roundOrderQty(item.unit, raw, kgInc);
    return {
      suggestedQty,
      mode: 'bulk',
      avgDaily,
      predicted: avgDaily,
      reason:
        have <= reorderPoint
          ? `stock ${round1(have)} ≤ seuil ${round1(reorderPoint)} ; recomplète vers ~${round1(target)}`
          : `stock ${round1(have)} > seuil ${round1(reorderPoint)} ; rien à commander`,
    };
  }

  // Daily item: weekday-aware average (already recent-weighted) × count correction.
  const window = history.slice(-cfg.learningWindowDays);
  const base = dailyAvgOverride != null ? dailyAvgOverride : mean(window);
  const corr = Number(correctionFactor) || 1;
  const predicted = base * corr;
  const coverage = cfg.coverageDays + cfg.morningFraction;
  const raw = predicted * coverage * buffer - stock - inbound;
  const suggestedQty = roundOrderQty(item.unit, raw, kgInc);

  const parts = [`moy ${round1(base)}/j`];
  if (corr !== 1) parts.push(`× corr ${round2(corr)}`);
  parts.push(`× couv ${round2(coverage)}`);
  if (bufferPct) parts.push(`+ marge ${round1(bufferPct)}%`);
  parts.push(`− stock ${round1(stock)}`);
  if (inbound > 0) parts.push(`− en route ${round1(inbound)}`);

  return { suggestedQty, mode: 'daily', avgDaily: base, predicted, reason: parts.join(' ') };
}

export default suggestOrder;
