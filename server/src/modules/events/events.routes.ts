import { Router } from 'express';
import { z } from 'zod';
import { cancelEventSchema, checkInSchema, discoverEventsQuerySchema, organizerAttendanceSchema, rsvpSchema, updateEventSchema } from '@walktogether/validation';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import * as svc from './events.service';

export const eventsRouter = Router();
const idParam = z.object({ id: z.string().uuid() });

eventsRouter.get('/', async (req, res) => {
  const { items, nextCursor } = await svc.discoverEvents(parse(discoverEventsQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
eventsRouter.get('/:id', optionalAuth, async (req, res) => {
  res.json({ data: await svc.getEvent(parse(idParam, req.params).id, req.auth?.userId) });
});
eventsRouter.patch('/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.updateEvent(parse(idParam, req.params).id, authUserId(req), parse(updateEventSchema, req.body) as never, auditCtx(req)) });
});
eventsRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const { reason, applyToSeries } = parse(cancelEventSchema, req.body);
  await svc.cancelEvent(parse(idParam, req.params).id, authUserId(req), reason, applyToSeries, auditCtx(req));
  res.status(204).end();
});
eventsRouter.post('/:id/rsvp', requireAuth, async (req, res) => {
  res.json({ data: await svc.rsvp(parse(idParam, req.params).id, authUserId(req), parse(rsvpSchema, req.body).going) });
});
eventsRouter.get('/:id/participants', requireAuth, async (req, res) => {
  res.json({ data: await svc.participants(parse(idParam, req.params).id, authUserId(req)) });
});
eventsRouter.get('/:id/check-in-code', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: await svc.checkInCode(parse(idParam, req.params).id, authUserId(req)) });
});
eventsRouter.post('/:id/check-in', requireAuth, async (req, res) => {
  res.json({ data: await svc.selfCheckIn(parse(idParam, req.params).id, authUserId(req), parse(checkInSchema, req.body)) });
});
eventsRouter.post('/:id/attendance', requireAuth, async (req, res) => {
  const { userId, present } = parse(organizerAttendanceSchema, req.body);
  await svc.organizerAttendance(parse(idParam, req.params).id, authUserId(req), userId, present, auditCtx(req));
  res.status(204).end();
});
eventsRouter.get('/:id/attendance.csv', requireAuth, async (req, res) => {
  // nosemgrep: express_xss -- CSV attachment built by toCsv (RFC 4180 + formula-injection escaping)
  const csv = await svc.attendanceCsv(parse(idParam, req.params).id, authUserId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(csv);
});
