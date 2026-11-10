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
