import { prisma } from '../../database/prisma';
import { AppError, badRequest, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';
import { isBlockedEitherWay } from '../users/users.service';
import { emitToConversation } from './realtime';

const memberSelect = { userId: true, lastReadAt: true, user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } } as const;

/**
 * Authorisation for every conversation access: the caller must be a member row AND still be
 * entitled (club conversations require ACTIVE club membership; blocks end direct messaging).
 */
export async function assertMember(conversationId: string, userId: string) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { members: { select: { userId: true } } } });
  if (!conv || !conv.members.some((m) => m.userId === userId)) throw notFound('Conversation not found');
  if (conv.kind === 'CLUB' || conv.kind === 'EVENT') {
    const m = await prisma.clubMembership.findFirst({ where: { clubId: conv.clubId!, userId, status: 'ACTIVE' } });
    if (!m) throw forbidden('You are no longer a member of this club', 'NOT_A_MEMBER');
  }
  if (conv.kind === 'DIRECT') {
    const other = conv.members.find((m) => m.userId !== userId);
    if (other && (await isBlockedEitherWay(userId, other.userId))) throw forbidden('You cannot message this person', 'BLOCKED');
  }
  return conv;
}

export async function directConversation(userId: string, otherId: string) {
  if (userId === otherId) throw badRequest('You cannot message yourself');
  const other = await prisma.user.findUnique({ where: { id: otherId } });
  if (!other || other.status !== 'ACTIVE' || (await isBlockedEitherWay(userId, otherId))) throw notFound('User not found');
  const directKey = [userId, otherId].sort().join(':');
  const conv = await prisma.conversation.upsert({
    where: { directKey },
    create: { kind: 'DIRECT', directKey, members: { create: [{ userId }, { userId: otherId }] } },
    update: {},
  });
  return getConversation(conv.id, userId);
}

/** The club's group chat; members are synced lazily on access. */
export async function clubConversation(clubId: string, userId: string) {
  await requireClubPermission(clubId, userId, 'club.view_private');
  const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId }, select: { name: true } });
  let conv = await prisma.conversation.findFirst({ where: { clubId, kind: 'CLUB' } });
  conv ??= await prisma.conversation.create({ data: { kind: 'CLUB', clubId, title: club.name } });
  await prisma.conversationMember.createMany({ data: [{ conversationId: conv.id, userId }], skipDuplicates: true });
  return getConversation(conv.id, userId);
}

/** Event chat for participants (GOING/waitlisted) and organisers. */
export async function eventConversation(eventId: string, userId: string) {
  const e = await prisma.event.findUnique({ where: { id: eventId } });
  if (!e) throw notFound('Event not found');
  const [reg, access] = await Promise.all([
    prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId } } }),
    prisma.clubMembership.findFirst({ where: { clubId: e.clubId, userId, status: 'ACTIVE' }, include: { role: { include: { permissions: true } } } }),
  ]);
  const organiser = access?.role.permissions.some((p) => p.permissionKey === 'events.manage');
  if (!access || (!organiser && !(reg && reg.status !== 'CANCELLED'))) throw forbidden('RSVP to join the event chat', 'NOT_A_PARTICIPANT');
  const conv = await prisma.conversation.upsert({ where: { eventId }, create: { kind: 'EVENT', eventId, clubId: e.clubId, title: e.title }, update: {} });
  await prisma.conversationMember.createMany({ data: [{ conversationId: conv.id, userId }], skipDuplicates: true });
  return getConversation(conv.id, userId);
}

export async function getConversation(id: string, userId: string) {
  await assertMember(id, userId);
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { members: { select: memberSelect, take: 50 } } });
  const me = conv.members.find((m) => m.userId === userId);
  const unread = await prisma.message.count({ where: { conversationId: id, deletedAt: null, senderId: { not: userId }, ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}) } });
  return { id: conv.id, kind: conv.kind, title: conv.title, clubId: conv.clubId, lastMessageAt: conv.lastMessageAt, members: conv.members.map((m) => ({ ...m.user, lastReadAt: m.lastReadAt })), unread };
}

export async function listConversations(userId: string) {
  const rows = await prisma.conversationMember.findMany({
    where: { userId },
    orderBy: { conversation: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
    take: 100,
    include: { conversation: { include: { members: { select: memberSelect, take: 3 }, messages: { where: { deletedAt: null, hiddenAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
  });
  return rows.map((r) => ({
    id: r.conversationId,
    kind: r.conversation.kind,
    title: r.conversation.title,
    clubId: r.conversation.clubId,
    lastMessageAt: r.conversation.lastMessageAt,
    lastMessage: r.conversation.messages[0] ? { body: r.conversation.messages[0].body, senderId: r.conversation.messages[0].senderId, createdAt: r.conversation.messages[0].createdAt } : null,
    members: r.conversation.members.map((m) => m.user),
    unread: !!(r.conversation.messages[0] && r.conversation.messages[0].senderId !== userId && (!r.lastReadAt || r.conversation.messages[0].createdAt > r.lastReadAt)),
  }));
}

export async function listMessages(conversationId: string, userId: string, q: { cursor?: string; limit: number }) {
  await assertMember(conversationId, userId);
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      deletedAt: null,
      OR: [{ hiddenAt: null }, { senderId: userId }],
      ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    select: { id: true, senderId: true, body: true, createdAt: true, clientId: true },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function sendMessage(conversationId: string, senderId: string, body: string, clientId?: string) {
  const conv = await assertMember(conversationId, senderId);
  const recent = await prisma.message.count({ where: { senderId, createdAt: { gt: new Date(Date.now() - 10_000) } } });
  if (recent >= 20) throw new AppError(429, 'RATE_LIMITED', 'You are sending messages too fast');
  if (clientId) {
    const dup = await prisma.message.findUnique({ where: { senderId_clientId: { senderId, clientId } } });
    if (dup) return dup; // idempotent retry
  }
  const msg = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId, senderId, body, clientId } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: senderId } }, data: { lastReadAt: m.createdAt } });
    return m;
  });
  const payload = { id: msg.id, conversationId, senderId, body: msg.body, createdAt: msg.createdAt, clientId: msg.clientId };
  emitToConversation(conversationId, 'message:new', payload);
  // Push to members who have not muted the conversation (and are not the sender).
  const recipients = await prisma.conversationMember.findMany({ where: { conversationId, userId: { not: senderId }, mutedAt: null }, select: { userId: true } });
  const sender = await prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { username: true } });
  await notify({ userIds: recipients.map((r) => r.userId), type: 'message.new', title: conv.kind === 'DIRECT' ? `@${sender.username}` : `${conv.title ?? 'Group'} · @${sender.username}`, body: body.slice(0, 120), data: { conversationId }, pushOnly: true });
  return payload;
}

export async function markRead(conversationId: string, userId: string) {
  await assertMember(conversationId, userId);
  const at = new Date();
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { lastReadAt: at } });
  emitToConversation(conversationId, 'conversation:read', { conversationId, userId, lastReadAt: at });
  return { lastReadAt: at };
}

export async function setMuted(conversationId: string, userId: string, muted: boolean) {
  await assertMember(conversationId, userId);
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { mutedAt: muted ? new Date() : null } });
}

export async function deleteMessage(messageId: string, userId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId } });
  if (!m || m.senderId !== userId || m.deletedAt) throw notFound('Message not found');
  await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  emitToConversation(m.conversationId, 'message:deleted', { id: messageId, conversationId: m.conversationId });
}
