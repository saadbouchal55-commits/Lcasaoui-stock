// Export ALL app data to a single timestamped JSON file (DB-portable).
// Use this to extract the live data before moving to a VPS:  npm run export:data
// Works regardless of MySQL/PostgreSQL since it goes through Prisma.
import '../src/lib/loadenv.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prisma from '../src/lib/prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'backups');

// Parent tables first (order also used by the importer).
export const MODELS = [
  'location', 'item', 'dish', 'recipe', 'recipeVersion', 'recipeLine', 'posMapping',
  'buffer', 'user', 'dailyEntry', 'salesLine', 'countLine', 'stockMovement',
  'orderSuggestion', 'orderLine', 'wasteDeclaration', 'auditLog',
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const dump = { exportedAt: new Date().toISOString(), data: {} };
  for (const m of MODELS) {
    dump.data[m] = await prisma[m].findMany();
    console.log(`  ${m}: ${dump.data[m].length}`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(OUT_DIR, `backup-${ts}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\nSaved ${file}`);
  console.log('Copy this file to the VPS, then: npm run import:data <file>');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
