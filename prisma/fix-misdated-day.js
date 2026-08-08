// One-off correction: the go-live night was recorded on the wrong calendar day.
// Moves a location's SALES (daily entry), WASTE (declarations + ledger movements)
// and INITIAL STOCK (COUNT_SET) from FROM -> TO. The packaging ORDER intentionally
// STAYS on FROM: under the "order = next business day" rule, an order placed during
// business-day TO is correctly the FROM-dated order, so it must not move.
//
// DRY-RUN by default — prints what it WOULD do and refuses to touch anything unless
// the target day is empty. Pass --apply to write.
//
//   node prisma/fix-misdated-day.js [LOCATION] [FROM] [TO]            (dry run)
//   node prisma/fix-misdated-day.js [LOCATION] [FROM] [TO] --apply    (execute)
//   defaults: L1  2026-08-08 -> 2026-08-07
//
// ALWAYS take a fresh backup first:  npm run export:data
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const pos = argv.filter((a) => a !== '--apply');
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
  console.log(`\n${APPLY ? '*** APPLY ***' : 'DRY RUN'}  ${CODE} — ${loc.name}  ${FROM}  ->  ${TO}`);
  console.log('Moving: SALES + WASTE + INITIAL STOCK.  Packaging ORDER stays on ' + FROM + '.\n');

  // ── Guard: the target day MUST be empty (for the things we move). ────────────────
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

  // ── What will move (and what stays) ─────────────────────────────────────────────
  const counts = {
    dailyEntry: await prisma.dailyEntry.count({ where: { locationId: loc.id, date: fromR } }),
    movement: await prisma.stockMovement.count({ where: { locationId: loc.id, date: fromR } }),
    waste: await prisma.wasteDeclaration.count({ where: { locationId: loc.id, date: fromR } }),
  };
  const ordersStaying = await prisma.orderSuggestion.count({ where: { locationId: loc.id, date: fromR } });
  console.log(`\nRows to shift from ${FROM}:`, counts);
  console.log(`Orders staying on ${FROM} (not moved): ${ordersStaying}`);

  // ── Safety: never move an order-related RECEIVED movement by accident. ───────────
  const receivedOnDay = await prisma.stockMovement.count({ where: { locationId: loc.id, date: fromR, type: 'RECEIVED' } });
  if (receivedOnDay > 0) {
    console.log(`\n⚠ ${receivedOnDay} RECEIVED movement(s) on ${FROM} — these belong to a CONFIRMED order.`);
    console.log('   Moving them would desync the order (which stays on ' + FROM + '). Stop and tell me.');
    if (APPLY) { console.log('   ABORT (RECEIVED present).'); return; }
  }

  // ── Ledger-ordering check: for items with BOTH an initial-stock COUNT_SET and a
  //    WASTE that night, on-hand = the LAST COUNT_SET (physical count) as long as it
  //    comes after the WASTE. If a WASTE has a higher id, it would double-subtract. ─
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
  // These WASTE ledger movements are already baked into the physical initial count
  // (they were declared after it), so they must be DROPPED — otherwise they double-
  // subtract from the next day's opening. The WASTE *declarations* are kept as record.
  const dropWasteIds = dbl.flatMap((d) => d.wasteIds);
  if (dbl.length) {
    console.log('\n⚠ WASTE posted AFTER the initial count — these ledger movements will be DROPPED');
    console.log('   (the physical initial count already reflects them; keeping them double-subtracts):');
    dbl.forEach((d) => console.log(`   - ${d.item}: keep COUNT_SET#${d.countId}, DROP WASTE#${d.wasteIds.join(',')}`));
    console.log('   The waste DECLARATIONS are kept (moved to ' + TO + ') as a record.');
  } else {
    console.log('\nLedger order OK ✓ — the initial count supersedes that night\'s waste (nothing to drop).');
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply (after a fresh backup) to execute.\n');
    return;
  }

  // ── Apply: shift the daily entry, waste declarations and stock movements (except
  //    the double-counting WASTE movements, which are dropped). OrderSuggestion is
  //    deliberately NOT moved (it is the next-day order). ───────────────────────────
  const toDate = dayStart(TO);
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
