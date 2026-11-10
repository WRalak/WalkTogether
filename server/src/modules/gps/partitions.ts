import { prisma } from '../../database/prisma';

/** Creates GPS point partitions for the current month and the next 3 (idempotent; daily job). */
export async function ensureGpsPartitions(months = 4) {
  const [row] = await prisma.$queryRaw<{ created: number }[]>`SELECT gps_partitions.ensure_partitions(date_trunc('month', now())::date, ${months}::int) AS created`;
  return { created: Number(row?.created ?? 0) };
}
