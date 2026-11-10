import { Router } from 'express';
import { z } from 'zod';
import {
  assignRoleSchema,
  createClubSchema,
  createInvitationSchema,
  joinClubSchema,
  listClubsQuerySchema,
  listMembersQuerySchema,
  memberModerationSchema,
  reviewMembershipSchema,
  updateClubSchema,
} from '@walktogether/validation';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import * as clubs from './clubs.service';
import * as memberships from '../memberships/memberships.service';

export const clubsRouter = Router();

const clubParam = z.object({ clubId: z.string().uuid() });
const memberParam = clubParam.extend({ membershipId: z.string().uuid() });
const invitationParam = clubParam.extend({ invitationId: z.string().uuid() });

clubsRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json({ data: await clubs.createClub(authUserId(req), parse(createClubSchema, req.body), auditCtx(req)) });
});

clubsRouter.get('/', optionalAuth, async (req, res) => {
  const { items, nextCursor } = await clubs.listClubs(parse(listClubsQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

clubsRouter.get('/invitations/:code', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(6).max(64) }), req.params);
  res.json({ data: await memberships.previewInvitation(code) });
});

// Slug lookup for public pages. UUIDs are routed to the id handlers below.
clubsRouter.get('/:slugOrId', optionalAuth, async (req, res) => {
  const { slugOrId } = parse(z.object({ slugOrId: z.string().min(1).max(60) }), req.params);
  if (z.string().uuid().safeParse(slugOrId).success) {
    res.json({ data: await clubs.getClubDetail(slugOrId, req.auth?.userId) });
    return;
  }
  res.json({ data: await clubs.getClubBySlug(slugOrId, req.auth?.userId) });
});

clubsRouter.patch('/:clubId', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.json({ data: await clubs.updateClub(clubId, authUserId(req), parse(updateClubSchema, req.body), auditCtx(req)) });
});

clubsRouter.post('/:clubId/join', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const result = await memberships.joinClub(clubId, authUserId(req), parse(joinClubSchema, req.body), auditCtx(req));
  res.status(result.status === 'ACTIVE' ? 201 : 202).json({ data: result });
});

clubsRouter.post('/:clubId/leave', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  await memberships.leaveClub(clubId, authUserId(req), auditCtx(req));
  res.status(204).end();
});

clubsRouter.get('/:clubId/members', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const { items, nextCursor } = await memberships.listMembers(clubId, authUserId(req), parse(listMembersQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

clubsRouter.post('/:clubId/members/:membershipId/review', requireAuth, async (req, res) => {
  const { clubId, membershipId } = parse(memberParam, req.params);
  const input = parse(reviewMembershipSchema, req.body);
  res.json({ data: await memberships.reviewMembership(clubId, membershipId, authUserId(req), input.decision, input.reason, auditCtx(req)) });
});

clubsRouter.put('/:clubId/members/:membershipId/role', requireAuth, async (req, res) => {
  const { clubId, membershipId } = parse(memberParam, req.params);
  const { roleId } = parse(assignRoleSchema, req.body);
  res.json({ data: await memberships.assignRole(clubId, membershipId, authUserId(req), roleId, auditCtx(req)) });
});

clubsRouter.post('/:clubId/members/:membershipId/moderation', requireAuth, async (req, res) => {
  const { clubId, membershipId } = parse(memberParam, req.params);
  const input = parse(memberModerationSchema, req.body);
  res.json({ data: await memberships.moderateMember(clubId, membershipId, authUserId(req), input.action, input.reason, auditCtx(req)) });
});

clubsRouter.get('/:clubId/roles', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.json({ data: await clubs.listRoles(clubId, authUserId(req)) });
});

clubsRouter.post('/:clubId/invitations', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.status(201).json({ data: await memberships.createInvitation(clubId, authUserId(req), parse(createInvitationSchema, req.body), auditCtx(req)) });
});

clubsRouter.get('/:clubId/invitations', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.json({ data: await memberships.listInvitations(clubId, authUserId(req)) });
});

clubsRouter.delete('/:clubId/invitations/:invitationId', requireAuth, async (req, res) => {
  const { clubId, invitationId } = parse(invitationParam, req.params);
  await memberships.revokeInvitation(clubId, invitationId, authUserId(req), auditCtx(req));
  res.status(204).end();
});
