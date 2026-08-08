// Nightly job — (re)generate the draft food order for every active location.
// Orders are dated the CURRENT business day (11:00→11:00 — a 01:30 run still
// belongs to the evening's business day, matching how the team dates orders in
// the UI); the engine itself predicts demand for the day the delivery covers.
// The order is NEVER auto-sent — low confidence / missing inputs mark it HELD.
// Schedule with cron, e.g.:
//   30 1 * * *  cd /var/www/Lcasaoui-stock && node jobs/nightly.js >> /var/log/lcasaoui-nightly.log 2>&1
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';
import { generateOrder } from '../src/services/orderservice.js';
import { currentBusinessDay } from '../src/lib/businessday.js';

async function main() {
  const date = new Date(`${currentBusinessDay()}T00:00:00Z`);
  const locations = await prisma.location.findMany({ where: { active: true } });
  for (const loc of locations) {
    const order = await generateOrder(loc.id, date);
    console.log(`[${new Date().toISOString()}] ${loc.code}: order for ${date.toISOString().slice(0, 10)} — status ${order?.status}${order?.holdReason ? ` (HELD: ${order.holdReason})` : ''}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
