import { execSync } from 'node:child_process';
import { testEnv } from './env';

/** Rebuilds the test database schema from migrations once per test run. */
export default async function setup() {
  Object.assign(process.env, testEnv);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: testEnv.DATABASE_URL } } });
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, ...testEnv, CHECKPOINT_DISABLE: '1' } });
  const { syncPermissionCatalog } = await import('../src/modules/platform/catalog');
  await syncPermissionCatalog();
  const { redis } = await import('../src/database/redis');
  await redis.flushdb();
  await redis.quit();
  const { prisma: appPrisma } = await import('../src/database/prisma');
  await appPrisma.$disconnect();
}
