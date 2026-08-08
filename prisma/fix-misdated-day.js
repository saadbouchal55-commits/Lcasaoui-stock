// One-off correction for the go-live night that was recorded on the wrong day.
//
// Default mode: move a location's SALES (daily entry), WASTE (declarations +
// ledger movements) and INITIAL STOCK (COUNT_SET) from FROM -> TO. The packaging
// ORDER stays put (under "order = next business day" it is already the right day).
// WASTE ledger movements posted after the initial count are dropped (the physical
// count already reflects them); the waste declarations are kept as a record.
//
// --order-only mode: move ONLY the OrderSuggestion(s) (and any RECEIVED movements
// tied to them) FROM -> TO. Use this when the order itself is on the wrong day
// (e.g. L2's go-live order sits on 07/08 but, being the next-day order, belongs
// on 08/08).
//
// DRY-RUN by default; pass --apply to write. ALWAYS back up first: npm run export:data
//
//   node prisma/fix-misdated-day.js L1 2026-08-08 2026-08-07            (dry run, default)
//   node prisma/fix-misdated-day.js L1 2026-08-08 2026-08-07 --apply
//   node prisma/fix-misdated-day.js L2 2026-08-07 2026-08-08 --order-only
//   node prisma/fix-misdated-day.js L2 2026-08-07 2026-08-08 --order-only --apply
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ORDER_ONLY = argv.includes('--order-only');
const pos = argv.filter((a) => !a.startsWith('--'));
const CODE = (pos.find((a) => /^L\d+$/i.test(a)) || 'L1').toUpperCase();
const ymds = pos.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const FROM = ymds[0] || '2026-08-08';
const TO = ymds[1] || '2026-08-07';

const dayStart = (ymd) => new Date(`${ymd}T00:00:00.000Z`);
const nextDay = (ymd) => { const d = dayStart(ymd); d.setUTCDate(d.getUTCDate() + 1); return d; };
const rangeOf = (ymd) => ({ gte: dayStart(ymd), lt: nextDay(ymd) });

async function main() {
  const loc = await prisma.location.findUnique({ where: { code: CODE } });
  if (!loc) { console.log(`Location ${CODE} not found.`); return; }
  const fromR = rangeOf(FROM);
  const toR = rangeOf(TO);
  const toDate = dayStart(TO);
  console.log(`\n${APPLY ? '*** APPLY ***' : 'DRY RUN'}  ${CODE} — ${loc.name}  ${FROM}  ->  ${TO}`);

  // ── --order-only: move just the OrderSuggestion(s) + their RECEIVED movements ────
  if (ORDER_ONLY) {
    console.log('Mode: ORDER ONLY (move the packaging/food order to its correct day).\n');
    const clashOrder = await prisma.orderSuggestion.count({ where: { locationId: loc.id, date: toR } });
    if (clashOrder > 0) { console.log(`ABORT — ${TO} already has ${clashOrder} order(s) for ${CODE}. Refusing to merge.`); return; }
    const orders = await prisma.orderSuggestion.findMany({ where: { locationId: loc.id, date: fromR }, include: { lines: true } });
    if (orders.length === 0) { console.log(`No orders on ${FROM} for ${CODE} — nothing to move.`); return; }
    console.log(`Orders on ${FROM} to move: ${orders.length}`);
    orders.forEach((o) => console.log(`   - ORDER #${o.id} seq=${o.seq} status=${o.status} lines=${o.lines.length}`));
    const orderRefs = orders.map((o) => `order:${o.id}`);
    const received = await prisma.stockMovement.count({ where: { locationId: loc.id, type: 'RECEIVED', ref: { in: orderRefs }, date: fromR } });
    console.log(`RECEIVED movements tied to these orders on ${FROM}: ${received}`);
    if (!APPLY) { console.log('\nDRY RUN — nothing changed. Add --apply to execute.\n'); return; }
    const ops = [prisma.orderSuggestion.updateMany({ where: { locationId: loc.id, date: fromR }, data: { date: toDate } })];
    if (received > 0) ops.push(prisma.stockMovement.updateMany({ where: { locationId: loc.id, type: 'RECEIVED', ref: { in: orderRefs }, date: fromR }, data: { date: toDate } }));
    const r = await prisma.$transaction(ops);
    console.log('\nApplied. [ordersMoved' + (received > 0 ? ', receivedMoved' : '') + ']:', r.map((x) => x.count));
    console.log(`\nVerify with:  npm run inspect:day ${CODE} ${FROM} ${TO}\n`);
    return;
  }

  // ── Default: move SALES + WASTE + INITIAL STOCK; keep the order. ─────────────────
  console.log('Moving: SALES + WASTE + INITIAL STOCK.  Packaging ORDER stays on ' + FROM + '.\n');

  // Guard: the target day MUST be empty (for the things we move).
  const clash = {
    dailyEntry: await prisma.dailyEntry.count({ where: { locationId: loc.id, date: toR } }),
    movement: await prisma.stockMovement.count({ where: { locationId: loc.id, date: toR } }),
    waste: await prisma.wasteDeclaration.count({ where: { locationId: loc.id, date: toR } }),
  };
  const clashTotal = Object.values(clash).reduce((a, b) => a + b, 0);
  if (clashTotal > 0) {
    console.log(`ABORT — target day ${TO} already has data:`, clash);
    console.log('Refusing to move onto a non-empty day.');
    return;
  }
  console.log(`Target day ${TO}: empty ✓`);

  const counts = {
    dailyEntry: await prisma.dailyEntry.count({ where: { locationId: loc.id, date: fromR } }),
    movement: await prisma.stockMovement.count({ where: { locationId: loc.id, date: fromR } }),
    waste: await prisma.wasteDeclaration.count({ where: { locationId: loc.id, date: fromR } }),
  };
  const ordersStaying = await prisma.orderSuggestion.count({ where: { locationId: loc.id, date: fromR } });
  console.log(`\nRows to shift from ${FROM}:`, counts);
  console.log(`Orders staying on ${FROM} (not moved): ${ordersStaying}`);

  const receivedOnDay = await prisma.stockMovement.count({ where: { locationId: loc.id, date: fromR, type: 'RECEIVED' } });
  if (receivedOnDay > 0) {
    console.log(`\n⚠ ${receivedOnDay} RECEIVED movement(s) on ${FROM} — these belong to a CONFIRMED order.`);
    console.log('   Moving them would desync the order (which stays on ' + FROM + '). Stop and tell me.');
    if (APPLY) { console.log('   ABORT (RECEIVED present).'); return; }
  }

  // Ledger-ordering check: WASTE posted after an item's initial COUNT_SET would
  // double-subtract from next-day opening — drop those (the count already reflects them).
  const moves = await prisma.stockMovement.findMany({ where: { locationId: loc.id, date: fromR }, orderBy: { id: 'asc' } });
  const items = new Map((await prisma.item.findMany()).map((i) => [i.id, i.name]));
  const byItem = new Map();
  for (const m of moves) {
    if (!byItem.has(m.itemId)) byItem.set(m.itemId, []);
    byItem.get(m.itemId).push(m);
  }
  const dbl = [];
  for (const [itemId, list] of byItem) {
    const lastCount = [...list].filter((m) => m.type === 'COUNT_SET').sort((a, b) => a.id - b.id).pop();
    const laterWaste = list.filter((m) => m.type === 'WASTE' && lastCount && m.id > lastCount.id);
    if (lastCount && laterWaste.length) dbl.push({ item: items.get(itemId), countId: lastCount.id, wasteIds: laterWaste.map((w) => w.id) });
  }
  const dropWasteIds = dbl.flatMap((d) => d.wasteIds);
  if (dbl.length) {
    console.log('\n⚠ WASTE posted AFTER the initial count — these ledger movements will be DROPPED');
    console.log('   (the physical initial count already reflects them; keeping them double-subtracts):');
    dbl.forEach((d) => console.log(`   - ${d.item}: keep COUNT_SET#${d.countId}, DROP WASTE#${d.wasteIds.join(',')}`));
    console.log('   The waste DECLARATIONS are kept (moved to ' + TO + ') as a record.');
  } else {
    console.log('\nLedger order OK ✓ — nothing to drop.');
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply (after a fresh backup) to execute.\n');
    return;
  }

  const moveMoves = dropWasteIds.length
    ? prisma.stockMovement.updateMany({ where: { locationId: loc.id, date: fromR, id: { notIn: dropWasteIds } }, data: { date: toDate } })
    : prisma.stockMovement.updateMany({ where: { locationId: loc.id, date: fromR }, data: { date: toDate } });
  const r = await prisma.$transaction([
    moveMoves,
    prisma.stockMovement.deleteMany({ where: { id: { in: dropWasteIds } } }),
    prisma.wasteDeclaration.updateMany({ where: { locationId: loc.id, date: fromR }, data: { date: toDate } }),
    prisma.dailyEntry.updateMany({ where: { locationId: loc.id, date: fromR }, data: { date: toDate } }),
  ]);
  console.log('\nApplied. [movementsMoved, wasteMovementsDropped, wasteDeclsMoved, entriesMoved]:', r.map((x) => x.count));
  console.log(`\nVerify with:  npm run inspect:day ${CODE} ${TO} ${FROM}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
