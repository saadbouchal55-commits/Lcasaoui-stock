// Import a JSON dump produced by export-data.js into the current database.
// DESTRUCTIVE: wipes every table first, then reloads (FK-safe order, ids kept).
//   npm run import:data backups/backup-XXXX.json
// Run AFTER `npx prisma db push` so the schema exists. Works MySQL->MySQL and
// MySQL->PostgreSQL (for PostgreSQL, reset sequences afterwards — see DEPLOY-VPS.md).
import '../src/lib/loadenv.js';
import { readFileSync } from 'node:fs';
import prisma from '../src/lib/prisma.js';

// Parent tables first (same order as export-data.js). Kept local so importing
// this file never triggers the exporter's side effects.
const MODELS = [
  'location', 'item', 'dish', 'recipe', 'recipeVersion', 'recipeLine', 'posMapping',
  'buffer', 'user', 'dailyEntry', 'salesLine', 'countLine', 'stockMovement',
  'orderSuggestion', 'orderLine', 'wasteDeclaration', 'auditLog',
];

// Revive ISO date strings back into Date objects for Prisma.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const reviver = (k, v) => (typeof v === 'string' && ISO.test(v) ? new Date(v) : v);

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node prisma/import-data.js <backup.json>'); process.exit(1); }
  const parsed = JSON.parse(readFileSync(file, 'utf-8'), reviver);
  const data = parsed.data || parsed;

  // Wipe everything (children first), including sessions.
  console.log('Wiping target database…');
  await prisma.session.deleteMany({});
  for (const m of [...MODELS].reverse()) await prisma[m].deleteMany({});

  // Insert parents first, keeping original ids.
  for (const m of MODELS) {
    const rows = data[m] || [];
    for (let i = 0; i < rows.length; i += 500) {
      await prisma[m].createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`  ${m}: ${rows.length}`);
  }
  console.log('Import complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
