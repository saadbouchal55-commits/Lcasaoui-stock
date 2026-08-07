// Reset a user's password directly (admin recovery).
//   node prisma/set-password.js <username> <newPassword>
// Clears the "must change password" flag too, so you can log straight in.
import '../src/lib/loadenv.js';
import prisma from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node prisma/set-password.js <username> <newPassword>');
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const res = await prisma.user.updateMany({ where: { username }, data: { passwordHash, mustChangePassword: false } });
  if (res.count === 0) {
    console.error(`No user named "${username}". Existing users:`);
    const users = await prisma.user.findMany({ select: { username: true, role: true } });
    for (const u of users) console.error(`  - ${u.username} (${u.role})`);
    process.exit(2);
  }
  console.log(`Password updated for "${username}". You can log in now.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
