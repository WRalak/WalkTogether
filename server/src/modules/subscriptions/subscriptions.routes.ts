import { Router } from 'express';
import { z } from 'zod';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import * as svc from './subscriptions.service';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/plans', async (req, res) => {
  const { audience } = parse(z.object({ audience: z.enum(['CLUB', 'INDIVIDUAL']).optional() }), req.query);
  res.json({ data: await svc.listPlans(audience) });
});
subscriptionsRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await svc.getMySubscription(authUserId(req)) });
});
subscriptionsRouter.post('/me/cancel', requireAuth, async (req, res) => {
  res.json({ data: await svc.cancelSubscription({ userId: authUserId(req) }, authUserId(req), auditCtx(req)) });
});
subscriptionsRouter.get('/clubs/:clubId', requireAuth, async (req, res) => {
  const { clubId } = parse(z.object({ clubId: z.string().uuid() }), req.params);
  res.json({ data: await svc.getClubBilling(clubId, authUserId(req)) });
});
subscriptionsRouter.post('/clubs/:clubId/cancel', requireAuth, async (req, res) => {
  const { clubId } = parse(z.object({ clubId: z.string().uuid() }), req.params);
  res.json({ data: await svc.cancelSubscription({ clubId }, authUserId(req), auditCtx(req)) });
});
