import { Router } from 'express';
import { z } from 'zod';
import {
  deleteAccountSchema,
  emailSchema,
  registerDeviceSchema,
  updateMeSchema,
  updateNotificationSettingsSchema,
  updatePrivacySchema,
} from '@walktogether/validation';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import * as users from './users.service';
import { requestAccountDeletion } from './account-deletion';
import { listMyClubs } from '../memberships/memberships.service';

export const usersRouter = Router();
const idParam = z.object({ id: z.string().uuid() });

usersRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await users.getMe(authUserId(req)) });
});

usersRouter.patch('/me', requireAuth, async (req, res) => {
  res.json({ data: await users.updateMe(authUserId(req), parse(updateMeSchema, req.body), auditCtx(req)) });
});

usersRouter.post('/me/email', requireAuth, async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }).strict(), req.body);
  await users.changeEmail(authUserId(req), email, auditCtx(req));
  res.status(202).json({ data: { verificationSent: true } });
});

usersRouter.patch('/me/privacy', requireAuth, async (req, res) => {
  res.json({ data: await users.updatePrivacy(authUserId(req), parse(updatePrivacySchema, req.body)) });
});

usersRouter.get('/me/notification-settings', requireAuth, async (req, res) => {
  res.json({ data: await users.getNotificationSettings(authUserId(req)) });
});

usersRouter.patch('/me/notification-settings', requireAuth, async (req, res) => {
  res.json({ data: await users.updateNotificationSettings(authUserId(req), parse(updateNotificationSettingsSchema, req.body)) });
});

usersRouter.post('/me/devices', requireAuth, async (req, res) => {
  res.status(201).json({ data: await users.registerDevice(authUserId(req), parse(registerDeviceSchema, req.body)) });
});

usersRouter.delete('/me/devices/:id', requireAuth, async (req, res) => {
  await users.removeDevice(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});

usersRouter.get('/me/clubs', requireAuth, async (req, res) => {
  res.json({ data: await listMyClubs(authUserId(req)) });
});

usersRouter.get('/me/blocks', requireAuth, async (req, res) => {
  res.json({ data: await users.listBlocked(authUserId(req)) });
});

usersRouter.get('/me/export', requireAuth, async (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="walktogether-data-export.json"');
  res.json({ data: await users.exportMyData(authUserId(req)) });
});

usersRouter.delete('/me', requireAuth, async (req, res) => {
  const input = parse(deleteAccountSchema, req.body);
  const result = await requestAccountDeletion(authUserId(req), input.password, auditCtx(req));
  res.status(202).json({ data: result });
});

usersRouter.post('/:id/block', requireAuth, async (req, res) => {
  await users.blockUser(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});

usersRouter.delete('/:id/block', requireAuth, async (req, res) => {
  await users.unblockUser(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});

usersRouter.get('/:username', optionalAuth, async (req, res) => {
  const { username } = parse(z.object({ username: z.string().min(1).max(40) }), req.params);
  res.json({ data: await users.getPublicProfile(username, req.auth?.userId) });
});

usersRouter.get('/:id/activities', optionalAuth, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = parse(z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  const { listUserActivities } = await import('../activities/activities.service');
  const { items, nextCursor } = await listUserActivities(id, req.auth?.userId, q);
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
