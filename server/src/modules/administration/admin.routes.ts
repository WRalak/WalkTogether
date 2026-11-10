import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  adminAuditQuerySchema,
  adminListClubsQuerySchema,
  adminListUsersQuerySchema,
  adminLoginSchema,
  adminMfaSetupSchema,
  adminMfaVerifySchema,
  adminStatusChangeSchema,
} from '@walktogether/validation';
import { cookieSecure, env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { requireAdmin, requireAdminPermission } from '../../middleware/admin-auth';
import { auditCtx } from '../../middleware/request-context';
import { adminAuthLimiter } from '../../middleware/rate-limit';
import { parse } from '../../middleware/validate';
import { badRequest, unauthorized } from '../../shared/errors';
import * as adminAuth from './admin-auth.service';
import * as admin from './admin.service';
import { audit } from '../audit/audit.service';
import { planInputSchema, updatePlanSchema } from '@walktogether/validation';
import * as subs from '../subscriptions/subscriptions.service';

export const ADMIN_REFRESH_COOKIE = 'wt_art';
const cookieOpts = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'strict',
  path: '/api/v1/platform-admin/auth',
  domain: env.COOKIE_DOMAIN,
  expires,
});
const isWeb = (req: Request) => req.header('x-wt-client') === 'web';

function sendAdminTokens(req: Request, res: Response, tokens: adminAuth.AdminTokens) {
  if (isWeb(req)) {
    res.cookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, cookieOpts(new Date(tokens.refreshTokenExpiresAt)));
    const { refreshToken: _r, ...rest } = tokens;
    res.json({ data: rest });
    return;
  }
  res.json({ data: tokens });
}

export const adminRouter = Router();
const idParam = z.object({ id: z.string().uuid() });

// Authentication ------------------------------------------------------------

adminRouter.post('/auth/login', adminAuthLimiter, async (req, res) => {
  const { email, password } = parse(adminLoginSchema, req.body);
  res.json({ data: await adminAuth.adminLogin(email, password, auditCtx(req)) });
});

adminRouter.post('/auth/mfa/setup', adminAuthLimiter, async (req, res) => {
  const { mfaToken } = parse(adminMfaSetupSchema, req.body);
  res.json({ data: await adminAuth.adminMfaSetup(mfaToken) });
});

adminRouter.post('/auth/mfa/verify', adminAuthLimiter, async (req, res) => {
  const { mfaToken, code } = parse(adminMfaVerifySchema, req.body);
  sendAdminTokens(req, res, await adminAuth.adminMfaVerify(mfaToken, code, auditCtx(req)));
});

adminRouter.post('/auth/refresh', adminAuthLimiter, async (req, res) => {
  const body = parse(z.object({ refreshToken: z.string().min(20).max(512).optional() }).strict(), req.body);
  const token = body.refreshToken ?? (isWeb(req) ? req.cookies?.[ADMIN_REFRESH_COOKIE] : undefined);
  if (!token) throw unauthorized('Refresh token required', 'INVALID_REFRESH_TOKEN');
  sendAdminTokens(req, res, await adminAuth.adminRefresh(token, auditCtx(req)));
});

adminRouter.post('/auth/logout', requireAdmin, async (req, res) => {
  await adminAuth.adminLogout(req.admin!.sessionId, req.admin!.adminId, auditCtx(req));
  res.clearCookie(ADMIN_REFRESH_COOKIE, cookieOpts());
  res.status(204).end();
});

// Everything below requires an authenticated, MFA-verified admin session.
adminRouter.use(requireAdmin);

adminRouter.get('/me', async (req, res) => {
  const me = await prisma.adminUser.findUniqueOrThrow({
    where: { id: req.admin!.adminId },
    select: { id: true, email: true, displayName: true, lastLoginAt: true, role: { select: { key: true, name: true } } },
  });
  res.json({ data: { ...me, permissions: [...req.admin!.permissions] } });
});

adminRouter.get('/overview', requireAdminPermission('platform.overview.view'), async (_req, res) => {
  res.json({ data: await admin.platformOverview() });
});

adminRouter.get('/users', requireAdminPermission('users.view'), async (req, res) => {
  const { items, nextCursor } = await admin.listUsers(parse(adminListUsersQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

adminRouter.get('/users/:id', requireAdminPermission('users.view'), async (req, res) => {
  res.json({ data: await admin.getUser(parse(idParam, req.params).id) });
});

adminRouter.post('/users/:id/status', requireAdminPermission('users.suspend'), async (req, res) => {
  const { action, reason } = parse(adminStatusChangeSchema, req.body);
  res.json({ data: await admin.changeUserStatus(req.admin!.adminId, parse(idParam, req.params).id, action, reason, auditCtx(req)) });
});

adminRouter.get('/clubs', requireAdminPermission('clubs.view'), async (req, res) => {
  const { items, nextCursor } = await admin.listClubs(parse(adminListClubsQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

adminRouter.get('/clubs/:id', requireAdminPermission('clubs.view'), async (req, res) => {
  res.json({ data: await admin.getClub(parse(idParam, req.params).id) });
});

adminRouter.post('/clubs/:id/status', requireAdminPermission('clubs.suspend'), async (req, res) => {
  const { action, reason } = parse(adminStatusChangeSchema, req.body);
  res.json({ data: await admin.changeClubStatus(req.admin!.adminId, parse(idParam, req.params).id, action, reason, auditCtx(req)) });
});

adminRouter.post('/clubs/:id/approve', requireAdminPermission('clubs.approve'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).default('Approved') }).strict(), req.body);
  res.json({ data: await admin.changeClubStatus(req.admin!.adminId, parse(idParam, req.params).id, 'APPROVE', reason, auditCtx(req)) });
});

adminRouter.get('/audit-logs', requireAdminPermission('audit_logs.view'), async (req, res) => {
  const { items, nextCursor } = await admin.listAuditLogs(parse(adminAuditQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

const keyParam = z.object({ key: z.string().regex(/^[a-z0-9_.-]{2,100}$/i) });

adminRouter.get('/settings', requireAdminPermission('settings.manage'), async (_req, res) => {
  res.json({ data: await admin.listSettings() });
});

adminRouter.put('/settings/:key', requireAdminPermission('settings.manage'), async (req, res) => {
  const { key } = parse(keyParam, req.params);
  const body = parse(z.object({ value: z.any().refine((v) => v !== undefined, 'value is required'), description: z.string().max(255).optional() }).strict(), req.body);
  res.json({ data: await admin.upsertSetting(req.admin!.adminId, key, body.value, body.description, auditCtx(req)) });
});

adminRouter.get('/feature-flags', requireAdminPermission('feature_flags.manage'), async (_req, res) => {
  res.json({ data: await admin.listFeatureFlags() });
});

adminRouter.put('/feature-flags/:key', requireAdminPermission('feature_flags.manage'), async (req, res) => {
  const { key } = parse(keyParam, req.params);
  const body = parse(
    z.object({ enabled: z.boolean(), rolloutPercentage: z.number().int().min(0).max(100).default(100), description: z.string().max(255).optional() }).strict(),
    req.body,
  );
  res.json({ data: await admin.upsertFeatureFlag(req.admin!.adminId, key, body, auditCtx(req)) });
});

// Subscription plans (prices, trials and entitlements are configured here, never in code) -----
adminRouter.get('/plans', requireAdminPermission('plans.manage'), async (_req, res) => {
  res.json({ data: await subs.adminListPlans() });
});
adminRouter.post('/plans', requireAdminPermission('plans.manage'), async (req, res) => {
  res.status(201).json({ data: await subs.adminUpsertPlan(req.admin!.adminId, null, parse(planInputSchema, req.body), auditCtx(req)) });
});
adminRouter.patch('/plans/:id', requireAdminPermission('plans.manage'), async (req, res) => {
  res.json({ data: await subs.adminUpsertPlan(req.admin!.adminId, parse(idParam, req.params).id, parse(updatePlanSchema, req.body), auditCtx(req)) });
});
adminRouter.post('/subscriptions/grant', requireAdminPermission('plans.manage'), async (req, res) => {
  const body = parse(z.object({ planId: z.string().uuid(), clubId: z.string().uuid().optional(), userId: z.string().uuid().optional() }).strict().refine((b) => !!b.clubId !== !!b.userId, 'Provide exactly one of clubId or userId'), req.body);
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: body.planId } });
  if ((plan.audience === 'CLUB') !== !!body.clubId) throw badRequest('Plan audience does not match subject');
  res.status(201).json({ data: await subs.adminGrantPlan(req.admin!.adminId, body.clubId ? { clubId: body.clubId } : { userId: body.userId! }, body.planId, auditCtx(req)) });
});

// Moderation queue ---------------------------------------------------------------------------
import { adminReportResolveSchema, reportListQuerySchema } from '@walktogether/validation';
import * as reports from '../moderation/reports.service';

adminRouter.get('/reports', requireAdminPermission('moderation.manage'), async (req, res) => {
  const { items, nextCursor } = await reports.platformReports(parse(reportListQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
adminRouter.post('/reports/:id/resolve', requireAdminPermission('moderation.manage'), async (req, res) => {
  const { action, note } = parse(adminReportResolveSchema, req.body);
  await reports.resolvePlatformReport(req.admin!.adminId, parse(idParam, req.params).id, action, note, auditCtx(req));
  res.status(204).end();
});

// Platform challenges & achievement definitions ------------------------------------------------
import { achievementDefinitionSchema, adminChallengeSchema } from '@walktogether/validation';
import { cancelChallenge, createPlatformChallenge } from '../challenges/challenges.service';
import { achievementRuleSchema } from '../challenges/achievements.service';

adminRouter.post('/challenges', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  res.status(201).json({ data: await createPlatformChallenge(req.admin!.adminId, parse(adminChallengeSchema, req.body), auditCtx(req)) });
});
adminRouter.get('/challenges', requireAdminPermission('platform.overview.view'), async (_req, res) => {
  res.json({ data: await prisma.challenge.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { participants: true } }, club: { select: { name: true } } } }) });
});
adminRouter.post('/challenges/:id/cancel', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  await cancelChallenge(parse(idParam, req.params).id, { adminId: req.admin!.adminId }, auditCtx(req));
  res.status(204).end();
});
adminRouter.get('/achievements', requireAdminPermission('settings.manage'), async (_req, res) => {
  res.json({ data: await prisma.fitnessAchievement.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { awards: true } } } }) });
});
adminRouter.put('/achievements/:code', requireAdminPermission('settings.manage'), async (req, res) => {
  const body = parse(achievementDefinitionSchema, { ...req.body, code: req.params.code });
  const rule = achievementRuleSchema.parse(body.rule);
  const row = await prisma.fitnessAchievement.upsert({ where: { code: body.code }, create: { ...body, rule }, update: { ...body, rule } });
  await audit({ actorType: 'ADMIN', actorId: req.admin!.adminId, action: 'admin.achievement_saved', targetType: 'achievement', targetId: row.id, metadata: { code: body.code } }, auditCtx(req));
  res.json({ data: row });
});

// Monetization: payments, refunds, promotions, sponsors, campaigns, revenue -------------------
import { promotionSchema } from '@walktogether/validation';
import { refundPayment } from '../payments/payments.service';
import { awardRewards, campaignReport, reviewCampaign } from '../sponsorships/sponsorships.service';
import { revenueOverview } from './revenue.service';

adminRouter.get('/revenue', requireAdminPermission('billing.view'), async (_req, res) => {
  res.json({ data: await revenueOverview() });
});
adminRouter.get('/payments', requireAdminPermission('billing.view'), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional() }), req.query);
  res.json({ data: await prisma.payment.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { invoice: { select: { number: true } }, payer: { select: { username: true } } } }) });
});
adminRouter.post('/payments/:id/refund', requireAdminPermission('plans.manage'), async (req, res) => {
  const { amountMinor, reason } = parse(z.object({ amountMinor: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }).strict(), req.body);
  res.json({ data: await refundPayment(req.admin!.adminId, parse(idParam, req.params).id, amountMinor, reason, auditCtx(req)) });
});
adminRouter.get('/promotions', requireAdminPermission('plans.manage'), async (_req, res) => {
  res.json({ data: await prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } }) });
});
adminRouter.put('/promotions/:code', requireAdminPermission('plans.manage'), async (req, res) => {
  const body = parse(promotionSchema, { ...req.body, code: req.params.code });
  const row = await prisma.promotion.upsert({ where: { code: body.code }, create: body, update: body });
  await audit({ actorType: 'ADMIN', actorId: req.admin!.adminId, action: 'admin.promotion_saved', targetType: 'promotion', targetId: row.id, metadata: { code: row.code } }, auditCtx(req));
  res.json({ data: row });
});
adminRouter.get('/sponsors', requireAdminPermission('sponsorships.manage'), async (_req, res) => {
  res.json({ data: await prisma.sponsor.findMany({ orderBy: { createdAt: 'desc' }, include: { owner: { select: { username: true } }, _count: { select: { campaigns: true } } } }) });
});
adminRouter.post('/sponsors/:id/status', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict(), req.body);
  const row = await prisma.sponsor.update({ where: { id: parse(idParam, req.params).id }, data: { status } });
  await audit({ actorType: 'ADMIN', actorId: req.admin!.adminId, action: 'admin.sponsor_status', targetType: 'sponsor', targetId: row.id, metadata: { status } }, auditCtx(req));
  res.json({ data: row });
});
adminRouter.get('/campaigns', requireAdminPermission('sponsorships.manage'), async (_req, res) => {
  res.json({ data: await prisma.sponsoredCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { sponsor: { select: { name: true } }, _count: { select: { events: true, rewards: true } } } }) });
});
adminRouter.post('/campaigns/:id/review', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  const { decision, note } = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().min(3).max(500) }).strict(), req.body);
  await reviewCampaign(req.admin!.adminId, parse(idParam, req.params).id, decision, note, auditCtx(req));
  res.status(204).end();
});
adminRouter.get('/campaigns/:id/report', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  res.json({ data: await campaignReport(parse(idParam, req.params).id, { admin: true }) });
});
adminRouter.post('/campaigns/:id/rewards', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  const { topN, description } = parse(z.object({ topN: z.number().int().min(1).max(100), description: z.string().trim().min(3).max(300) }).strict(), req.body);
  res.json({ data: await awardRewards(req.admin!.adminId, parse(idParam, req.params).id, topN, description, auditCtx(req)) });
});
adminRouter.post('/rewards/:id/fulfil', requireAdminPermission('sponsorships.manage'), async (req, res) => {
  const row = await prisma.campaignReward.update({ where: { id: parse(idParam, req.params).id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
  await audit({ actorType: 'ADMIN', actorId: req.admin!.adminId, action: 'admin.reward_fulfilled', targetType: 'reward', targetId: row.id }, auditCtx(req));
  res.json({ data: row });
});
