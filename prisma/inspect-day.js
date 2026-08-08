// READ-ONLY inspection of one location's data for one or more days.
// Nothing is written — safe to run anytime. Use it to see exactly what was
// recorded before deciding on any correction.
//
//   node prisma/inspect-day.js [LOCATION_CODE] [DATE...]
//   node prisma/inspect-day.js L1 2026-08-07 2026-08-08   (default if omitted)
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

const args = process.argv.slice(2);
const code = (args.find((a) => /^L\d+$/i.test(a)) || 'L1').toUpperCase();
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (dates.length === 0) dates.push('2026-08-07', '2026-08-08');

const dayRange = (ymd) => ({ gte: new Date(`${ymd}T00:00:00Z`), lt: new Date(`${ymd}T23:59:59.999Z`) });
const nz = (v) => (v == null ? '—' : v);

async function main() {
  const loc = await prisma.location.findUnique({ where: { code } });
  if (!loc) { console.log(`Location ${code} not found.`); return; }
  const items = new Map((await prisma.item.findMany()).map((i) => [i.id, i]));
  const dishes = new Map((await prisma.dish.findMany()).map((d) => [d.id, d.name]));
  console.log(`\n=== ${code} — ${loc.name} (locationId ${loc.id}) ===`);

  for (const ymd of dates) {
    const range = dayRange(ymd);
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`DATE ${ymd}`);
    console.log(`──────────────────────────────────────────────`);

    // Daily entry: sales + counts
    const entry = await prisma.dailyEntry.findFirst({
      where: { locationId: loc.id, date: range },
      include: { salesLines: true, countLines: true },
    });
    if (!entry) {
      console.log('  DailyEntry: (none)');
    } else {
      console.log(`  DailyEntry #${entry.id}  status=${entry.status}  createdBy=${nz(entry.createdBy)}  date=${entry.date.toISOString()}`);
      console.log(`  SALES (${entry.salesLines.length}):`);
      entry.salesLines.filter((s) => s.qtySold).forEach((s) => console.log(`    - ${dishes.get(s.dishId) || `dish#${s.dishId}`}: ${s.qtySold}`));
      console.log(`  COUNTS (${entry.countLines.length}):`);
      entry.countLines.filter((c) => c.countedQty != null).forEach((c) => console.log(`    - ${items.get(c.itemId)?.name || `item#${c.itemId}`}: ${c.countedQty}`));
    }

    // Orders (primary + supplementary)
    const orders = await prisma.orderSuggestion.findMany({
      where: { locationId: loc.id, date: range },
      include: { lines: true }, orderBy: { seq: 'asc' },
    });
    if (orders.length === 0) console.log('  OrderSuggestion: (none)');
    for (const o of orders) {
      console.log(`  ORDER #${o.id}  seq=${o.seq}  status=${o.status}  confirmedBy=${nz(o.confirmedBy)}  confirmedAt=${nz(o.confirmedAt && o.confirmedAt.toISOString())}`);
      const withQty = o.lines.filter((l) => (l.orderedQty ?? 0) > 0 || (l.suggestedQty ?? 0) > 0);
      withQty.forEach((l) => {
        const it = items.get(l.itemId);
        console.log(`    - ${it?.name || `item#${l.itemId}`} [${it?.category}]: suggested=${nz(l.suggestedQty)} ordered=${nz(l.orderedQty)}`);
      });
    }

    // Stock movements that day (esp. RECEIVED from a confirmed order, COUNT_SET)
    const moves = await prisma.stockMovement.findMany({ where: { locationId: loc.id, date: range }, orderBy: [{ type: 'asc' }, { itemId: 'asc' }] });
    console.log(`  STOCK MOVEMENTS (${moves.length}):`);
    const byType = {};
    moves.forEach((m) => { (byType[m.type] ||= []).push(m); });
    for (const [type, list] of Object.entries(byType)) {
      console.log(`    ${type} (${list.length}):`);
      list.forEach((m) => console.log(`      - ${items.get(m.itemId)?.name || `item#${m.itemId}`}: ${m.qty}  ref=${nz(m.ref)}`));
    }
  }
  console.log('\n(read-only — no changes made)\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
