import { ENTITLEMENTS, type EntitlementKey, type EntitlementValues } from '@walktogether/shared-types';
import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';
import { AppError } from '../../shared/errors';

export type Subject = { clubId: string } | { userId: string };

const LIVE = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] as const;
const cacheKey = (s: Subject) => ('clubId' in s ? `ent:club:${s.clubId}` : `ent:user:${s.userId}`);

/**
 * Effective entitlements for a club or a user. A club's plan NEVER contributes to a user's
 * entitlements (and vice versa): the subjects are resolved independently.
 */
export async function resolveEntitlements(subject: Subject): Promise<{ planCode: string | null; planName: string | null; status: string; values: EntitlementValues }> {
  try {
    const cached = await redis.get(cacheKey(subject));
    if (cached) return JSON.parse(cached);
  } catch {
    /* cache is best-effort */
  }
  const audience = 'clubId' in subject ? 'CLUB' : 'INDIVIDUAL';
  const now = new Date();
  const sub = await prisma.subscription.findFirst({
    where: { ...('clubId' in subject ? { clubId: subject.clubId } : { userId: subject.userId }), status: { in: [...LIVE] } },
    include: { plan: { include: { entitlements: true } } },
  });
  const usable = sub && (sub.status !== 'GRACE' || (sub.graceUntil && sub.graceUntil > now));
  const plan = usable ? sub!.plan : await prisma.subscriptionPlan.findFirst({ where: { audience, isDefault: true }, include: { entitlements: true } });

  const values: EntitlementValues = {};
  for (const [key, def] of Object.entries(ENTITLEMENTS)) {
    if ((def.audience === 'CLUB') !== (audience === 'CLUB')) continue;
    values[key as EntitlementKey] = def.fallback;
  }
  for (const e of plan?.entitlements ?? []) {
    const def = ENTITLEMENTS[e.key as EntitlementKey];
    if (!def) continue;
    values[e.key as EntitlementKey] = def.kind === 'limit' ? (e.intLimit ?? def.fallback) : (e.boolValue ?? def.fallback);
  }
  const result = { planCode: plan?.code ?? null, planName: plan?.name ?? null, status: usable ? sub!.status : 'FREE', values };
  await redis.set(cacheKey(subject), JSON.stringify(result), 'EX', 60).catch(() => undefined);
  return result;
}

export async function invalidateEntitlements(subject: Subject) {
  await redis.del(cacheKey(subject)).catch(() => undefined);
}

/** "Does this club's / user's plan include this feature?" — checked AFTER permission checks. */
export async function requireFeature(subject: Subject, key: EntitlementKey) {
  const { values } = await resolveEntitlements(subject);
  if (values[key] !== true) {
    throw new AppError(402, 'PLAN_UPGRADE_REQUIRED', `Your plan does not include ${ENTITLEMENTS[key].label.toLowerCase()}. Upgrade to unlock it.`, { entitlement: key });
  }
}

/** Throws when creating one more item would exceed a plan limit. Downgrades never delete existing data. */
export async function requireWithinLimit(subject: Subject, key: EntitlementKey, currentCount: number) {
  const { values } = await resolveEntitlements(subject);
  const limit = values[key];
  if (typeof limit === 'number' && currentCount >= limit) {
    throw new AppError(402, 'PLAN_LIMIT_REACHED', `Your plan allows up to ${limit} ${ENTITLEMENTS[key].label.toLowerCase()}. Upgrade to add more.`, { entitlement: key, limit });
  }
}
