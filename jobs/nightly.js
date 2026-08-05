// Nightly job — recompute & auto-send order suggestions for the next day at
// every active location, using the latest learning (actual-sent + consumption).
// Schedule with cron on shared hosting, e.g.:
//   30 1 * * *  cd /home/USER/app && node jobs/nightly.js >> logs/nightly.log 2>&1
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';
import { generateOrder } from '../src/services/orderservice.js';

function nextDayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1); // order tonight -> for tomorrow's delivery
  return d;
}

async function main() {
  const date = nextDayUtc();
  const locations = await prisma.location.findMany({ where: { active: true } });
  for (const loc of locations) {
    const order = await generateOrder(loc.id, date);
    console.log(`[${new Date().toISOString()}] ${loc.code}: order for ${date.toISOString().slice(0, 10)} — status ${order?.status}${order?.holdReason ? ` (HELD: ${order.holdReason})` : ''}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
