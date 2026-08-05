// Single Prisma client instance shared across the app.
// All DB access goes through Prisma (no raw MySQL-specific SQL) so the
// MySQL -> PostgreSQL move later is a config change, not a rewrite.
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

export default prisma;
