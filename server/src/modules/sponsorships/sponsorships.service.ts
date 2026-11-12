import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { audit, type AuditContext } from '../audit/audit.service';
import { requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';

export interface SponsorInput {
  name: string;
  slug: string;
  description?: string | null;
  websiteUrl?: string | null;
  contactEmail: string;
  logoUrl?: string | null;
}

export async function applyAsSponsor(userId: string, input: SponsorInput, ctx: AuditContext) {
  if (await prisma.sponsor.findUnique({ where: { slug: input.slug } })) throw conflict('That sponsor URL is taken', 'SLUG_TAKEN');
  const s = await prisma.sponsor.create({ data: { ...input, ownerUserId: userId } });
  await audit({ actorType: 'USER', actorId: userId, action: 'sponsor.applied', targetType: 'sponsor', targetId: s.id }, ctx);
  return s;
}

export async function mySponsors(userId: string) {
  return prisma.sponsor.findMany({ where: { ownerUserId: userId }, include: { campaigns: { orderBy: { createdAt: 'desc' } } } });
}

async function ownSponsor(userId: string, sponsorId: string) {
  const s = await prisma.sponsor.findUnique({ where: { id: sponsorId } });
  if (!s || s.ownerUserId !== userId) throw notFound('Sponsor not found');
  return s;
}

async function ownCampaign(userId: string, campaignId: string) {
  const c = await prisma.sponsoredCampaign.findUnique({ where: { id: campaignId }, include: { sponsor: true, events: true } });
  if (!c || c.sponsor.ownerUserId !== userId) throw notFound('Campaign not found');
  return c;
}

export interface CampaignInput {
  name: string;
  type: 'CHALLENGE' | 'EVENT';
  budgetMinor: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  terms: string;
  eligibility: Record<string, unknown>;
  prizeDescription?: string | null;
  challengeConfig?: {
    title: string;
    description?: string | null;
    metric: 'DISTANCE_M' | 'ACTIVITIES' | 'MOVING_SECONDS' | 'ACTIVE_DAYS';
    activityTypes: ('WALK' | 'RUN' | 'HIKE')[];
    target?: number | null;
    maxDailyDistanceM: number;
  };
  eventIds?: string[];
}

export async function createCampaign(userId: string, sponsorId: string, input: CampaignInput, ctx: AuditContext) {
  const s = await ownSponsor(userId, sponsorId);
  if (s.status !== 'ACTIVE') throw forbidden('Your sponsor profile is awaiting approval', 'SPONSOR_NOT_ACTIVE');
  if (input.endsAt <= input.startsAt) throw badRequest('endsAt must be after startsAt');
  if (input.type === 'CHALLENGE' && !input.challengeConfig) throw badRequest('Challenge campaigns need a challenge configuration');
  if (input.type === 'EVENT') {
    if (!input.eventIds?.length) throw badRequest('Choose at least one public event to sponsor');
    const events = await prisma.event.findMany({
      where: { id: { in: input.eventIds }, visibility: 'PUBLIC', status: 'SCHEDULED', club: { visibility: 'PUBLIC', status: 'ACTIVE' } },
    });
    if (events.length !== new Set(input.eventIds).size) throw badRequest('Only upcoming public events of public clubs can be sponsored');
    const taken = await prisma.sponsoredEvent.count({ where: { eventId: { in: input.eventIds } } });
    if (taken) throw conflict('One of these events already has a sponsor', 'EVENT_ALREADY_SPONSORED');
  }
  const { eventIds, challengeConfig, ...fields } = input;
  const c = await prisma.sponsoredCampaign.create({
    data: {
      ...fields,
      eligibility: fields.eligibility as Prisma.InputJsonValue,
      challengeConfig: (challengeConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      sponsorId,
      events: eventIds?.length ? { create: eventIds.map((eventId) => ({ eventId })) } : undefined,
    },
  });
  await audit({ actorType: 'USER', actorId: userId, action: 'campaign.created', targetType: 'campaign', targetId: c.id }, ctx);
  return c;
}

export async function submitCampaign(userId: string, campaignId: string) {
  const c = await ownCampaign(userId, campaignId);
  if (c.status !== 'DRAFT' && c.status !== 'REJECTED') throw conflict('Campaign was already submitted', 'ALREADY_SUBMITTED');
  return prisma.sponsoredCampaign.update({ where: { id: campaignId }, data: { status: 'PENDING_REVIEW', reviewNote: null } });
}

export async function reviewCampaign(adminId: string, campaignId: string, decision: 'APPROVE' | 'REJECT', note: string, ctx: AuditContext) {
  const c = await prisma.sponsoredCampaign.findUnique({ where: { id: campaignId } });
  if (!c) throw notFound('Campaign not found');
  if (c.status !== 'PENDING_REVIEW') throw conflict('Campaign is not awaiting review', 'NOT_PENDING');
  await prisma.sponsoredCampaign.update({ where: { id: campaignId }, data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewNote: note } });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: `admin.campaign_${decision.toLowerCase()}`, targetType: 'campaign', targetId: campaignId, metadata: { note } }, ctx);
  if (decision === 'APPROVE') await activateCampaign(campaignId);
}

/** Goes live only when BOTH approved by moderators AND paid (verified payment). */
export async function activateCampaign(campaignId: string) {
  const c = await prisma.sponsoredCampaign.findUnique({
    where: { id: campaignId },
    include: { sponsor: true, events: { include: { event: { select: { clubId: true, title: true } } } } },
  });
  if (!c || c.status !== 'APPROVED' || !c.paidAt) return { activated: false };
  await prisma.$transaction(async (tx) => {
    if (c.type === 'CHALLENGE' && !c.challengeId) {
      const cfg = c.challengeConfig as unknown as NonNullable<CampaignInput['challengeConfig']>;
      const ch = await tx.challenge.create({
        data: {
          scope: 'SPONSORED',
          title: cfg.title,
          description: cfg.description ?? null,
          metric: cfg.metric,
          activityTypes: cfg.activityTypes,
          target: cfg.target ?? null,
          maxDailyDistanceM: cfg.maxDailyDistanceM,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          visibility: 'PUBLIC',
          rules: c.terms,
          rewardDescription: c.prizeDescription,
          sponsorName: c.sponsor.name,
          coverUrl: c.sponsor.logoUrl,
        },
      });
      await tx.sponsoredCampaign.update({ where: { id: c.id }, data: { challengeId: ch.id } });
    }
    await tx.sponsoredCampaign.update({ where: { id: c.id }, data: { status: 'ACTIVE' } });
  });
  // Event sponsorships require each club's acceptance.
  for (const se of c.events) {
    const admins = await prisma.clubMembership.findMany({
      where: { clubId: se.event.clubId, status: 'ACTIVE', role: { permissions: { some: { permissionKey: 'events.manage' } } } },
      select: { userId: true },
    });
    await notify({
      userIds: admins.map((a) => a.userId),
      type: 'sponsored.event',
      title: `${c.sponsor.name} wants to sponsor ${se.event.title}`,
      body: 'Review the offer in your club dashboard.',
      data: { eventId: se.eventId },
    });
  }
  return { activated: true };
}

export async function clubSponsorshipOffers(clubId: string, userId: string) {
  await requireClubPermission(clubId, userId, 'events.manage', { allowInactiveClub: true });
  return prisma.sponsoredEvent.findMany({
    where: { event: { clubId }, campaign: { status: 'ACTIVE' } },
    include: {
      event: { select: { id: true, title: true, startsAt: true } },
      campaign: { select: { id: true, name: true, terms: true, prizeDescription: true, sponsor: { select: { name: true, logoUrl: true, websiteUrl: true } } } },
    },
  });
}

export async function respondToEventSponsorship(clubId: string, eventId: string, userId: string, accept: boolean, ctx: AuditContext) {
  await requireClubPermission(clubId, userId, 'events.manage');
  const se = await prisma.sponsoredEvent.findFirst({ where: { eventId, event: { clubId } } });
  if (!se) throw notFound('Offer not found');
  if (accept) await prisma.sponsoredEvent.update({ where: { eventId }, data: { acceptedAt: new Date(), acceptedBy: userId } });
  else await prisma.sponsoredEvent.delete({ where: { eventId } });
  await audit(
    {
      actorType: 'USER',
      actorId: userId,
      action: accept ? 'sponsorship.accepted' : 'sponsorship.declined',
      targetType: 'event',
      targetId: eventId,
      clubId,
      metadata: { campaignId: se.campaignId },
    },
    ctx,
  );
}

/** Public, clearly-labelled sponsored content for discovery. */
export async function activeSponsoredContent() {
  const rows = await prisma.sponsoredCampaign.findMany({
    where: { status: 'ACTIVE', endsAt: { gt: new Date() } },
    orderBy: { startsAt: 'asc' },
    take: 50,
    include: {
      sponsor: { select: { name: true, logoUrl: true, websiteUrl: true } },
      challenge: { select: { id: true, title: true, endsAt: true } },
      events: { where: { acceptedAt: { not: null } }, include: { event: { select: { id: true, title: true, startsAt: true, meetingPoint: true } } } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    label: 'Sponsored',
    name: c.name,
    type: c.type,
    sponsor: c.sponsor,
    prizeDescription: c.prizeDescription,
    terms: c.terms,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    challenge: c.challenge,
    events: c.events.map((e) => e.event),
  }));
}

/** Aggregated, privacy-preserving campaign report (no personal data). */
export async function campaignReport(campaignId: string, viewer: { userId?: string; admin?: boolean }) {
  const c = await prisma.sponsoredCampaign.findUnique({ where: { id: campaignId }, include: { sponsor: true, events: true } });
  if (!c || (!viewer.admin && c.sponsor.ownerUserId !== viewer.userId)) throw notFound('Campaign not found');
  const report: Record<string, unknown> = {
    campaign: {
      id: c.id,
      name: c.name,
      status: c.status,
      type: c.type,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      budgetMinor: c.budgetMinor,
      currency: c.currency,
      paid: !!c.paidAt,
    },
  };
  if (c.challengeId) {
    const [participants, completed, agg, daily] = await Promise.all([
      prisma.challengeParticipant.count({ where: { challengeId: c.challengeId } }),
      prisma.challengeParticipant.count({ where: { challengeId: c.challengeId, completedAt: { not: null } } }),
      prisma.challengeParticipant.aggregate({ where: { challengeId: c.challengeId }, _sum: { progressValue: true } }),
      prisma.$queryRaw<
        { day: Date; active: bigint }[]
      >`SELECT day, count(DISTINCT user_id) AS active FROM challenge_progress WHERE challenge_id = ${c.challengeId}::uuid GROUP BY 1 ORDER BY 1`,
    ]);
    report.challenge = {
      participants,
      completed,
      completionRate: participants ? Math.round((completed / participants) * 100) : 0,
      totalProgress: agg._sum.progressValue ?? 0,
      dailyActiveParticipants: daily.map((d) => ({ day: d.day, active: Number(d.active) })),
    };
  }
  if (c.events.length) {
    const ids = c.events.filter((e) => e.acceptedAt).map((e) => e.eventId);
    const [going, attended] = await Promise.all([
      prisma.eventRegistration.count({ where: { eventId: { in: ids }, status: 'GOING' } }),
      prisma.eventAttendance.count({ where: { eventId: { in: ids } } }),
    ]);
    report.events = { offered: c.events.length, accepted: ids.length, going, attended };
  }
  return report;
}

/** Records prize winners from final standings (only consenting participants). Fulfilment is tracked by platform staff. */
export async function awardRewards(adminId: string, campaignId: string, topN: number, description: string, ctx: AuditContext) {
  const c = await prisma.sponsoredCampaign.findUnique({ where: { id: campaignId } });
  if (!c?.challengeId) throw badRequest('Only challenge campaigns have standings');
  const results = await prisma.challengeResult.findMany({ where: { challengeId: c.challengeId, value: { gt: 0 } }, orderBy: { rank: 'asc' }, take: topN });
  if (!results.length) throw conflict('No final results yet', 'NO_RESULTS');
  const consenting = await prisma.challengeParticipant.findMany({
    where: { challengeId: c.challengeId, userId: { in: results.map((r) => r.userId) }, consentedAt: { not: null } },
    select: { userId: true },
  });
  const ok = new Set(consenting.map((x) => x.userId));
  const winners = results.filter((r) => ok.has(r.userId));
  await prisma.campaignReward.createMany({ data: winners.map((r) => ({ campaignId, userId: r.userId, rank: r.rank, description })), skipDuplicates: true });
  await notify({
    userIds: winners.map((w) => w.userId),
    type: 'challenge.completed',
    title: 'You won a prize! 🎁',
    body: `${description}. The WalkTogether team will contact you to arrange delivery.`,
    data: { challengeId: c.challengeId },
  });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.rewards_awarded', targetType: 'campaign', targetId: campaignId, metadata: { winners: winners.length } }, ctx);
  return prisma.campaignReward.findMany({ where: { campaignId }, orderBy: { rank: 'asc' }, include: { campaign: false } });
}

export async function endFinishedCampaigns() {
  const res = await prisma.sponsoredCampaign.updateMany({ where: { status: 'ACTIVE', endsAt: { lte: new Date() } }, data: { status: 'ENDED' } });
  return { ended: res.count };
}
