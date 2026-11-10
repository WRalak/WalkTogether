import { prisma } from '../../database/prisma';

const DAY = 86_400_000;

/**
 * Revenue analytics per currency. MRR normalises yearly plans to monthly; ARR = MRR × 12.
 * Figures come from verified payments and live subscriptions only.
 */
export async function revenueOverview() {
  const live = await prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'PAST_DUE', 'GRACE'] } }, include: { plan: true } });
  const mrr: Record<string, number> = {};
  const counts = { clubPaid: 0, individualPaid: 0 };
  for (const s of live) {
    if (s.plan.amountMinor <= 0) continue;
    const monthly = s.plan.interval === 'YEAR' ? Math.round(s.plan.amountMinor / 12) : s.plan.amountMinor;
    mrr[s.plan.currency] = (mrr[s.plan.currency] ?? 0) + monthly;
    if (s.clubId) counts.clubPaid++;
    else counts.individualPaid++;
  }
  const since30 = new Date(Date.now() - 30 * DAY);
  const [byPurpose, cancellations30d, failed30d, monthly] = await Promise.all([
    prisma.payment.groupBy({ by: ['purpose', 'currency'], where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] }, confirmedAt: { gte: since30 } }, _sum: { amountMinor: true, refundedMinor: true }, _count: true }),
    prisma.subscription.count({ where: { OR: [{ canceledAt: { gte: since30 } }, { status: 'EXPIRED', updatedAt: { gte: since30 } }] } }),
    prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: since30 } } }),
    prisma.$queryRaw<{ month: Date; purpose: string; currency: string; total: bigint }[]>`
      SELECT date_trunc('month', confirmed_at) AS month, purpose::text, currency, sum(amount_minor - refunded_minor) AS total
        FROM payments WHERE status IN ('SUCCEEDED','PARTIALLY_REFUNDED') AND confirmed_at >= now() - interval '12 months'
       GROUP BY 1, 2, 3 ORDER BY 1`,
  ]);
  return {
    mrr,
    arr: Object.fromEntries(Object.entries(mrr).map(([c, v]) => [c, v * 12])),
    paidSubscriptions: counts,
    last30d: byPurpose.map((r) => ({ purpose: r.purpose, currency: r.currency, payments: r._count, grossMinor: r._sum.amountMinor ?? 0, refundedMinor: r._sum.refundedMinor ?? 0 })),
    cancellations30d,
    failedPayments30d: failed30d,
    monthly: monthly.map((m) => ({ month: new Date(m.month).toISOString().slice(0, 7), purpose: m.purpose, currency: m.currency, netMinor: Number(m.total) })),
  };
}
