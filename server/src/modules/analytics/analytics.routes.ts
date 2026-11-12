import { Router } from 'express';
import { z } from 'zod';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import * as analytics from './club-analytics.service';

/**
 * Club analytics & reports, mounted under /api/v1/clubs. Every handler checks the caller's
 * permission in that club (tenant isolation); platform-wide analytics live in administration routes.
 */
export const clubAnalyticsRouter = Router();
const clubParam = z.object({ clubId: z.string().uuid() });

clubAnalyticsRouter.get('/:clubId/analytics', requireAuth, async (req, res) => {
  res.json({ data: await analytics.clubOverview(parse(clubParam, req.params).clubId, authUserId(req)) });
});
clubAnalyticsRouter.get('/:clubId/analytics/growth', requireAuth, async (req, res) => {
  res.json({ data: await analytics.clubGrowth(parse(clubParam, req.params).clubId, authUserId(req)) });
});
clubAnalyticsRouter.get('/:clubId/activities', requireAuth, async (req, res) => {
  const q = parse(z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
  const { items, nextCursor, lastSevenDays } = await analytics.clubActivities(parse(clubParam, req.params).clubId, authUserId(req), q);
  res.json({ data: items, meta: { nextCursor, limit: items.length, lastSevenDays } });
});
clubAnalyticsRouter.get('/:clubId/reports/attendance', requireAuth, async (req, res) => {
  const { from, to } = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  res.json({ data: await analytics.attendanceReport(parse(clubParam, req.params).clubId, authUserId(req), from, to) });
});
clubAnalyticsRouter.get('/:clubId/reports/members.csv', requireAuth, async (req, res) => {
  // nosemgrep: express_xss -- CSV attachment built by toCsv (RFC 4180 + formula-injection escaping)
  const csv = await analytics.membersCsv(parse(clubParam, req.params).clubId, authUserId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
  res.send(csv);
});
