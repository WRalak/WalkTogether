import { Router } from 'express';
import { z } from 'zod';
import { listQuerySchema } from '@walktogether/validation';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import * as svc from './notifications.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const { items, unread, nextCursor } = await svc.listNotifications(authUserId(req), parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length, unread } });
});
notificationsRouter.post('/read-all', async (req, res) => {
  res.json({ data: { updated: await svc.markAllRead(authUserId(req)) } });
});
notificationsRouter.patch('/:id/read', async (req, res) => {
  await svc.markRead(authUserId(req), parse(z.object({ id: z.string().uuid() }), req.params).id);
  res.status(204).end();
});
