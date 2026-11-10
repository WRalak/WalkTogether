import type { ReportTarget } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { conflict, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { canViewActivity } from '../activities/visibility';
import { audit, type AuditContext } from '../audit/audit.service';
import { revokeSessions } from '../auth/auth.service';
import { canSeeClub, loadClubAccess, requireClubPermission } from '../clubs/club-access';
import { canViewPost } from '../social/posts.service';

export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'HATE', 'NUDITY', 'VIOLENCE', 'DANGEROUS', 'MISINFORMATION', 'IMPERSONATION', 'PRIVACY', 'OTHER'] as const;

/** Resolves the target, checks the reporter can actually see it, and finds the owning club (if any). */
async function resolveTarget(type: ReportTarget, id: string, reporterId: string): Promise<{ clubId: string | null; ownerId: string | null }> {
  switch (type) {
    case 'POST': {
      const p = await prisma.post.findUnique({ where: { id }, include: { activity: true } });
      if (!p || !(await canViewPost(p, reporterId))) throw notFound('Content not found');
      return { clubId: p.clubId, ownerId: p.authorId };
    }
    case 'COMMENT': {
      const c = await prisma.comment.findUnique({ where: { id }, include: { post: { include: { activity: true } } } });
      if (!c || c.deletedAt || !(await canViewPost(c.post, reporterId))) throw notFound('Content not found');
      return { clubId: c.post.clubId, ownerId: c.authorId };
    }
    case 'MESSAGE': {
      const m = await prisma.message.findUnique({ where: { id }, include: { conversation: { include: { members: { where: { userId: reporterId } } } } } });
      if (!m || !m.conversation.members.length) throw notFound('Content not found');
      return { clubId: m.conversation.clubId, ownerId: m.senderId };
    }
    case 'ACTIVITY': {
      const a = await prisma.activity.findUnique({ where: { id } });
      if (!a || !(await canViewActivity(a, reporterId))) throw notFound('Content not found');
      return { clubId: null, ownerId: a.userId };
    }
    case 'USER': {
      const u = await prisma.user.findUnique({ where: { id } });
      if (!u || u.status === 'DELETED') throw notFound('User not found');
      return { clubId: null, ownerId: u.id };
    }
    case 'CLUB': {
      const access = await loadClubAccess(id, reporterId);
      if (!canSeeClub(access)) throw notFound('Club not found');
      return { clubId: null, ownerId: access.club.ownerId };
    }
  }
}

export async function fileReport(reporterId: string, input: { targetType: ReportTarget; targetId: string; reason: string; details?: string }) {
  const { clubId } = await resolveTarget(input.targetType, input.targetId, reporterId);
  const recent = await prisma.contentReport.count({ where: { reporterId, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 20) throw conflict('You have filed many reports recently. Please try again later.', 'REPORT_LIMIT');
  try {
    const r = await prisma.contentReport.create({ data: { reporterId, ...input, clubId } });
    return { id: r.id, status: r.status };
  } catch {
    throw conflict('You have already reported this', 'ALREADY_REPORTED');
  }
}

async function hideTarget(type: ReportTarget, id: string, reason: string) {
  const now = new Date();
  if (type === 'POST') await prisma.post.updateMany({ where: { id }, data: { hiddenAt: now, hiddenReason: reason } });
  if (type === 'COMMENT') await prisma.comment.updateMany({ where: { id }, data: { hiddenAt: now } });
  if (type === 'MESSAGE') await prisma.message.updateMany({ where: { id }, data: { hiddenAt: now } });
  if (type === 'ACTIVITY') await prisma.activity.updateMany({ where: { id }, data: { visibility: 'PRIVATE' } });
}

async function listReports(where: object, q: { cursor?: string; limit: number }) {
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.contentReport.findMany({
    where: { ...where, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    include: { reporter: { select: { id: true, username: true } } },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  // Attach a short preview so moderators can decide without hunting for content.
  const withPreview = await Promise.all(
    items.map(async (r) => {
      let preview: string | null = null;
      if (r.targetType === 'POST') preview = (await prisma.post.findUnique({ where: { id: r.targetId }, select: { body: true } }))?.body ?? null;
      if (r.targetType === 'COMMENT') preview = (await prisma.comment.findUnique({ where: { id: r.targetId }, select: { body: true } }))?.body ?? null;
      if (r.targetType === 'MESSAGE') preview = (await prisma.message.findUnique({ where: { id: r.targetId }, select: { body: true } }))?.body ?? null;
      return { ...r, preview: preview?.slice(0, 300) ?? null };
    }),
  );
  const last = items[items.length - 1];
  return { items: withPreview, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function clubReports(clubId: string, actorId: string, q: { cursor?: string; limit: number; status?: 'OPEN' | 'ACTIONED' | 'DISMISSED' }) {
  await requireClubPermission(clubId, actorId, 'community.moderate', { allowInactiveClub: true });
  return listReports({ clubId, status: q.status ?? 'OPEN' }, q);
}

export async function resolveClubReport(clubId: string, reportId: string, actorId: string, action: 'DISMISS' | 'HIDE', note: string | undefined, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'community.moderate');
  const r = await prisma.contentReport.findFirst({ where: { id: reportId, clubId } });
  if (!r) throw notFound('Report not found');
  if (r.status !== 'OPEN') throw conflict('Report already resolved', 'ALREADY_RESOLVED');
  if (action === 'HIDE') await hideTarget(r.targetType, r.targetId, note ?? 'Hidden by club moderators');
  await prisma.contentReport.update({ where: { id: r.id }, data: { status: action === 'HIDE' ? 'ACTIONED' : 'DISMISSED', resolution: note, reviewedBy: actorId, reviewedAt: new Date() } });
  await audit({ actorType: 'USER', actorId, action: `moderation.report_${action.toLowerCase()}`, targetType: 'report', targetId: r.id, clubId, metadata: { target: `${r.targetType}:${r.targetId}` } }, ctx);
}

export async function platformReports(q: { cursor?: string; limit: number; status?: 'OPEN' | 'ACTIONED' | 'DISMISSED' }) {
  return listReports({ status: q.status ?? 'OPEN' }, q);
}

export async function resolvePlatformReport(adminId: string, reportId: string, action: 'DISMISS' | 'HIDE_CONTENT' | 'SUSPEND_USER', note: string, ctx: AuditContext) {
  const r = await prisma.contentReport.findUnique({ where: { id: reportId } });
  if (!r) throw notFound('Report not found');
  if (r.status !== 'OPEN') throw conflict('Report already resolved', 'ALREADY_RESOLVED');
  if (action === 'HIDE_CONTENT') await hideTarget(r.targetType, r.targetId, note);
  if (action === 'SUSPEND_USER') {
    const { ownerId } = await resolveTargetAsAdmin(r.targetType, r.targetId);
    if (ownerId) {
      await prisma.user.update({ where: { id: ownerId }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: note } });
      await revokeSessions({ userId: ownerId }, 'account_suspended');
      await hideTarget(r.targetType, r.targetId, note);
    }
  }
  // Resolve all open reports for the same target together.
  await prisma.contentReport.updateMany({ where: { targetType: r.targetType, targetId: r.targetId, status: 'OPEN' }, data: { status: action === 'DISMISS' ? 'DISMISSED' : 'ACTIONED', resolution: note, reviewedBy: adminId, reviewedAt: new Date() } });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: `admin.report_${action.toLowerCase()}`, targetType: 'report', targetId: r.id, metadata: { target: `${r.targetType}:${r.targetId}`, note } }, ctx);
}

async function resolveTargetAsAdmin(type: ReportTarget, id: string) {
  if (type === 'POST') return { ownerId: (await prisma.post.findUnique({ where: { id } }))?.authorId ?? null };
  if (type === 'COMMENT') return { ownerId: (await prisma.comment.findUnique({ where: { id } }))?.authorId ?? null };
  if (type === 'MESSAGE') return { ownerId: (await prisma.message.findUnique({ where: { id } }))?.senderId ?? null };
  if (type === 'ACTIVITY') return { ownerId: (await prisma.activity.findUnique({ where: { id } }))?.userId ?? null };
  if (type === 'USER') return { ownerId: id };
  return { ownerId: null };
}
