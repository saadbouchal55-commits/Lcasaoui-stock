// Make "Yaourt Grec" a sellable product on the LIVE DB without a reseed.
// It's sold as-is (1 pot taken from the kitchen per sale), so: item unit = UNIT,
// a Dish "Yaourt Grec" with recipe 1× the item, and POS mappings. Idempotent.
//   node prisma/add-yaourt-grec.js
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';

async function main() {
  // 1. The item: sold as-is, counted/ordered by the pot (unit).
  const item = await prisma.item.upsert({
    where: { name: 'Yaourt Grec' },
    update: { unit: 'UNIT', isTracked: true, inRecipes: true, category: 'SOLD_AS_IS' },
    create: { name: 'Yaourt Grec', unit: 'UNIT', isTracked: true, inRecipes: true, category: 'SOLD_AS_IS' },
  });

  // 2. The sellable dish with a 1:1 recipe (1 sold = 1 pot from the kitchen).
  let dish = await prisma.dish.findUnique({ where: { name: 'Yaourt Grec' }, include: { recipes: true } });
  if (!dish) dish = await prisma.dish.create({ data: { name: 'Yaourt Grec' }, include: { recipes: true } });
  if (dish.recipes.length === 0) {
    const recipe = await prisma.recipe.create({ data: { dishId: dish.id } });
    const version = await prisma.recipeVersion.create({
      data: {
        recipeId: recipe.id, version: 1, effectiveFrom: new Date(Date.UTC(2000, 0, 1)),
        lines: { create: [{ itemId: item.id, qty: 1, unitNote: 'U' }] },
      },
    });
    await prisma.recipe.update({ where: { id: recipe.id }, data: { activeVersion: version.id } });
  }

  // 3. POS mappings so sales import recognises it (both spellings).
  for (const posName of ['Yaourt GREC', 'Yaourt Grec']) {
    await prisma.posMapping.upsert({ where: { posName }, update: { dishId: dish.id }, create: { posName, dishId: dish.id } });
  }

  console.log('Yaourt Grec is now a sellable product (1 unit each) — appears in Déclarer les Ventes and the order.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
