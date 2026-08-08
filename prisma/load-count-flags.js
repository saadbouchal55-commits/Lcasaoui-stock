// Load per-item daily-count flags from data/daily_count_flags.json into
// Item.countFrequency:  true -> "DAILY",  false -> "NONE".
// TARGETED update — touches ONLY countFrequency, never wipes or re-seeds anything.
// DRY-RUN by default (prints every change + any name mismatches); --apply to write.
//
//   node prisma/load-count-flags.js            (dry run)
//   node prisma/load-count-flags.js --apply
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const APPLY = process.argv.includes('--apply');
const dir = dirname(fileURLToPath(import.meta.url));
const flags = JSON.parse(readFileSync(join(dir, '../data/daily_count_flags.json'), 'utf8'));

async function main() {
  const items = await prisma.item.findMany({ select: { id: true, name: true, countFrequency: true, isTracked: true } });
  const byName = new Map(items.map((i) => [i.name, i]));

  let daily = 0, none = 0;
  const updates = [];
  const unmatched = []; // flag name with no matching item
  for (const [name, isDaily] of Object.entries(flags)) {
    if (isDaily) daily++; else none++;
    const item = byName.get(name);
    if (!item) { unmatched.push(name); continue; }
    const target = isDaily ? 'DAILY' : 'NONE';
    if (item.countFrequency !== target) updates.push({ id: item.id, name, from: item.countFrequency, to: target });
  }
  const unflagged = items.filter((i) => !(i.name in flags)).map((i) => i.name); // DB items absent from the file

  console.log(`\n${APPLY ? '*** APPLY ***' : 'DRY RUN'}  daily-count flag load`);
  console.log(`Flags in JSON: ${Object.keys(flags).length}  (DAILY ${daily}, NONE ${none})`);
  console.log(`Items to change: ${updates.length}`);
  updates.forEach((u) => console.log(`   ${u.name}: ${u.from} -> ${u.to}`));
  if (unmatched.length) {
    console.log(`\n⚠ Flags with NO matching item (skipped — check spelling): ${unmatched.length}`);
    unmatched.forEach((n) => console.log(`   - ${n}`));
  }
  if (unflagged.length) {
    console.log(`\nℹ DB items not in the flags file (left as-is, default DAILY): ${unflagged.length}`);
    unflagged.forEach((n) => console.log(`   - ${n}`));
  }

  if (!APPLY) { console.log('\nDRY RUN — nothing changed. Re-run with --apply to write.\n'); return; }
  if (updates.length) {
    await prisma.$transaction(updates.map((u) => prisma.item.update({ where: { id: u.id }, data: { countFrequency: u.to } })));
  }
  console.log(`\nApplied. Updated ${updates.length} item(s). NONE (excluded from daily count): ${none}.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
