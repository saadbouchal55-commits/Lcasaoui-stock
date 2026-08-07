// Order-suggestion service. Shared by the API route and the nightly job so the
// learning + suggestion + guardrail logic lives in exactly one place.
//
// New order flow (batch 2):
//  - Food orders are auto-GENERATED from sales × recipe learning, but NEVER
//    auto-sent. If inputs are missing or a qty is absurd, the order is HELD and
//    Direction is alerted.
//  - Learning reads CONFIRMED-SENT order lines (the ActualSent table is gone).
import prisma from '../lib/prisma.js';
import { ymd } from '../lib/http.js';
import { getStockOnHand } from '../lib/stock.js';
import { suggestOrder, weekdayAverage } from '../engine/autoorder.js';
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
 * Compute the order split:
 *  - food:      recipe items — system-SUGGESTED from sales (editable).
 *  - packaging: non-recipe items — NO auto-suggestion; a non-binding order-history
 *               hint (avg + last). Skipped if left blank.
 * Also returns per-food-item `recentMax` so the caller can detect absurd quantities.
 */
export async function computeSuggestions(locationId, date) {
  const [{ items, histories, days }, stock, buffers] = await Promise.all([
    getItemHistories(locationId, date),
    getStockOnHand(prisma, locationId),
    prisma.buffer.findMany({ where: { locationId } }),
  ]);
  const bufferByItem = new Map(buffers.map((b) => [b.itemId, b.pct]));
  const targetYmd = ymd(date); // the day the order is for → its weekday drives the average

  const food = [];
  const packaging = [];

  for (const item of items) {
    if (item.unit === 'UNTRACKED') continue;
    const history = histories.get(item.id) || [];
    const currentStock = stock.get(item.id) || 0;

    if (item.inRecipes) {
      const bufferPct = bufferByItem.get(item.id) || 0;
      // Weekday-aware daily average (falls back to flat average on small history).
      const dailyAvgOverride = weekdayAverage(history, days, targetYmd, config.order);
      const s = suggestOrder({ item, history, currentStock, bufferPct, cfg: config.order, dailyAvgOverride });
      food.push({
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        storageZone: item.storageZone,
        subCategory: item.subCategory,
        currentStock: round(currentStock, 1000),
        bufferPct,
        suggestedQty: s.suggestedQty,
        mode: s.mode,
        avgDaily: round(s.avgDaily),
        reason: s.reason,
        recentMax: Math.max(0, ...history),
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

  const absurd = food.filter((f) => f.recentMax > 0 && f.suggestedQty > config.order.absurdFactor * f.recentMax);
  if (absurd.length) {
    holdReasons.push(`quantité anormale: ${absurd.map((a) => a.name).join(', ')}`);
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
