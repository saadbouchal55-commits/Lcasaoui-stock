// Pure-engine tests — no DB required. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recipeQtyToNative, roundOrderQty } from '../src/engine/units.js';
import { reconcile } from '../src/engine/reconciliation.js';
import {
  classify, suggestOrder, weightedWeekdayAverage, correctionFromRatios,
  smartBufferDefault, assessConfidence,
} from '../src/engine/autoorder.js';
import { onHandFromMovements } from '../src/lib/stock.js';
import { config } from '../src/config.js';

// ── unit conversions ──────────────────────────────────────────────────────────
test('grams -> kg', () => {
  assert.equal(recipeQtyToNative({ unit: 'KG' }, 200, 'g'), 0.2);
});

test('kg note passes through', () => {
  assert.equal(recipeQtyToNative({ unit: 'KG' }, 0.03, 'kg'), 0.03);
});

test('Frites applies frying yield (fried g -> raw kg)', () => {
  // 150 fried g / 0.65 / 1000 = 0.2307... raw kg
  const v = recipeQtyToNative({ unit: 'KG', yieldPct: 0.65 }, 150, 'g');
  assert.ok(Math.abs(v - 0.230769) < 1e-6);
});

test('PACKAGE: pieces -> packages via pack size', () => {
  assert.ok(Math.abs(recipeQtyToNative({ unit: 'PACKAGE', packSize: 88 }, 1, 'pc') - 1 / 88) < 1e-9);
  assert.ok(Math.abs(recipeQtyToNative({ unit: 'PACKAGE', packSize: 144 }, 2, 'pc') - 2 / 144) < 1e-9);
});

test('UNIT and L pass through; UNTRACKED is zero', () => {
  assert.equal(recipeQtyToNative({ unit: 'UNIT' }, 1, 'U'), 1);
  assert.equal(recipeQtyToNative({ unit: 'L' }, 0.15, 'L'), 0.15);
  assert.equal(recipeQtyToNative({ unit: 'UNTRACKED' }, 5, 'g'), 0);
});

test('order rounding: weight UP to the increment, countables round up', () => {
  assert.equal(roundOrderQty('KG', 9.44), 9.5); // default 0.5 increment
  assert.equal(roundOrderQty('KG', 9.5), 9.5); // exact multiple stays
  assert.equal(roundOrderQty('KG', 9.44, 0.1), 9.5);
  assert.equal(roundOrderQty('KG', 9.1, 1), 10);
  assert.equal(roundOrderQty('UNIT', 3.1), 4);
  assert.equal(roundOrderQty('PACKAGE', 0.2), 1);
  assert.equal(roundOrderQty('KG', -5), 0);
});

// ── reconciliation ────────────────────────────────────────────────────────────
test('reconcile computes consumption, expected closing and waste', () => {
  const items = [
    { id: 1, name: 'Frites', unit: 'KG', packSize: null, yieldPct: 0.65, isTracked: true, inRecipes: true, category: 'INGREDIENT' },
    { id: 2, name: 'Pain Burger', unit: 'UNIT', packSize: null, yieldPct: null, isTracked: true, inRecipes: true, category: 'INGREDIENT' },
    { id: 3, name: 'Cheddar', unit: 'PACKAGE', packSize: 88, yieldPct: null, isTracked: true, inRecipes: true, category: 'INGREDIENT' },
  ];
  const recipeLinesByDish = new Map([
    [10, [{ itemId: 2, qty: 1, unitNote: 'U' }, { itemId: 3, qty: 1, unitNote: 'pc' }]], // Cheese Burger
    [11, [{ itemId: 1, qty: 150, unitNote: 'g' }]], // Frites Maison
  ]);
  const sales = [{ dishId: 10, qtySold: 10 }, { dishId: 11, qtySold: 20 }];
  const opening = new Map([[1, 5], [2, 20], [3, 2]]);
  const received = new Map([[1, 40]]);
  const counted = new Map([[1, 39], [2, 9]]);

  const rows = reconcile({ items, recipeLinesByDish, sales, opening, received, counted });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));

  // Frites: cons = 20 * 150/0.65/1000 = 4.615 kg; exp = 5+40-4.615 = 40.385; waste = 1.385
  assert.equal(by['Frites'].consumption, 4.615);
  assert.equal(by['Frites'].expectedClosing, 40.385);
  assert.equal(by['Frites'].waste, 1.385);

  // Pain Burger: cons 10, exp 10, waste 1
  assert.equal(by['Pain Burger'].consumption, 10);
  assert.equal(by['Pain Burger'].waste, 1);

  // Cheddar: consumed 10/88 packages, not counted -> flagged
  assert.equal(by['Cheddar'].consumption, 0.114);
  assert.equal(by['Cheddar'].counted, null);
  assert.ok(by['Cheddar'].flags.includes('not_counted'));
});

test('counted = 0 flags a possible stockout (never "perfect")', () => {
  const items = [{ id: 1, name: 'X', unit: 'KG', yieldPct: null, isTracked: true, inRecipes: true, category: 'INGREDIENT' }];
  const rows = reconcile({
    items,
    recipeLinesByDish: new Map(),
    sales: [],
    opening: new Map([[1, 2]]),
    received: new Map(),
    counted: new Map([[1, 0]]),
  });
  assert.ok(rows[0].flags.includes('possible_stockout'));
});

// ── ledger on-hand ────────────────────────────────────────────────────────────
test('on-hand: COUNT_SET resets baseline, later deltas apply', () => {
  const movements = [
    { id: 1, type: 'RECEIVED', qty: 10, date: '2026-07-01' },
    { id: 2, type: 'CONSUMPTION', qty: 3, date: '2026-07-01' },
    { id: 3, type: 'COUNT_SET', qty: 5, date: '2026-07-01' }, // reset to 5
    { id: 4, type: 'RECEIVED', qty: 8, date: '2026-07-02' },
    { id: 5, type: 'CONSUMPTION', qty: 2, date: '2026-07-02' },
  ];
  assert.equal(onHandFromMovements(movements), 11); // 5 + 8 - 2
});

// ── auto-order ────────────────────────────────────────────────────────────────
test('classify: steady daily use vs lumpy bulk', () => {
  const daily = Array(14).fill(10);
  assert.equal(classify(daily, config.order), 'daily');

  const bulk = [0, 0, 0, 50, 0, 0, 0, 0, 0, 0];
  assert.equal(classify(bulk, config.order), 'bulk');
});

test('daily suggestion = avg × coverage × buffer − stock', () => {
  const item = { unit: 'KG' };
  const history = Array(14).fill(10);
  const r = suggestOrder({ item, history, currentStock: 3, bufferPct: 0, cfg: config.order });
  // coverage 1.25, avg 10 -> 12.5 - 3 = 9.5
  assert.equal(r.mode, 'daily');
  assert.equal(r.suggestedQty, 9.5);
});

test('bulk suggestion tops up to target only when below reorder point', () => {
  const item = { unit: 'PACKAGE', packSize: 88 };
  const history = [0, 0, 0, 0, 0, 0, 0, 0, 0, 50]; // mean 5
  const low = suggestOrder({ item, history, currentStock: 10, bufferPct: 0, cfg: config.order });
  assert.equal(low.mode, 'bulk');
  // target = 5 * 7 = 35, reorder = 5 * 3 = 15; stock 10 <= 15 -> 35-10 = 25 (ceil)
  assert.equal(low.suggestedQty, 25);

  const high = suggestOrder({ item, history, currentStock: 40, bufferPct: 0, cfg: config.order });
  assert.equal(high.suggestedQty, 0); // above reorder point -> no order
});

// ── smart engine ─────────────────────────────────────────────────────────────

// Build `count` consecutive days ending at endYmd, with values by weekday.
function seriesByWeekday(endYmd, count, valueOf) {
  const days = [];
  const values = [];
  const end = new Date(`${endYmd}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    days.push(ymd);
    values.push(valueOf(d.getUTCDay(), ymd));
  }
  return { days, values };
}
const nextOfWeekday = (fromYmd, dow) => {
  const d = new Date(`${fromYmd}T00:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== dow);
  return d.toISOString().slice(0, 10);
};

test('weighted weekday average: recent same-weekdays weigh more', () => {
  // Mondays sell 20, other days 10 — target a Monday → 20.
  const { days, values } = seriesByWeekday('2026-08-06', 28, (dow) => (dow === 1 ? 20 : 10));
  const target = nextOfWeekday('2026-08-06', 1);
  const flat = weightedWeekdayAverage(values, days, target, config.order);
  assert.equal(flat.usedFallback, false);
  assert.ok(Math.abs(flat.avg - 20) < 1e-9);

  // Most recent Monday spikes to 40 → weighted (4×40 + 3×10 + 2×10 + 1×10)/10 = 22.
  const spiked = values.slice();
  for (let i = days.length - 1; i >= 0; i--) {
    if (new Date(`${days[i]}T00:00:00Z`).getUTCDay() === 1) { spiked[i] = 40; break; }
  }
  for (let i = 0; i < days.length; i++) {
    if (new Date(`${days[i]}T00:00:00Z`).getUTCDay() === 1 && spiked[i] === 20) spiked[i] = 10;
  }
  const w = weightedWeekdayAverage(spiked, days, target, config.order);
  assert.ok(Math.abs(w.avg - 22) < 1e-9);
});

test('weekday average falls back (and says so) on tiny history', () => {
  const { days, values } = seriesByWeekday('2026-08-06', 5, () => 10);
  const target = nextOfWeekday('2026-08-06', 1);
  const r = weightedWeekdayAverage(values, days, target, config.order);
  assert.equal(r.usedFallback, true);
  assert.equal(r.avg, 10);
});

test('correction: off until enough count days, off when unstable, clamped when stable', () => {
  const few = correctionFromRatios([1.2, 1.1, 1.3], config.order);
  assert.equal(few.applied, false);
  assert.equal(few.factor, 1);

  const wild = correctionFromRatios([0.3, 2.5, 0.4, 2.2, 0.5, 2.0, 0.3, 2.4, 0.6, 2.1, 0.4, 2.3], config.order);
  assert.equal(wild.stable, false);
  assert.equal(wild.factor, 1);

  const steady = correctionFromRatios(Array(12).fill(1.1), config.order);
  assert.equal(steady.applied, true);
  assert.ok(Math.abs(steady.factor - 1.1) < 1e-9);

  const extreme = correctionFromRatios(Array(12).fill(2.0), config.order);
  assert.equal(extreme.factor, config.order.correction.clampMax); // clamped
});

test('smart buffer: variability-driven, capped smaller for perishables (zone R)', () => {
  const steady = Array(14).fill(10);
  assert.equal(smartBufferDefault({ history: steady, zone: 'A', cfg: config.order }), 0);

  const variable = [5, 25, 5, 25, 5, 25, 5, 25]; // cv = 2/3 → ~16.7%
  const fridge = smartBufferDefault({ history: variable, zone: 'R', cfg: config.order });
  const ambient = smartBufferDefault({ history: variable, zone: 'A', cfg: config.order });
  assert.equal(fridge, 10); // capped at the R zone cap
  assert.ok(ambient > 10 && ambient <= 30);
});

test('confidence: flags fallback/absurd lines, stays quiet on zero lines', () => {
  const quiet = assessConfidence({ mode: 'daily', samples: 0, usedFallback: true, correctionUnstable: false, predicted: 0, flatAvg: 0, recentMax: 0, suggestedQty: 0, cfg: config.order });
  assert.equal(quiet.low, false);

  const thin = assessConfidence({ mode: 'daily', samples: 1, usedFallback: true, correctionUnstable: false, predicted: 8, flatAvg: 8, recentMax: 10, suggestedQty: 7, cfg: config.order });
  assert.equal(thin.low, true);

  const absurd = assessConfidence({ mode: 'daily', samples: 4, usedFallback: false, correctionUnstable: false, predicted: 10, flatAvg: 10, recentMax: 10, suggestedQty: 40, cfg: config.order });
  assert.equal(absurd.low, true);
});

test('suggestion subtracts pending inbound and applies correction', () => {
  const item = { unit: 'KG' };
  const history = Array(14).fill(10);
  // predicted 10×1.2=12 ; ×1.25 couv = 15 ; −3 stock −5 inbound = 7 → 7.0
  const r = suggestOrder({ item, history, currentStock: 3, pendingInbound: 5, bufferPct: 0, cfg: config.order, dailyAvgOverride: 10, correctionFactor: 1.2 });
  assert.equal(r.suggestedQty, 7);
  assert.ok(r.reason.includes('corr'));
  assert.ok(r.reason.includes('en route'));
});
