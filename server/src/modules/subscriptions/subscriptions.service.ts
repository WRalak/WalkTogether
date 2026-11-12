import type { BillingInterval, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../database/prisma';
import { conflict, notFound } from '../../shared/errors';
import { audit, type AuditContext } from '../audit/audit.service';
import { requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';
import { invalidateEntitlements, resolveEntitlements, type Subject } from './entitlements.service';

const DAY = 24 * 3600_000;
const planSelect = {
  id: true,
  code: true,
  audience: true,
  name: true,
  description: true,
  currency: true,
  amountMinor: true,
  interval: true,
  trialDays: true,
  isDefault: true,
  sortOrder: true,
  entitlements: { select: { key: true, intLimit: true, boolValue: true } },
} satisfies Prisma.SubscriptionPlanSelect;

export function addInterval(from: Date, interval: BillingInterval) {
  const d = new Date(from);
  if (interval === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Public plan catalogue: only active plans (prices set by platform admins). */
export async function listPlans(audience?: 'CLUB' | 'INDIVIDUAL') {
  return prisma.subscriptionPlan.findMany({
    where: { isActive: true, ...(audience ? { audience } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { amountMinor: 'asc' }],
    select: planSelect,
  });
}

async function currentSubscription(subject: Subject) {
  return prisma.subscription.findFirst({
    where: { ...('clubId' in subject ? { clubId: subject.clubId } : { userId: subject.userId }), status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] } },
    include: { plan: { select: planSelect } },
  });
}

export async function getClubBilling(clubId: string, userId: string) {
  await requireClubPermission(clubId, userId, 'billing.view', { allowInactiveClub: true });
  return { subscription: await currentSubscription({ clubId }), entitlements: await resolveEntitlements({ clubId }) };
}

export async function getMySubscription(userId: string) {
  return { subscription: await currentSubscription({ userId }), entitlements: await resolveEntitlements({ userId }) };
}

/**
 * Activates or renews a subscription. ONLY called from verified payment confirmation
 * (payments module) or by platform admins (comped plans) — never from client input.
 */
export async function activateSubscription(subject: Subject, planId: string, tx: Tx, opts: { trial?: boolean } = {}) {
  const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
  const now = new Date();
  const existing = await tx.subscription.findFirst({
    where: { ...('clubId' in subject ? { clubId: subject.clubId } : { userId: subject.userId }), status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] } },
  });
  let sub;
  if (existing && existing.planId === planId) {
    // Renewal: extend from the later of now / current period end.
    const start = existing.currentPeriodEnd > now ? existing.currentPeriodEnd : now;
    sub = await tx.subscription.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: addInterval(start, plan.interval), graceUntil: null, cancelAtPeriodEnd: false, canceledAt: null },
    });
  } else {
    if (existing) await tx.subscription.update({ where: { id: existing.id }, data: { status: 'CANCELED', canceledAt: now } });
    const end = opts.trial && plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * DAY) : addInterval(now, plan.interval);
    sub = await tx.subscription.create({
      data: {
        ...('clubId' in subject ? { clubId: subject.clubId } : { userId: subject.userId }),
        planId,
        status: opts.trial ? 'TRIALING' : 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: end,
      },
    });
  }
  await invalidateEntitlements(subject);
  return sub;
}

export async function cancelSubscription(subject: Subject, actorId: string, ctx: AuditContext) {
  if ('clubId' in subject) await requireClubPermission(subject.clubId, actorId, 'billing.manage', { allowInactiveClub: true });
  const sub = await currentSubscription(subject);
  if (!sub) throw notFound('No active subscription');
  if (sub.cancelAtPeriodEnd) throw conflict('Subscription is already set to cancel', 'ALREADY_CANCELING');
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await audit(
      { actorType: 'USER', actorId, action: 'subscription.cancel_requested', targetType: 'subscription', targetId: sub.id, clubId: 'clubId' in subject ? subject.clubId : null },
      ctx,
      tx,
    );
  });
  return { cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd };
}

/** Recipients for billing notices: club owner + billing managers, or the individual user. */
async function billingRecipients(sub: { clubId: string | null; userId: string | null }) {
  if (sub.userId) return [sub.userId];
  const rows = await prisma.clubMembership.findMany({
    where: { clubId: sub.clubId!, status: 'ACTIVE', role: { permissions: { some: { permissionKey: 'billing.manage' } } } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Daily lifecycle job: period end → CANCELED (if cancel requested) or PAST_DUE/GRACE → EXPIRED.
 * Expiry never deletes data; entitlements simply fall back to the free plan.
 */
export async function runSubscriptionLifecycle(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] }, OR: [{ currentPeriodEnd: { lte: now } }, { graceUntil: { lte: now } }] },
    include: { plan: true },
    take: 500,
  });
  const result = { canceled: 0, grace: 0, expired: 0 };
  for (const sub of due) {
    const subject: Subject = sub.clubId ? { clubId: sub.clubId } : { userId: sub.userId! };
    if (sub.cancelAtPeriodEnd || sub.status === 'TRIALING') {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: sub.cancelAtPeriodEnd ? 'CANCELED' : 'EXPIRED', canceledAt: now } });
      result.canceled++;
    } else if (sub.status === 'GRACE' && sub.graceUntil && sub.graceUntil <= now) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
      result.expired++;
      await notify({
        userIds: await billingRecipients(sub),
        type: 'subscription.expired',
        title: `${sub.plan.name} has ended`,
        body: 'Paid features are now off. All your data is kept; renew any time to restore them.',
      });
    } else if (sub.status !== 'GRACE') {
      const graceUntil = new Date(sub.currentPeriodEnd.getTime() + sub.plan.graceDays * DAY);
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'GRACE', graceUntil } });
      result.grace++;
      await notify({
        userIds: await billingRecipients(sub),
        type: 'subscription.expiring',
        title: `Renew ${sub.plan.name}`,
        body: `Your plan period ended. Paid features stay on until ${graceUntil.toDateString()}.`,
      });
    }
    await invalidateEntitlements(subject);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Platform admin: plan management
// ---------------------------------------------------------------------------

type PlanInput = { code?: string; audience?: 'CLUB' | 'INDIVIDUAL'; entitlements?: { key: string; intLimit?: number | null; boolValue?: boolean | null }[] } & Record<
  string,
  unknown
>;

export async function adminListPlans() {
  return prisma.subscriptionPlan.findMany({
    orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }],
    include: { entitlements: true, _count: { select: { subscriptions: { where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] } } } } } },
  });
}

export async function adminUpsertPlan(adminId: string, planId: string | null, input: PlanInput, ctx: AuditContext) {
  const { entitlements, ...fields } = input;
  return prisma
    .$transaction(async (tx) => {
      if (fields.isDefault) {
        const audience = (fields.audience as string | undefined) ?? (planId ? (await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } })).audience : undefined);
        await tx.subscriptionPlan.updateMany({ where: { audience: audience as 'CLUB', isDefault: true, ...(planId ? { id: { not: planId } } : {}) }, data: { isDefault: false } });
      }
      const plan = planId
        ? await tx.subscriptionPlan.update({ where: { id: planId }, data: fields as Prisma.SubscriptionPlanUpdateInput })
        : await tx.subscriptionPlan.create({ data: fields as Prisma.SubscriptionPlanCreateInput });
      if (entitlements) {
        await tx.subscriptionEntitlement.deleteMany({ where: { planId: plan.id } });
        if (entitlements.length)
          await tx.subscriptionEntitlement.createMany({
            data: entitlements.map((e) => ({ planId: plan.id, key: e.key, intLimit: e.intLimit ?? null, boolValue: e.boolValue ?? null })),
          });
      }
      await audit(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: planId ? 'admin.plan_updated' : 'admin.plan_created',
          targetType: 'plan',
          targetId: plan.id,
          metadata: JSON.parse(JSON.stringify(input)),
        },
        ctx,
        tx,
      );
      return plan;
    })
    .finally(async () => {
      // Entitlement caches expire within 60 s; no per-subject invalidation needed for plan edits.
    });
}

/** Comp a plan without payment (e.g. pilot club, partners). Audited. */
export async function adminGrantPlan(adminId: string, subject: Subject, planId: string, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const sub = await activateSubscription(subject, planId, tx);
    await audit(
      {
        actorType: 'ADMIN',
        actorId: adminId,
        action: 'admin.subscription_granted',
        targetType: 'subscription',
        targetId: sub.id,
        clubId: 'clubId' in subject ? subject.clubId : null,
        metadata: { planId },
      },
      ctx,
      tx,
    );
    return sub;
  });
}
