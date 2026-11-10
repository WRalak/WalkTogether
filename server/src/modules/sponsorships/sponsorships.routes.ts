import { Router } from 'express';
import { z } from 'zod';
import { campaignSchema, sponsorSchema } from '@walktogether/validation';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import * as svc from './sponsorships.service';

const idParam = z.object({ id: z.string().uuid() });
export const sponsorshipsRouter = Router();

sponsorshipsRouter.get('/sponsored', async (_req, res) => {
  res.json({ data: await svc.activeSponsoredContent() });
});
sponsorshipsRouter.post('/sponsors', requireAuth, async (req, res) => {
  res.status(201).json({ data: await svc.applyAsSponsor(authUserId(req), parse(sponsorSchema, req.body), auditCtx(req)) });
});
sponsorshipsRouter.get('/sponsors/mine', requireAuth, async (req, res) => {
  res.json({ data: await svc.mySponsors(authUserId(req)) });
});
sponsorshipsRouter.post('/sponsors/:id/campaigns', requireAuth, async (req, res) => {
  res.status(201).json({ data: await svc.createCampaign(authUserId(req), parse(idParam, req.params).id, parse(campaignSchema, req.body), auditCtx(req)) });
});
sponsorshipsRouter.post('/campaigns/:id/submit', requireAuth, async (req, res) => {
  res.json({ data: await svc.submitCampaign(authUserId(req), parse(idParam, req.params).id) });
});
sponsorshipsRouter.get('/campaigns/:id/report', requireAuth, async (req, res) => {
  res.json({ data: await svc.campaignReport(parse(idParam, req.params).id, { userId: authUserId(req) }) });
});
