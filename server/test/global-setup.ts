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
  const { seedDefaultAchievements } = await import('../src/modules/challenges/achievements.service');
  await seedDefaultAchievements();
  // Least-privilege mode (CI): after migrating as the schema owner, apply the production role
  // grants and run the whole suite as the restricted application role `wt_app`.
  if (process.env.TEST_APP_DATABASE_URL) {
    execSync(`psql "${String(testEnv.DATABASE_URL).split('?')[0]}" -v ON_ERROR_STOP=1 -q -f ../infrastructure/deployment/database-roles.sql`, { stdio: 'pipe' });
  }
  const { redis } = await import('../src/database/redis');
  await redis.flushdb();
  await redis.quit();
  const { prisma: appPrisma } = await import('../src/database/prisma');
  await appPrisma.$disconnect();
}
