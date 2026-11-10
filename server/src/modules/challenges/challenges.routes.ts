import { Router } from 'express';
import { z } from 'zod';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import { prisma } from '../../database/prisma';
import { notFound } from '../../shared/errors';
import * as svc from './challenges.service';
import * as lb from './leaderboards.service';
import { listAchievements } from './achievements.service';

const idParam = z.object({ id: z.string().uuid() });
export const challengesRouter = Router();

challengesRouter.get('/', optionalAuth, async (req, res) => {
  const q = parse(z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), mine: z.coerce.boolean().default(false) }), req.query);
  const { items, nextCursor } = await svc.listChallenges(req.auth?.userId, { ...q, mine: q.mine && !!req.auth });
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
challengesRouter.get('/:id', optionalAuth, async (req, res) => {
  res.json({ data: await svc.getChallenge(parse(idParam, req.params).id, req.auth?.userId) });
});
challengesRouter.post('/:id/join', requireAuth, async (req, res) => {
  const body = parse(z.object({ teamClubId: z.string().uuid().optional(), hideFromLeaderboard: z.boolean().optional(), acceptTerms: z.boolean().optional() }).strict(), req.body);
  res.json({ data: await svc.joinChallenge(parse(idParam, req.params).id, authUserId(req), body) });
});
challengesRouter.post('/:id/leave', requireAuth, async (req, res) => {
  await svc.leaveChallenge(parse(idParam, req.params).id, authUserId(req));
  res.status(204).end();
});
challengesRouter.get('/:id/leaderboard', optionalAuth, async (req, res) => {
  res.json({ data: await svc.challengeLeaderboard(parse(idParam, req.params).id, req.auth?.userId) });
});
challengesRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  await svc.cancelChallenge(parse(idParam, req.params).id, { userId: authUserId(req) }, auditCtx(req));
  res.status(204).end();
});

export const leaderboardsRouter = Router();
leaderboardsRouter.get('/', optionalAuth, async (req, res) => {
  const q = parse(z.object({ scope: z.enum(['GLOBAL', 'CLUB']).default('GLOBAL'), clubId: z.string().uuid().optional(), period: z.enum(['WEEK', 'MONTH']).default('WEEK'), activityType: z.enum(['WALK', 'RUN']).optional() }), req.query);
  res.json({ data: await lb.getLeaderboard(q, req.auth?.userId) });
});
leaderboardsRouter.get('/following', requireAuth, async (req, res) => {
  const { period } = parse(z.object({ period: z.enum(['WEEK', 'MONTH']).default('WEEK') }), req.query);
  res.json({ data: await lb.followingLeaderboard(authUserId(req), period) });
});

export const achievementsRouter = Router();
achievementsRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await listAchievements(authUserId(req)) });
});
achievementsRouter.get('/users/:id', optionalAuth, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId: id } });
  if (!privacy || (req.auth?.userId !== id && (privacy.profileVisibility !== 'PUBLIC' || !privacy.showStats))) throw notFound('Not available');
  res.json({ data: (await listAchievements(id)).filter((a) => a.earnedAt) });
});
