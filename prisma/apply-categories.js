// Non-destructive updater: sets storageZone + subCategory on existing items from
// data/item_categories.json. Safe to run on a live DB (touches only those two
// fields). Run after `prisma db push`:  npm run apply:categories
import '../src/lib/loadenv.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prisma from '../src/lib/prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'data', 'item_categories.json');

async function main() {
  const categories = JSON.parse(readFileSync(FILE, 'utf-8'));
  let updated = 0;
  const missing = [];
  for (const [name, cat] of Object.entries(categories)) {
    const res = await prisma.item.updateMany({
      where: { name },
      data: { storageZone: cat.zone || null, subCategory: cat.subcategory || null },
    });
    if (res.count === 0) missing.push(name);
    else updated += res.count;
  }
  console.log(`Applied storage categories to ${updated} items.`);
  if (missing.length) console.warn(`Not found in DB (skipped): ${missing.join(', ')}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
