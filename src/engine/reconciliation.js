// Daily reconciliation -> waste. Pure functions, no DB, so they are trivially
// testable and reused by both the API and the nightly job.
//
//   consumption      = Σ over dishes sold: qty_sold × recipe_line_qty(item)   [native unit]
//   expected_closing = opening_stock + received − consumption
//   waste            = expected_closing − actual_counted_closing
//
// opening_stock is the prior day's closing count (auto-carried) or a manual
// first-day value. counted = 0 is flagged as a possible stockout, never "perfect".

import { recipeQtyToNative, roundNative } from './units.js';

/**
 * @typedef {Object} ReconItem
 * @property {number} id
 * @property {string} name
 * @property {string} unit        KG|UNIT|PIECE|PACKAGE|L|UNTRACKED
 * @property {number|null} packSize
 * @property {number|null} yieldPct
 * @property {boolean} isTracked
 * @property {boolean} inRecipes
 * @property {string} category
 */

/**
 * Compute per-item consumption (native units) from the day's sales and the
 * recipe versions effective that day.
 *
 * @param {ReconItem[]} items
 * @param {Map<number, Array<{itemId:number, qty:number, unitNote?:string}>>} recipeLinesByDish
 * @param {Array<{dishId:number, qtySold:number}>} sales
 * @returns {Map<number, number>} itemId -> consumption in native unit
 */
export function computeConsumption(items, recipeLinesByDish, sales) {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const consumption = new Map();

  for (const { dishId, qtySold } of sales) {
    const lines = recipeLinesByDish.get(dishId);
    if (!lines || !qtySold) continue;
    for (const line of lines) {
      const item = itemById.get(line.itemId);
      if (!item || !item.isTracked) continue;
      const perDish = recipeQtyToNative(item, line.qty, line.unitNote);
      const prev = consumption.get(line.itemId) || 0;
      consumption.set(line.itemId, prev + perDish * qtySold);
    }
  }
  return consumption;
}

/**
 * Full reconciliation for one (location, date).
 *
 * @param {Object} args
 * @param {ReconItem[]} args.items
 * @param {Map} args.recipeLinesByDish        dishId -> lines (version effective that date)
 * @param {Array} args.sales                  [{dishId, qtySold}]
 * @param {Map<number,number>} [args.opening] itemId -> opening stock (native)
 * @param {Map<number,number>} [args.received]itemId -> received that day (native)
 * @param {Map<number,number>} [args.counted] itemId -> actual closing count (native)
 * @param {Map<number,number>} [args.declaredWaste] itemId -> declared ingredient waste (native)
 * @returns {Array} one row per tracked food item involved, sorted by name
 */
export function reconcile({ items, recipeLinesByDish, sales, opening, received, counted, declaredWaste }) {
  opening = opening || new Map();
  received = received || new Map();
  counted = counted || new Map();
  declaredWaste = declaredWaste || new Map();

  const consumption = computeConsumption(items, recipeLinesByDish, sales);
  const itemById = new Map(items.map((i) => [i.id, i]));

  // Which items to report: any tracked food item that had consumption, an
  // opening balance, a receipt, or a count today.
  const ids = new Set();
  for (const id of consumption.keys()) ids.add(id);
  for (const id of opening.keys()) ids.add(id);
  for (const id of received.keys()) ids.add(id);
  for (const id of counted.keys()) ids.add(id);
  for (const id of declaredWaste.keys()) ids.add(id);

  const rows = [];
  for (const id of ids) {
    const item = itemById.get(id);
    if (!item || !item.isTracked) continue;
    if (!item.inRecipes) continue; // packaging is order-tracked, not reconciled

    const op = opening.get(id) || 0;
    const rec = received.get(id) || 0;
    const cons = consumption.get(id) || 0;
    const declared = declaredWaste.get(id) || 0; // declared ingredient waste
    const expected = op + rec - cons;
    const hasCount = counted.has(id);
    const cnt = hasCount ? counted.get(id) : null;
    // Unexplained variance = expected − counted − declared ingredient waste.
    const waste = hasCount ? expected - cnt - declared : null;

    const flags = [];
    if (!hasCount) flags.push('not_counted');
    if (hasCount && cnt === 0) flags.push('possible_stockout'); // never call it "perfect"
    if (expected < -1e-9) flags.push('expected_negative'); // sold more than available -> lost sales / bad data
    if (waste !== null && waste < -1e-9) flags.push('negative_waste'); // counted+declared more than expected

    rows.push({
      itemId: id,
      name: item.name,
      unit: item.unit,
      category: item.category,
      opening: roundNative(item.unit, op),
      received: roundNative(item.unit, rec),
      consumption: roundNative(item.unit, cons),
      expectedClosing: roundNative(item.unit, expected),
      counted: cnt === null ? null : roundNative(item.unit, cnt),
      declaredWaste: roundNative(item.unit, declared),
      waste: waste === null ? null : roundNative(item.unit, waste),
      flags,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return rows;
}

export default reconcile;
