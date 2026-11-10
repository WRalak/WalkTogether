/**
 * Idempotent seed: permission catalogues, admin roles and default platform settings.
 * Does NOT create users, clubs or admins (use scripts/create-admin.ts for the first admin).
 * Pass --demo to add demo data for local development only.
 */
import { prisma } from '../src/database/prisma';
import { syncPermissionCatalog } from '../src/modules/platform/catalog';
import { PLATFORM_SETTING_DEFAULTS } from '../src/modules/platform/settings';

async function main() {
  await syncPermissionCatalog();
  for (const [key, value] of Object.entries(PLATFORM_SETTING_DEFAULTS)) {
    await prisma.platformSetting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }
  const flags = [
    { key: 'gps_tracking', description: 'GPS activity recording (Phase 3)' },
    { key: 'social_feed', description: 'Community feed (Phase 5)' },
    { key: 'payments_mpesa', description: 'M-Pesa payments (Phase 7)' },
  ];
  for (const f of flags) await prisma.featureFlag.upsert({ where: { key: f.key }, create: f, update: {} });

  if (process.argv.includes('--demo')) {
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') throw new Error('Refusing to seed demo data in a deployed environment');
    const { seedDemo } = await import('./seed-demo');
    await seedDemo();
  }
  console.log('Seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    const { redis } = await import('../src/database/redis');
    redis.disconnect();
  });
