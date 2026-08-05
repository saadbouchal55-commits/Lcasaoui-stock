// Ledger helpers. Stock on hand is NEVER a stored mutable number — it is always
// derived from the append-only StockMovement log.
//
// Sign convention (magnitudes stored positive except ADJUSTMENT which is signed):
//   RECEIVED     -> +qty
//   CONSUMPTION  -> -qty
//   WASTE        -> -qty
//   ADJUSTMENT   -> +qty as stored (store negative to reduce)
//   COUNT_SET    -> absolute baseline (resets on-hand at that moment)

/** Signed delta a movement contributes, ignoring COUNT_SET (handled separately). */
export function signedDelta(type, qty) {
  const q = Number(qty) || 0;
  switch (type) {
    case 'RECEIVED':
      return q;
    case 'CONSUMPTION':
    case 'WASTE':
      return -Math.abs(q);
    case 'ADJUSTMENT':
      return q; // stored signed
    default:
      return 0;
  }
}

/**
 * On-hand for a single item from its movement list.
 * @param {Array<{type:string, qty:number, date:Date|string, id:number}>} movements
 * @returns {number}
 */
export function onHandFromMovements(movements) {
  const sorted = [...movements].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return da === db ? a.id - b.id : da - db;
  });
  let lastCountIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].type === 'COUNT_SET') lastCountIdx = i;
  }
  let onHand = 0;
  let start = 0;
  if (lastCountIdx >= 0) {
    onHand = Number(sorted[lastCountIdx].qty) || 0; // baseline
    start = lastCountIdx + 1;
  }
  for (let i = start; i < sorted.length; i++) {
    onHand += signedDelta(sorted[i].type, sorted[i].qty);
  }
  return onHand;
}

/**
 * Current on-hand for every item at a location, from the ledger.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} locationId
 * @returns {Promise<Map<number, number>>} itemId -> on-hand (native unit)
 */
export async function getStockOnHand(prisma, locationId) {
  const movements = await prisma.stockMovement.findMany({
    where: { locationId },
    select: { id: true, itemId: true, type: true, qty: true, date: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const byItem = new Map();
  for (const m of movements) {
    if (!byItem.has(m.itemId)) byItem.set(m.itemId, []);
    byItem.get(m.itemId).push(m);
  }
  const result = new Map();
  for (const [itemId, list] of byItem) result.set(itemId, onHandFromMovements(list));
  return result;
}

export default { signedDelta, onHandFromMovements, getStockOnHand };
