import { Router } from 'express';
import { z } from 'zod';
import { listQuerySchema, sendMessageSchema } from '@walktogether/validation';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import * as svc from './messaging.service';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);
const idParam = z.object({ id: z.string().uuid() });

conversationsRouter.get('/', async (req, res) => {
  res.json({ data: await svc.listConversations(authUserId(req)) });
});
conversationsRouter.post('/direct', async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string().uuid() }).strict(), req.body);
  res.json({ data: await svc.directConversation(authUserId(req), userId) });
});
conversationsRouter.post('/club/:id', async (req, res) => {
  res.json({ data: await svc.clubConversation(parse(idParam, req.params).id, authUserId(req)) });
});
conversationsRouter.post('/event/:id', async (req, res) => {
  res.json({ data: await svc.eventConversation(parse(idParam, req.params).id, authUserId(req)) });
});
conversationsRouter.get('/:id', async (req, res) => {
  res.json({ data: await svc.getConversation(parse(idParam, req.params).id, authUserId(req)) });
});
conversationsRouter.get('/:id/messages', async (req, res) => {
  const { items, nextCursor } = await svc.listMessages(parse(idParam, req.params).id, authUserId(req), parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
conversationsRouter.post('/:id/messages', async (req, res) => {
  const { body, clientId } = parse(sendMessageSchema, req.body);
  res.status(201).json({ data: await svc.sendMessage(parse(idParam, req.params).id, authUserId(req), body, clientId) });
});
conversationsRouter.post('/:id/read', async (req, res) => {
  res.json({ data: await svc.markRead(parse(idParam, req.params).id, authUserId(req)) });
});
conversationsRouter.post('/:id/mute', async (req, res) => {
  const { muted } = parse(z.object({ muted: z.boolean() }).strict(), req.body);
  await svc.setMuted(parse(idParam, req.params).id, authUserId(req), muted);
  res.status(204).end();
});
conversationsRouter.delete('/messages/:id', async (req, res) => {
  await svc.deleteMessage(parse(idParam, req.params).id, authUserId(req));
  res.status(204).end();
});
