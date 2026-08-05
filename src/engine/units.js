// Unit conversions — the ONLY place unit maths lives.
// Every item has ONE native unit (KG | UNIT | PIECE | PACKAGE | L | UNTRACKED).
// Recipe lines express quantities in a "recipe unit" (g, kg, U, pc, L) which we
// convert to the item's native unit here. Conversions are ONLY via:
//   grams -> kg (/1000), frying yield (fried -> raw), pieces -> packages (/packSize).

export const UNITS = ['KG', 'UNIT', 'PIECE', 'PACKAGE', 'L', 'UNTRACKED'];

/**
 * Convert a recipe-line quantity into the item's native stock unit.
 *
 * @param {{unit:string, packSize?:number|null, yieldPct?:number|null}} item
 * @param {number} qty        quantity as written on the recipe line
 * @param {string} [unitNote] how qty is expressed: 'g' | 'kg' | 'U' | 'pc' | 'L'
 * @returns {number} quantity in the item's native unit
 */
export function recipeQtyToNative(item, qty, unitNote) {
  if (!item || item.unit === 'UNTRACKED') return 0;
  const note = (unitNote || '').toLowerCase();
  const q = Number(qty) || 0;

  switch (item.unit) {
    case 'KG': {
      // Weight items: recipe qty is grams unless explicitly kg.
      let grams = note === 'kg' ? q * 1000 : q; // default & 'g' -> grams
      // Frying yield: recipe grams are the FRIED weight; raw needed is larger.
      if (item.yieldPct && item.yieldPct > 0) grams = grams / item.yieldPct;
      return grams / 1000; // -> kg
    }
    case 'L': {
      // Volume in litres (Citrons, Lait). 'g'/'kg' would be a data error.
      return q;
    }
    case 'PACKAGE': {
      // Recipe references PIECES; convert to packages via pack size.
      const packSize = item.packSize || 1;
      return q / packSize;
    }
    case 'UNIT':
    case 'PIECE':
    default:
      // Whole units / pieces: qty is already in native unit.
      return q;
  }
}

/**
 * Round a quantity sensibly for display / ordering in the item's native unit.
 * Weight & volume keep decimals; countable things are whole.
 */
export function roundNative(unit, qty) {
  const q = Number(qty) || 0;
  switch (unit) {
    case 'KG':
    case 'L':
      return Math.round(q * 1000) / 1000; // 3 decimals is plenty (grams / ml)
    case 'UNIT':
    case 'PIECE':
    case 'PACKAGE':
      return Math.round(q);
    default:
      return q;
  }
}

/**
 * Round a suggested ORDER quantity: never below zero, whole packages/pieces/units,
 * one decimal for weight/volume (you cannot order 0.001 kg meaningfully).
 */
export function roundOrderQty(unit, qty) {
  const q = Math.max(0, Number(qty) || 0);
  switch (unit) {
    case 'KG':
    case 'L':
      return Math.round(q * 10) / 10;
    case 'UNIT':
    case 'PIECE':
    case 'PACKAGE':
      return Math.ceil(q); // round up whole countable items
    default:
      return q;
  }
}
