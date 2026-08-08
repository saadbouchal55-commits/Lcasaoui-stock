// Order-suggestion service. Shared by the API route and the nightly job so the
// learning + suggestion + guardrail logic lives in exactly one place.
//
// Smart engine (see src/engine/autoorder.js):
//  - Food is predicted per restaurant by same-weekday recent-weighted history,
//    recipe baseline × count-derived correction, per-item smart buffer, minus
//    stock on hand and inbound. Low-confidence lines HOLD the order for review.
//  - Never auto-sent; learning reads counts, sales and confirmed-sent orders.
import prisma from '../lib/prisma.js';
import { ymd } from '../lib/http.js';
import { getStockOnHand } from '../lib/stock.js';
import {
  suggestOrder, weightedWeekdayAverage, correctionFromRatios, smartBufferDefault,
  assessConfidence, mean,
} from '../engine/autoorder.js';
import { computeConsumption } from '../engine/reconciliation.js';
import { getEffectiveRecipeLines } from '../lib/recipes.js';
import { config } from '../config.js';

const HISTORY_DAYS = 60; // window pulled for classification; daily avg uses config window
const round = (x, p = 100) => Math.round((Number(x) || 0) * p) / p;

/**
 * Per-item daily quantity series (oldest→newest) over the history window.
 * The daily NEED of a FOOD item is best predicted by actual consumption
 * (sales × recipe), so that is the primary signal. Priority per item/day:
 *   1. reconciled CONSUMPTION movement (actual, most authoritative)
 *   2. sales × recipe for that day (works even before a day is reconciled — this
 *      is what makes e.g. Pain Tacos follow tacos sold, not past under-ordering)
 *   3. CONFIRMED-SENT order qty (fallback; drives packaging, which has no recipe)
 *   4. 0
 */
export async function getItemHistories(locationId, endDate) {
  const start = new Date(endDate);
  start.setUTCDate(start.getUTCDate() - HISTORY_DAYS);

  const [sentOrders, consumption, items, entries, recipeLinesByDish] = await Promise.all([
    prisma.orderSuggestion.findMany({
      where: { locationId, status: 'CONFIRMED_SENT', date: { gte: start, lt: endDate } },
      select: { date: true, lines: { select: { itemId: true, orderedQty: true, suggestedQty: true } } },
    }),
    prisma.stockMovement.findMany({
      where: { locationId, type: 'CONSUMPTION', date: { gte: start, lt: endDate } },
      select: { itemId: true, date: true, qty: true },
    }),
    prisma.item.findMany({ where: { isTracked: true } }),
    prisma.dailyEntry.findMany({
      where: { locationId, date: { gte: start, lt: endDate } },
      select: { date: true, salesLines: { select: { dishId: true, qtySold: true } } },
    }),
    getEffectiveRecipeLines(endDate), // current recipes, applied to historical sales
  ]);

  // Confirmed-sent order quantities, summed per item/day.
  const sentMap = new Map();
  for (const o of sentOrders) {
    const day = ymd(o.date);
    for (const l of o.lines) {
      const q = l.orderedQty ?? l.suggestedQty ?? 0;
      if (q > 0) {
        const k = `${l.itemId}:${day}`;
        sentMap.set(k, (sentMap.get(k) || 0) + q);
      }
    }
  }
  // Reconciled consumption per item/day.
  const consMap = new Map();
  for (const c of consumption) {
    const k = `${c.itemId}:${ymd(c.date)}`;
    consMap.set(k, (consMap.get(k) || 0) + c.qty);
  }
  // Sales × recipe consumption per item/day (food demand, even unreconciled).
  const salesMap = new Map();
  for (const e of entries) {
    if (!e.salesLines.length) continue;
    const day = ymd(e.date);
    const cons = computeConsumption(items, recipeLinesByDish, e.salesLines);
    for (const [itemId, qty] of cons) {
      const k = `${itemId}:${day}`;
      salesMap.set(k, (salesMap.get(k) || 0) + qty);
    }
  }

  const days = [];
  for (let d = new Date(start); d < endDate; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));

  const histories = new Map();
  for (const item of items) {
    histories.set(
      item.id,
      days.map((day) => {
        const k = `${item.id}:${day}`;
        if (consMap.has(k)) return consMap.get(k); // reconciled actual
        if (salesMap.has(k)) return salesMap.get(k); // sales × recipe
        if (sentMap.has(k)) return sentMap.get(k); // confirmed-sent order (e.g. packaging)
        return 0;
      }),
    );
  }
  return { items, histories, days };
}

/**
 * Actual-vs-recipe usage ratios per item, one per COUNTED day (ledger-derived —
 * no precomputed table needed). Reconciliation posts, with ref `entry:<id>`:
 *   CONSUMPTION C (recipe-based), WASTE W (unexplained variance),
 *   ADJUSTMENT A (counted more than expected), COUNT_SET (the count itself).
 * Actual usage that day = C + W − A, so ratio = (C + W − A) / C. Declared waste
 * (ref wastedecl:*) is excluded — it is loss, not usage.
 * @returns {Map<number, number[]>} itemId -> ratios (oldest→newest)
 */
export async function getCorrectionRatios(locationId, endDate) {
  const start = new Date(endDate);
  start.setUTCDate(start.getUTCDate() - HISTORY_DAYS);

  const movements = await prisma.stockMovement.findMany({
    where: {
      locationId,
      ref: { startsWith: 'entry:' },
      type: { in: ['COUNT_SET', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT'] },
      date: { gte: start, lt: endDate },
    },
    select: { itemId: true, type: true, qty: true, date: true },
    orderBy: { date: 'asc' },
  });

  // Group per (item, day).
  const byKey = new Map(); // `${itemId}:${ymd}` -> {counted, C, W, A}
  for (const m of movements) {
    const k = `${m.itemId}:${ymd(m.date)}`;
    const g = byKey.get(k) || { counted: false, C: 0, W: 0, A: 0 };
    if (m.type === 'COUNT_SET') g.counted = true;
    else if (m.type === 'CONSUMPTION') g.C += m.qty;
    else if (m.type === 'WASTE') g.W += m.qty;
    else if (m.type === 'ADJUSTMENT') g.A += m.qty;
    byKey.set(k, g);
  }

  const ratios = new Map();
  for (const [k, g] of byKey) {
    if (!g.counted || g.C <= 0) continue; // only counted days with real recipe use
    const itemId = Number(k.split(':')[0]);
    const ratio = Math.max(0, (g.C + g.W - g.A) / g.C);
    if (!ratios.has(itemId)) ratios.set(itemId, []);
    ratios.get(itemId).push(ratio);
  }
  return ratios;
}

/**
 * Inbound already ordered but not yet in the ledger: confirmed-sent lines whose
 * `order:<id>` RECEIVED movements are missing. In the current flow confirming an
 * order posts its receipts immediately, so this is normally 0 — it exists so the
 * engine can never double-order if confirmation and delivery ever separate.
 * @returns {Map<number, number>} itemId -> pending qty
 */
export async function getPendingInbound(locationId, date) {
  const from = new Date(date);
  from.setUTCDate(from.getUTCDate() - 3);
  const orders = await prisma.orderSuggestion.findMany({
    where: { locationId, status: 'CONFIRMED_SENT', date: { gte: from, lte: date } },
    include: { lines: true },
  });
  if (!orders.length) return new Map();

  const refs = orders.map((o) => `order:${o.id}`);
  const received = await prisma.stockMovement.findMany({
    where: { locationId, type: 'RECEIVED', ref: { in: refs } },
    select: { ref: true },
  });
  const receivedRefs = new Set(received.map((r) => r.ref));

  const pending = new Map();
  for (const o of orders) {
    if (receivedRefs.has(`order:${o.id}`)) continue;
    for (const l of o.lines) {
      if ((l.orderedQty ?? 0) > 0) pending.set(l.itemId, (pending.get(l.itemId) || 0) + l.orderedQty);
    }
  }
  return pending;
}

/**
 * Compute the order split:
 *  - food:      recipe items — system-SUGGESTED from sales (editable).
 *  - packaging: non-recipe items — NO auto-suggestion; a non-binding order-history
 *               hint (avg + last). Skipped if left blank.
 * Also returns per-food-item `recentMax` so the caller can detect absurd quantities.
 */
export async function computeSuggestions(locationId, date) {
  const cfg = config.order;
  const [{ items, histories, days }, stock, buffers, ratiosByItem, pendingByItem] = await Promise.all([
    getItemHistories(locationId, date),
    getStockOnHand(prisma, locationId),
    prisma.buffer.findMany({ where: { locationId } }),
    getCorrectionRatios(locationId, date),
    getPendingInbound(locationId, date),
  ]);
  // A saved Buffer row is a Direction override (even 0); absence = smart default.
  const bufferByItem = new Map(buffers.map((b) => [b.itemId, b.pct]));

  // The order placed on day D is delivered midday D+1 — predict for the weekday
  // of the day it actually covers.
  const target = new Date(date);
  target.setUTCDate(target.getUTCDate() + (cfg.targetOffsetDays ?? 1));
  const targetYmd = ymd(target);

  const food = [];
  const packaging = [];

  for (const item of items) {
    if (item.unit === 'UNTRACKED') continue;
    const history = histories.get(item.id) || [];
    const currentStock = stock.get(item.id) || 0;

    if (item.inRecipes) {
      // 1. Weekday-aware, recent-weighted prediction (falls back on small history).
      const wk = weightedWeekdayAverage(history, days, targetYmd, cfg);
      // 2. Count-derived correction (1.0 until counts are stable enough).
      const corr = correctionFromRatios(ratiosByItem.get(item.id) || [], cfg);
      // 4. Buffer: Direction override wins, else smart perishable-aware default.
      const hasOverride = bufferByItem.has(item.id);
      const bufferPct = hasOverride
        ? bufferByItem.get(item.id)
        : smartBufferDefault({ history, zone: item.storageZone, cfg });
      // 5. Subtract stock on hand + inbound not yet delivered.
      const pendingInbound = pendingByItem.get(item.id) || 0;

      const s = suggestOrder({
        item, history, currentStock, pendingInbound, bufferPct, cfg,
        dailyAvgOverride: wk.avg, correctionFactor: corr.factor,
      });

      // 7. Confidence gate — flag, don't guess.
      const flatNz = history.filter((v) => v > 0).slice(-cfg.learningWindowDays);
      const conf = assessConfidence({
        mode: s.mode,
        samples: wk.samples,
        usedFallback: wk.usedFallback,
        correctionUnstable: !corr.stable,
        predicted: s.predicted,
        flatAvg: flatNz.length ? mean(flatNz) : 0,
        recentMax: Math.max(0, ...history),
        suggestedQty: s.suggestedQty,
        cfg,
      });

      food.push({
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        storageZone: item.storageZone,
        subCategory: item.subCategory,
        currentStock: round(currentStock, 1000),
        pendingInbound: round(pendingInbound, 1000),
        bufferPct,
        bufferSource: hasOverride ? 'direction' : 'auto',
        correction: corr.factor,
        suggestedQty: s.suggestedQty,
        mode: s.mode,
        avgDaily: round(s.avgDaily),
        reason: s.reason,
        recentMax: Math.max(0, ...history),
        lowConfidence: conf.low,
        confidenceReasons: conf.reasons.join(', '),
      });
    } else {
      const nonzero = history.filter((q) => q > 0);
      const hintAvg = nonzero.length ? round(nonzero.reduce((a, b) => a + b, 0) / nonzero.length, 10) : 0;
      const hintLast = nonzero.length ? nonzero[nonzero.length - 1] : 0;
      packaging.push({
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        storageZone: item.storageZone,
        subCategory: item.subCategory,
        currentStock: round(currentStock, 1000),
        hintAvg,
        hintLast,
        ordersInWindow: nonzero.length,
      });
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
  food.sort(byName);
  packaging.sort(byName);
  return { food, packaging };
}

/**
 * Generate & persist the FOOD order for a date, applying guardrails.
 * Does NOT auto-send. Returns the resulting order (status GENERATED or HELD).
 * Skips regeneration if the order is already CONFIRMED_SENT.
 */
export async function generateOrder(locationId, date, generatedBy = null) {
  // The auto-generated food order is always the PRIMARY order (seq = 1).
  const existing = await prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } } });
  if (existing?.status === 'CONFIRMED_SENT') return existing; // never overwrite a sent order

  const { food } = await computeSuggestions(locationId, date);

  // ── Guardrails ────────────────────────────────────────────────────────────
  const holdReasons = [];

  const entry = await prisma.dailyEntry.findUnique({
    where: { locationId_date: { locationId, date } },
    include: { salesLines: true },
  });
  if (!entry || entry.salesLines.length === 0) holdReasons.push('ventes du jour manquantes');

  const ledgerCount = await prisma.stockMovement.count({ where: { locationId, date: { lte: date } } });
  if (ledgerCount === 0) holdReasons.push('stock non initialisé / comptage manquant');

  // Confidence gate: any low-confidence line HOLDs the order and names the items
  // to check (includes the absurd-quantity case), so the reviewer knows exactly
  // which lines the engine is unsure about.
  const uncertain = food.filter((f) => f.lowConfidence);
  if (uncertain.length) {
    const names = uncertain.map((f) => f.name);
    const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ` (+${names.length - 8})` : '');
    holdReasons.push(`confiance faible: ${shown}`);
  }

  const status = holdReasons.length ? 'HELD' : 'GENERATED';
  const holdReason = holdReasons.length ? holdReasons.join(' ; ') : null;

  await prisma.$transaction(async (tx) => {
    const order = await tx.orderSuggestion.upsert({
      where: { locationId_date_seq: { locationId, date, seq: 1 } },
      update: { status, holdReason },
      create: { locationId, date, seq: 1, status, holdReason },
    });
    // Rebuild FOOD lines only (packaging is entered by hand, not regenerated).
    const foodItemIds = new Set(food.map((f) => f.itemId));
    await tx.orderLine.deleteMany({ where: { suggestionId: order.id, itemId: { in: [...foodItemIds] } } });
    await tx.orderLine.createMany({
      data: food
        .filter((r) => r.suggestedQty > 0)
        .map((r) => ({ suggestionId: order.id, itemId: r.itemId, suggestedQty: r.suggestedQty, orderedQty: r.suggestedQty, flagged: false })),
    });
    return order;
  });

  return prisma.orderSuggestion.findUnique({ where: { locationId_date_seq: { locationId, date, seq: 1 } } });
}
