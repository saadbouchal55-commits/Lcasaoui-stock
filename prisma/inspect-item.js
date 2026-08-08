// READ-ONLY: dump the current definition + all usage of named items, so a unit
// conversion (e.g. package -> piece) can be planned safely. Changes nothing.
//
//   node prisma/inspect-item.js "Cheddar" "Oreo entier (PS)" "Pain Tacos"
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

const names = process.argv.slice(2);
if (names.length === 0) names.push('Cheddar', 'Oreo entier (PS)', 'Pain Tacos');

const nz = (v) => (v == null ? '—' : v);

async function main() {
  const locs = new Map((await prisma.location.findMany()).map((l) => [l.id, l.code]));
  const dishes = new Map((await prisma.dish.findMany()).map((d) => [d.id, d.name]));

  for (const name of names) {
    const item = await prisma.item.findUnique({ where: { name } });
    console.log(`\n══════════════════════════════════════════════`);
    if (!item) { console.log(`ITEM "${name}" — NOT FOUND`); continue; }
    console.log(`ITEM "${item.name}"  (id ${item.id})`);
    console.log(`  unit=${item.unit}  packSize=${nz(item.packSize)}  yieldPct=${nz(item.yieldPct)}  inRecipes=${item.inRecipes}  category=${item.category}  active=${item.active}`);

    // Stock movements: by type, per location, with count + summed qty.
    const moves = await prisma.stockMovement.findMany({ where: { itemId: item.id }, select: { locationId: true, type: true, qty: true, date: true } });
    console.log(`  STOCK MOVEMENTS: ${moves.length}`);
    const byKey = new Map();
    for (const m of moves) {
      const k = `${locs.get(m.locationId) || m.locationId} / ${m.type}`;
      const g = byKey.get(k) || { n: 0, sum: 0 };
      g.n += 1; g.sum += m.qty; byKey.set(k, g);
    }
    for (const [k, g] of [...byKey.entries()].sort()) console.log(`    ${k}: ${g.n} rows, sum qty = ${Math.round(g.sum * 1000) / 1000}`);

    // Count lines (closing counts).
    const countLines = await prisma.countLine.count({ where: { itemId: item.id } });
    console.log(`  COUNT LINES: ${countLines}`);

    // Order lines (with quantities).
    const orderLines = await prisma.orderLine.findMany({ where: { itemId: item.id }, include: { suggestion: true } });
    console.log(`  ORDER LINES: ${orderLines.length}`);
    for (const l of orderLines) console.log(`    ${locs.get(l.suggestion.locationId)} ${l.suggestion.date.toISOString().slice(0, 10)} seq${l.suggestion.seq}: suggested=${nz(l.suggestedQty)} ordered=${nz(l.orderedQty)}`);

    // Recipe lines (how the item is used in dishes).
    const recipeLines = await prisma.recipeLine.findMany({ where: { itemId: item.id }, include: { recipeVersion: { include: { recipe: true } } } });
    console.log(`  RECIPE LINES: ${recipeLines.length}`);
    for (const rl of recipeLines) console.log(`    ${dishes.get(rl.recipeVersion.recipe.dishId) || `dish#${rl.recipeVersion.recipe.dishId}`} (v${rl.recipeVersion.version}): qty=${rl.qty} unitNote=${nz(rl.unitNote)}`);
  }
  console.log('\n(read-only — no changes made)\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
