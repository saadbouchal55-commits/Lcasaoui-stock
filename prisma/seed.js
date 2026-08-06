// Seed script — loads /data into the DB via Prisma.
// Idempotent-ish: safe to re-run (upserts catalogue; rebuilds history tables).
import '../src/lib/loadenv.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prisma from '../src/lib/prisma.js';
import { parseCsv } from '../src/lib/csv.js';
import { hashPassword } from '../src/lib/password.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');
const readJson = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf-8'));
const utcDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};

const UNIT_MAP = { kg: 'KG', unit: 'UNIT', piece: 'PIECE', package: 'PACKAGE', l: 'L', untracked: 'UNTRACKED' };
const CAT_MAP = { ingredient: 'INGREDIENT', packaging: 'PACKAGING', sold_as_is: 'SOLD_AS_IS' };

// Frites Maison rule (from pos_mapping.json.special_frites). Épices Frite qty is
// a small seasoning default the Direction can edit later via the recipe editor.
const FRITES_FRIED_G = 150;
const EPICES_FRITE_G = 5;

// Full wipe of ALL app data (used by `npm run seed:reset`). Deletes children
// before parents so foreign keys don't block. DESTRUCTIVE — test data only.
async function wipeAll() {
  console.log('  RESET: deleting all existing data…');
  await prisma.orderLine.deleteMany({});
  await prisma.orderSuggestion.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.countLine.deleteMany({});
  await prisma.salesLine.deleteMany({});
  await prisma.wasteDeclaration.deleteMany({});
  await prisma.recipeLine.deleteMany({});
  await prisma.recipeVersion.deleteMany({});
  await prisma.recipe.deleteMany({});
  await prisma.posMapping.deleteMany({});
  await prisma.buffer.deleteMany({});
  await prisma.dailyEntry.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.dish.deleteMany({});
  await prisma.item.deleteMany({});
  await prisma.location.deleteMany({});
}

async function main() {
  const RESET = process.argv.includes('--reset');
  console.log(RESET ? 'RESETTING + reseeding L\'Casaoui stock tool…' : 'Seeding L\'Casaoui stock tool…');
  if (RESET) await wipeAll();

  // ── 1. Locations ────────────────────────────────────────────────────────────
  const L1 = await prisma.location.upsert({ where: { code: 'L1' }, update: { name: 'Narjiss' }, create: { code: 'L1', name: 'Narjiss' } });
  const L2 = await prisma.location.upsert({ where: { code: 'L2' }, update: { name: 'Ain Chekef' }, create: { code: 'L2', name: 'Ain Chekef' } });
  const locByCode = { L1, L2 };
  console.log('  locations: L1, L2');

  // ── 2. First-run Direction account ──────────────────────────────────────────
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const username = process.env.SEED_ADMIN_USERNAME || 'direction';
    const password = process.env.SEED_ADMIN_PASSWORD || 'change-me';
    await prisma.user.create({ data: { username, passwordHash: await hashPassword(password), role: 'DIRECTION', locationId: null, mustChangePassword: true } });
    console.log(`  admin user "${username}" created (will be forced to set a new password on first login)`);
  }

  // ── 3. Items ────────────────────────────────────────────────────────────────
  const items = readJson('items.json');
  // Storage zone + subcategory per item (keyed by name).
  let categories = {};
  try { categories = readJson('item_categories.json'); } catch { console.warn('  ! item_categories.json not found — zones left null'); }
  const itemByName = new Map();
  let missingCat = 0;
  for (const it of items) {
    const unit = UNIT_MAP[String(it.unit).toLowerCase()] || 'UNTRACKED';
    const category = CAT_MAP[String(it.category).toLowerCase()] || 'INGREDIENT';
    const cat = categories[it.name];
    if (!cat) missingCat++;
    const storageZone = cat?.zone || null; // 'R' | 'C' | 'A'
    const subCategory = cat?.subcategory || null;
    const saved = await prisma.item.upsert({
      where: { name: it.name },
      update: { unit, packSize: it.pack_size ?? null, yieldPct: it.yield ?? null, isTracked: !!it.tracked, inRecipes: !!it.in_recipes, category, storageZone, subCategory },
      create: { name: it.name, unit, packSize: it.pack_size ?? null, yieldPct: it.yield ?? null, isTracked: !!it.tracked, inRecipes: !!it.in_recipes, category, storageZone, subCategory },
    });
    itemByName.set(it.name, saved);
  }
  console.log(`  items: ${items.length}` + (missingCat ? ` (${missingCat} without storage zone)` : ''));

  const requireItem = (name) => {
    const i = itemByName.get(name);
    if (!i) throw new Error(`Seed error: recipe references unknown item "${name}"`);
    return i;
  };

  // ── 4. Dishes + recipes (v1) ────────────────────────────────────────────────
  const recipes = readJson('recipes.json');
  const dishByName = new Map();

  async function ensureDishWithRecipe(dishName, lines) {
    let dish = await prisma.dish.findUnique({ where: { name: dishName }, include: { recipes: true } });
    if (!dish) dish = await prisma.dish.create({ data: { name: dishName }, include: { recipes: true } });
    dishByName.set(dishName, dish);
    if (dish.recipes.length) return dish; // already has a recipe — leave versions intact

    const recipe = await prisma.recipe.create({ data: { dishId: dish.id } });
    const version = await prisma.recipeVersion.create({
      data: {
        recipeId: recipe.id,
        version: 1,
        effectiveFrom: new Date(Date.UTC(2000, 0, 1)), // effective for all historical days
        lines: { create: lines.map((l) => ({ itemId: requireItem(l.item).id, qty: Number(l.qty), unitNote: l.unit || null })) },
      },
    });
    await prisma.recipe.update({ where: { id: recipe.id }, data: { activeVersion: version.id } });
    return dish;
  }

  for (const [dishName, lines] of Object.entries(recipes)) {
    await ensureDishWithRecipe(dishName, lines);
  }
  // Special frites dishes (map directly to Frites consumption).
  await ensureDishWithRecipe('Frites Maison', [{ item: 'Frites', qty: FRITES_FRIED_G, unit: 'g' }]);
  await ensureDishWithRecipe('Frites Maison Epicees', [
    { item: 'Frites', qty: FRITES_FRIED_G, unit: 'g' },
    { item: 'Épices Frite', qty: EPICES_FRITE_G, unit: 'g' },
  ]);
  console.log(`  dishes+recipes: ${dishByName.size}`);

  // ── 5. POS mapping ──────────────────────────────────────────────────────────
  const pos = readJson('pos_mapping.json');
  const posToDishName = { ...pos.map, 'Frites Maison': 'Frites Maison', 'Frites Maison Epicees': 'Frites Maison Epicees' };
  for (const [posName, dishName] of Object.entries(posToDishName)) {
    const dish = dishByName.get(dishName);
    if (!dish) { console.warn(`  ! POS map: dish "${dishName}" not found for "${posName}"`); continue; }
    await prisma.posMapping.upsert({ where: { posName }, update: { dishId: dish.id }, create: { posName, dishId: dish.id } });
  }
  console.log(`  pos mappings: ${Object.keys(posToDishName).length}`);

  // ── 6. Order history -> CONFIRMED_SENT orders (learning bootstrap) ──────────
  // Learning now reads confirmed-sent order lines (ActualSent is gone). We load
  // the historical orders as CONFIRMED_SENT orders. NOTE: this does NOT post to
  // the stock ledger, so each restaurant stays "uninitialized" until Direction
  // runs Initial Stock at go-live.
  const orderRows = parseCsv(readFileSync(join(DATA, 'order_history.csv'), 'utf-8'));
  // Clear existing orders (pre-launch re-seed) and rebuild historical ones.
  await prisma.orderLine.deleteMany({});
  await prisma.orderSuggestion.deleteMany({});

  const byLocDate = new Map(); // `${locId}:${dateStr}` -> Map(itemId -> qty)
  const unknownOrderItems = new Set();
  for (const r of orderRows) {
    const loc = locByCode[r.location];
    const item = itemByName.get(r.item);
    const qty = Number(r.qty_ordered);
    if (!loc || !r.date || !qty) continue;
    if (!item) { unknownOrderItems.add(r.item); continue; }
    const key = `${loc.id}:${r.date}`;
    if (!byLocDate.has(key)) byLocDate.set(key, new Map());
    const m = byLocDate.get(key);
    m.set(item.id, (m.get(item.id) || 0) + qty);
  }
  let orderSeeded = 0;
  for (const [key, itemMap] of byLocDate) {
    const [locId, dateStr] = key.split(':');
    const order = await prisma.orderSuggestion.create({
      data: { locationId: Number(locId), date: utcDate(dateStr), status: 'CONFIRMED_SENT', confirmedAt: utcDate(dateStr) },
    });
    await prisma.orderLine.createMany({
      data: [...itemMap].map(([itemId, qty]) => ({ suggestionId: order.id, itemId, suggestedQty: qty, orderedQty: qty })),
    });
    orderSeeded += itemMap.size;
  }
  console.log(`  order history -> CONFIRMED_SENT orders: ${orderSeeded} lines across ${byLocDate.size} orders` + (unknownOrderItems.size ? ` (skipped unknown: ${[...unknownOrderItems].join(', ')})` : ''));

  // ── 7. Sales history -> DailyEntry + SalesLine (per restaurant) ─────────────
  const ignore = new Set([...(pos.ignore || []), ...(pos.drinks || [])]);

  async function seedSales(file, location) {
    let rows;
    try {
      rows = parseCsv(readFileSync(join(DATA, file), 'utf-8'));
    } catch {
      console.log(`  ${location.code} sales history: file ${file} not found — skipped`);
      return;
    }
    const byDate = new Map(); // dateStr -> Map(dishId -> qty)
    const unknownDishes = new Set();
    for (const r of rows) {
      if (r.location && r.location !== location.code) continue;
      const date = r.date;
      const qty = Number(r.qty_sold);
      if (!date || !qty) continue;
      if (ignore.has(r.dish)) continue;
      const dishName = posToDishName[r.dish];
      const dish = dishName ? dishByName.get(dishName) : null;
      if (!dish) { unknownDishes.add(r.dish); continue; }
      if (!byDate.has(date)) byDate.set(date, new Map());
      const m = byDate.get(date);
      m.set(dish.id, (m.get(dish.id) || 0) + qty);
    }
    let salesDays = 0;
    for (const [dateStr, dishMap] of byDate) {
      const date = utcDate(dateStr);
      const entry = await prisma.dailyEntry.upsert({
        where: { locationId_date: { locationId: location.id, date } },
        update: {},
        create: { locationId: location.id, date, status: 'open' },
      });
      await prisma.salesLine.deleteMany({ where: { dailyEntryId: entry.id } });
      await prisma.salesLine.createMany({ data: [...dishMap].map(([dishId, qtySold]) => ({ dailyEntryId: entry.id, dishId, qtySold })) });
      salesDays++;
    }
    console.log(`  ${location.code} sales history: ${salesDays} days` + (unknownDishes.size ? ` (skipped: ${[...unknownDishes].join(', ')})` : ''));
  }

  await seedSales('sales_history_L1.csv', L1);
  await seedSales('sales_history_L2.csv', L2);

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
