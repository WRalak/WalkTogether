import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { canSeeClub, loadClubAccess, requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';

const select = { id: true, clubId: true, title: true, body: true, pinned: true, publishedAt: true, updatedAt: true, author: { select: { id: true, username: true, profile: { select: { displayName: true } } } } } as const;

export async function createAnnouncement(clubId: string, actorId: string, input: { title: string; body: string; pinned: boolean; notify: boolean }, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'announcements.manage');
  const a = await prisma.$transaction(async (tx) => {
    const a = await tx.clubAnnouncement.create({ data: { clubId, authorId: actorId, title: input.title, body: input.body, pinned: input.pinned }, select });
    await audit({ actorType: 'USER', actorId, action: 'announcement.created', targetType: 'announcement', targetId: a.id, clubId }, ctx, tx);
    return a;
  });
  if (input.notify) await enqueue('announcement.fanout', { announcementId: a.id });
  return a;
}

/** Fans out an announcement to active members in batches (respecting notification preferences). */
export async function fanOutAnnouncement(announcementId: string) {
  const a = await prisma.clubAnnouncement.findUnique({ where: { id: announcementId }, include: { club: { select: { id: true, name: true, slug: true } } } });
  if (!a || a.deletedAt) return 0;
  let cursor: string | undefined;
  let sent = 0;
  for (;;) {
    const batch = await prisma.clubMembership.findMany({
      where: { clubId: a.clubId, status: 'ACTIVE', userId: { not: a.authorId } },
      select: { id: true, userId: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    sent += await notify({ userIds: batch.map((b) => b.userId), type: 'club.announcement', title: `${a.club.name}: ${a.title}`, body: a.body.slice(0, 200), data: { clubId: a.clubId, slug: a.club.slug, announcementId: a.id } });
    cursor = batch[batch.length - 1]!.id;
  }
  return sent;
}

export async function listAnnouncements(clubId: string, userId: string | undefined, q: { cursor?: string; limit: number }) {
  const access = await loadClubAccess(clubId, userId);
  if (!canSeeClub(access)) throw notFound('Club not found');
  // Announcements are members-only content.
  if (!access.permissions.has('club.view_private')) throw forbidden('Join the club to see announcements', 'MEMBERS_ONLY');
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.clubAnnouncement.findMany({
    where: { clubId, deletedAt: null, ...(cursor ? { OR: [{ publishedAt: { lt: cursor.createdAt } }, { publishedAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    select,
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.publishedAt, id: last.id }) : null };
}

export async function updateAnnouncement(clubId: string, id: string, actorId: string, input: { title?: string; body?: string; pinned?: boolean }, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'announcements.manage');
  const existing = await prisma.clubAnnouncement.findFirst({ where: { id, clubId, deletedAt: null } });
  if (!existing) throw notFound('Announcement not found');
  return prisma.$transaction(async (tx) => {
    const a = await tx.clubAnnouncement.update({ where: { id }, data: input, select });
    await audit({ actorType: 'USER', actorId, action: 'announcement.updated', targetType: 'announcement', targetId: id, clubId }, ctx, tx);
    return a;
  });
}

export async function deleteAnnouncement(clubId: string, id: string, actorId: string, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'announcements.manage');
  const res = await prisma.clubAnnouncement.updateMany({ where: { id, clubId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (!res.count) throw notFound('Announcement not found');
  await audit({ actorType: 'USER', actorId, action: 'announcement.deleted', targetType: 'announcement', targetId: id, clubId }, ctx);
}
