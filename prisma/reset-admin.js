// Remove ALL user accounts and create a single fresh Direction admin.
//   node prisma/reset-admin.js <username> <password>
// Use to clear test/setup accounts and start clean. (No forced password change.)
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node prisma/reset-admin.js <username> <password>');
    process.exit(1);
  }
  await prisma.session.deleteMany({}); // invalidate all logins
  const del = await prisma.user.deleteMany({});
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), role: 'DIRECTION', locationId: null, active: true, mustChangePassword: false },
  });
  console.log(`Removed ${del.count} account(s). Created Direction admin "${user.username}". Log in with it.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
