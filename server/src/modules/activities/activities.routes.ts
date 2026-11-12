import { Router } from 'express';
import { z } from 'zod';
import {
  stepsSyncSchema,
  completeActivitySchema,
  createActivitySchema,
  goalSchema,
  gpsBatchSchema,
  listActivitiesQuerySchema,
  statsQuerySchema,
  updateActivitySchema,
} from '@walktogether/validation';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import { requireFeature } from '../subscriptions/entitlements.service';
import * as svc from './activities.service';
import * as stats from './stats.service';
import { syncSteps } from './steps.service';

export const activitiesRouter = Router();
const idParam = z.object({ id: z.string().uuid() });

// Basic tracking & history: always free, never gated by any plan.
activitiesRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json({ data: await svc.createActivity(authUserId(req), parse(createActivitySchema, req.body)) });
});
activitiesRouter.get('/', requireAuth, async (req, res) => {
  const { items, nextCursor } = await svc.listMyActivities(authUserId(req), parse(listActivitiesQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
activitiesRouter.get('/stats', requireAuth, async (req, res) => {
  res.json({ data: await stats.myStats(authUserId(req), parse(statsQuerySchema, req.query)) });
});
activitiesRouter.get('/stats/trends', requireAuth, async (req, res) => {
  await requireFeature({ userId: authUserId(req) }, 'user.advanced_analytics');
  const { type } = parse(statsQuerySchema, req.query);
  res.json({ data: await stats.advancedTrends(authUserId(req), type) });
});
activitiesRouter.post('/steps', requireAuth, async (req, res) => {
  const { source, days } = parse(stepsSyncSchema, req.body);
  res.json({ data: await syncSteps(authUserId(req), source, days) });
});
activitiesRouter.get('/goals', requireAuth, async (req, res) => {
  res.json({ data: await stats.goalProgress(authUserId(req)) });
});
activitiesRouter.post('/goals', requireAuth, async (req, res) => {
  res.status(201).json({ data: await stats.createGoal(authUserId(req), parse(goalSchema, req.body)) });
});
activitiesRouter.delete('/goals/:id', requireAuth, async (req, res) => {
  await stats.deleteGoal(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});
activitiesRouter.get('/:id', optionalAuth, async (req, res) => {
  res.json({ data: await svc.getActivity(parse(idParam, req.params).id, req.auth?.userId) });
});
activitiesRouter.post('/:id/gps-points', requireAuth, async (req, res) => {
  res.json({ data: await svc.addPoints(authUserId(req), parse(idParam, req.params).id, parse(gpsBatchSchema, req.body).points) });
});
activitiesRouter.post('/:id/complete', requireAuth, async (req, res) => {
  res.json({ data: await svc.completeActivity(authUserId(req), parse(idParam, req.params).id, parse(completeActivitySchema, req.body)) });
});
activitiesRouter.post('/:id/discard', requireAuth, async (req, res) => {
  await svc.discardActivity(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});
activitiesRouter.patch('/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.updateActivity(authUserId(req), parse(idParam, req.params).id, parse(updateActivitySchema, req.body)) });
});
activitiesRouter.delete('/:id', requireAuth, async (req, res) => {
  await svc.deleteActivity(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});
activitiesRouter.get('/:id/export.gpx', requireAuth, async (req, res) => {
  await requireFeature({ userId: authUserId(req) }, 'user.activity_exports');
  const gpx = await svc.exportGpx(authUserId(req), parse(idParam, req.params).id);
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', 'attachment; filename="activity.gpx"');
  res.send(gpx);
});
