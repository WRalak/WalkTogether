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

// Phase 2: roles, ownership, announcements, billing view -------------------------------------
import { announcementSchema, listQuerySchema, roleInputSchema, transferOwnershipSchema, updateAnnouncementSchema, updateRoleSchema } from '@walktogether/validation';
import * as roles from './roles.service';
import * as announcements from '../announcements/announcements.service';

const roleParam = clubParam.extend({ roleId: z.string().uuid() });
const announcementParam = clubParam.extend({ announcementId: z.string().uuid() });

clubsRouter.post('/:clubId/roles', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.status(201).json({ data: await roles.createRole(clubId, authUserId(req), parse(roleInputSchema, req.body), auditCtx(req)) });
});
clubsRouter.patch('/:clubId/roles/:roleId', requireAuth, async (req, res) => {
  const { clubId, roleId } = parse(roleParam, req.params);
  res.json({ data: await roles.updateRole(clubId, roleId, authUserId(req), parse(updateRoleSchema, req.body), auditCtx(req)) });
});
clubsRouter.delete('/:clubId/roles/:roleId', requireAuth, async (req, res) => {
  const { clubId, roleId } = parse(roleParam, req.params);
  await roles.deleteRole(clubId, roleId, authUserId(req), auditCtx(req));
  res.status(204).end();
});
clubsRouter.post('/:clubId/transfer-ownership', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const input = parse(transferOwnershipSchema, req.body);
  res.json({ data: await roles.transferOwnership(clubId, authUserId(req), input.membershipId, input.password, auditCtx(req)) });
});

clubsRouter.get('/:clubId/announcements', optionalAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const { items, nextCursor } = await announcements.listAnnouncements(clubId, req.auth?.userId, parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
clubsRouter.post('/:clubId/announcements', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.status(201).json({ data: await announcements.createAnnouncement(clubId, authUserId(req), parse(announcementSchema, req.body), auditCtx(req)) });
});
clubsRouter.patch('/:clubId/announcements/:announcementId', requireAuth, async (req, res) => {
  const { clubId, announcementId } = parse(announcementParam, req.params);
  res.json({ data: await announcements.updateAnnouncement(clubId, announcementId, authUserId(req), parse(updateAnnouncementSchema, req.body), auditCtx(req)) });
});
clubsRouter.delete('/:clubId/announcements/:announcementId', requireAuth, async (req, res) => {
  const { clubId, announcementId } = parse(announcementParam, req.params);
  await announcements.deleteAnnouncement(clubId, announcementId, authUserId(req), auditCtx(req));
  res.status(204).end();
});

// Phase 4: events, analytics & reports ----------------------------------------------------------
import { createEventSchema, listEventsQuerySchema } from '@walktogether/validation';
import * as events from '../events/events.service';
import * as analytics from './analytics.service';

clubsRouter.post('/:clubId/events', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.status(201).json({ data: await events.createEvent(clubId, authUserId(req), parse(createEventSchema, req.body), auditCtx(req)) });
});
clubsRouter.get('/:clubId/events', optionalAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const { items, nextCursor } = await events.listClubEvents(clubId, req.auth?.userId, parse(listEventsQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
clubsRouter.get('/:clubId/analytics', requireAuth, async (req, res) => {
  res.json({ data: await analytics.clubOverview(parse(clubParam, req.params).clubId, authUserId(req)) });
});
clubsRouter.get('/:clubId/analytics/growth', requireAuth, async (req, res) => {
  res.json({ data: await analytics.clubGrowth(parse(clubParam, req.params).clubId, authUserId(req)) });
});
clubsRouter.get('/:clubId/reports/attendance', requireAuth, async (req, res) => {
  const { from, to } = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
  res.json({ data: await analytics.attendanceReport(parse(clubParam, req.params).clubId, authUserId(req), from, to) });
});
clubsRouter.get('/:clubId/reports/members.csv', requireAuth, async (req, res) => {
  const csv = await analytics.membersCsv(parse(clubParam, req.params).clubId, authUserId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
  res.send(csv);
});

// Phase 5: club community moderation & branding ------------------------------------------------
import { clubBrandingSchema, clubReportResolveSchema, moderateContentSchema, reportListQuerySchema } from '@walktogether/validation';
import * as reportsSvc from '../moderation/reports.service';
import { moderateClubContent } from '../social/posts.service';
import { readyAssetUrl } from '../media/media.service';

clubsRouter.get('/:clubId/reports', requireAuth, async (req, res) => {
  const { items, nextCursor } = await reportsSvc.clubReports(parse(clubParam, req.params).clubId, authUserId(req), parse(reportListQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
clubsRouter.post('/:clubId/reports/:reportId/resolve', requireAuth, async (req, res) => {
  const { clubId, reportId } = parse(clubParam.extend({ reportId: z.string().uuid() }), req.params);
  const { action, note } = parse(clubReportResolveSchema, req.body);
  await reportsSvc.resolveClubReport(clubId, reportId, authUserId(req), action, note, auditCtx(req));
  res.status(204).end();
});
clubsRouter.post('/:clubId/moderation', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const b = parse(moderateContentSchema, req.body);
  await moderateClubContent(clubId, authUserId(req), { type: b.targetType, id: b.targetId }, b.hide, b.reason, auditCtx(req));
  res.status(204).end();
});
clubsRouter.put('/:clubId/branding', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  const b = parse(clubBrandingSchema, req.body);
  const userId = authUserId(req);
  const data: { logoUrl?: string; coverUrl?: string } = {};
  if (b.logoMediaId) data.logoUrl = await readyAssetUrl(userId, b.logoMediaId, ['CLUB_LOGO']);
  if (b.coverMediaId) data.coverUrl = await readyAssetUrl(userId, b.coverMediaId, ['CLUB_COVER']);
  res.json({ data: await clubs.updateClub(clubId, userId, data, auditCtx(req)) });
});

// Phase 6: club challenges -----------------------------------------------------------------------
import { createChallengeSchema } from '@walktogether/validation';
import { createClubChallenge } from '../challenges/challenges.service';

clubsRouter.post('/:clubId/challenges', requireAuth, async (req, res) => {
  const { clubId } = parse(clubParam, req.params);
  res.status(201).json({ data: await createClubChallenge(clubId, authUserId(req), parse(createChallengeSchema, req.body), auditCtx(req)) });
});

// Phase 7: event sponsorship offers ------------------------------------------------------------
import { clubSponsorshipOffers, respondToEventSponsorship } from '../sponsorships/sponsorships.service';

clubsRouter.get('/:clubId/sponsorship-offers', requireAuth, async (req, res) => {
  res.json({ data: await clubSponsorshipOffers(parse(clubParam, req.params).clubId, authUserId(req)) });
});
clubsRouter.post('/:clubId/sponsorship-offers/:eventId', requireAuth, async (req, res) => {
  const { clubId, eventId } = parse(clubParam.extend({ eventId: z.string().uuid() }), req.params);
  const { accept } = parse(z.object({ accept: z.boolean() }).strict(), req.body);
  await respondToEventSponsorship(clubId, eventId, authUserId(req), accept, auditCtx(req));
  res.status(204).end();
});
