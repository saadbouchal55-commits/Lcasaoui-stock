// Pure-engine tests — no DB required. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recipeQtyToNative, roundOrderQty } from '../src/engine/units.js';
import { reconcile } from '../src/engine/reconciliation.js';
import { classify, suggestOrder } from '../src/engine/autoorder.js';
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

test('order rounding: weight to 0.1, countables round up', () => {
  assert.equal(roundOrderQty('KG', 9.44), 9.4);
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
