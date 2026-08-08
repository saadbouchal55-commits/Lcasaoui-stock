// Convert an item's native unit to PIECE and multiply EVERY stored quantity by a
// factor, so the real amount is preserved (e.g. a pack of 144 -> 144 pieces).
// Recipe lines need no change: once the item is PIECE, a 'pc' or 'U' recipe note
// passes straight through as pieces.
//
// DRY-RUN by default (prints every before -> after); pass --apply to write.
// ALWAYS back up first:  npm run export:data
//
//   node prisma/convert-to-pieces.js "Cheddar"                 (factor = packSize, auto)
//   node prisma/convert-to-pieces.js "Oreo entier (PS)"        (auto 144)
//   node prisma/convert-to-pieces.js "Pain Tacos" --factor=18  (UNIT item: give factor)
//   ...add --apply to execute
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const fArg = argv.find((a) => a.startsWith('--factor='));
const factorOverride = fArg ? Number(fArg.split('=')[1]) : null;
const name = argv.filter((a) => !a.startsWith('--'))[0];

async function main() {
  if (!name) { console.log('Usage: node prisma/convert-to-pieces.js "Item name" [--factor=N] [--apply]'); return; }
  const item = await prisma.item.findUnique({ where: { name } });
  if (!item) { console.log(`Item "${name}" not found.`); return; }
  if (item.unit === 'PIECE') { console.log(`"${name}" is already PIECE — nothing to do.`); return; }

  const factor = item.unit === 'PACKAGE' ? (factorOverride ?? item.packSize) : factorOverride;
  if (!(factor > 0)) {
    console.log(`"${name}" is ${item.unit} (packSize ${item.packSize ?? '—'}). Provide --factor=N (pieces per current unit).`);
    return;
  }
  const r = (x) => Math.round((Number(x) || 0) * factor); // pieces are whole
  console.log(`\n${APPLY ? '*** APPLY ***' : 'DRY RUN'}  "${item.name}"  ${item.unit}(packSize ${item.packSize ?? '—'}) -> PIECE   factor ×${factor}\n`);

  const [moves, counts, orders, wastes, recipes] = await Promise.all([
    prisma.stockMovement.findMany({ where: { itemId: item.id }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.countLine.findMany({ where: { itemId: item.id } }),
    prisma.orderLine.findMany({ where: { itemId: item.id }, include: { suggestion: true } }),
    prisma.wasteDeclaration.findMany({ where: { itemId: item.id, refType: 'ITEM' } }),
    prisma.recipeLine.findMany({ where: { itemId: item.id } }),
  ]);

  console.log(`Stock movements: ${moves.length}`);
  moves.forEach((m) => console.log(`   [${m.type}] ${m.qty} -> ${r(m.qty)}   ref=${m.ref ?? '—'}  ${m.date.toISOString().slice(0, 10)}`));
  console.log(`Count lines: ${counts.length}`);
  counts.forEach((c) => console.log(`   ${c.countedQty} -> ${r(c.countedQty)}`));
  console.log(`Order lines: ${orders.length}`);
  orders.forEach((o) => console.log(`   ${o.suggestion.date.toISOString().slice(0, 10)}: suggested ${o.suggestedQty}->${r(o.suggestedQty)}  ordered ${o.orderedQty == null ? '—' : `${o.orderedQty}->${r(o.orderedQty)}`}`));
  console.log(`Waste declarations: ${wastes.length}`);
  wastes.forEach((w) => console.log(`   ${w.qty} -> ${r(w.qty)}   ${w.date.toISOString().slice(0, 10)}`));
  console.log(`Recipe lines (UNCHANGED — pass through as pieces): ${recipes.length}`);
  recipes.forEach((rl) => console.log(`   qty=${rl.qty} note=${rl.unitNote ?? '—'}${['pc', 'u'].includes(String(rl.unitNote || '').toLowerCase()) ? '' : '  ⚠ unexpected note — check'}`));

  if (!APPLY) { console.log('\nDRY RUN — nothing changed. Add --apply (after a backup) to execute.\n'); return; }

  const ops = [];
  for (const m of moves) ops.push(prisma.stockMovement.update({ where: { id: m.id }, data: { qty: r(m.qty) } }));
  for (const c of counts) ops.push(prisma.countLine.update({ where: { id: c.id }, data: { countedQty: r(c.countedQty) } }));
  for (const o of orders) ops.push(prisma.orderLine.update({ where: { id: o.id }, data: { suggestedQty: r(o.suggestedQty), orderedQty: o.orderedQty == null ? null : r(o.orderedQty) } }));
  for (const w of wastes) ops.push(prisma.wasteDeclaration.update({ where: { id: w.id }, data: { qty: r(w.qty) } }));
  ops.push(prisma.item.update({ where: { id: item.id }, data: { unit: 'PIECE', packSize: null } }));
  await prisma.$transaction(ops);
  console.log(`\nApplied. ${moves.length} movements, ${counts.length} counts, ${orders.length} order lines, ${wastes.length} waste decls converted; "${item.name}" -> PIECE.\n`);
  console.log(`Verify:  npm run inspect:item "${item.name}"\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
