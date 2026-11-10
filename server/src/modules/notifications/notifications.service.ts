import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { logger } from '../../shared/logger';

/** Notification categories map to user preference columns; `null` = always delivered (transactional). */
export const NOTIFICATION_CATEGORY = {
  'follow.new': 'newFollower',
  'comment.new': 'comments',
  'reaction.new': 'reactions',
  'club.invitation': null,
  'membership.approved': null,
  'membership.rejected': null,
  'club.announcement': 'clubAnnouncements',
  'event.reminder': 'eventReminders',
  'event.cancelled': null,
  'challenge.invitation': 'challengeUpdates',
  'challenge.progress': 'challengeUpdates',
  'challenge.completed': 'challengeUpdates',
  'achievement.earned': 'challengeUpdates',
  'subscription.payment': null,
  'subscription.expiring': null,
  'subscription.expired': null,
  'sponsored.event': 'marketing',
  'message.new': null,
  mention: 'comments',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_CATEGORY;

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null>;
  /** Skip storing an in-app row (e.g. chat messages, which live in conversations). */
  pushOnly?: boolean;
}

/**
 * Creates in-app notifications and queues push delivery, honouring each user's preferences.
 * Users who disabled a category get neither in-app nor push for it.
 */
export async function notify(input: NotifyInput) {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return 0;
  const category = NOTIFICATION_CATEGORY[input.type];
  const prefs = await prisma.userNotificationSettings.findMany({ where: { userId: { in: userIds } } });
  const byUser = new Map(prefs.map((p) => [p.userId, p]));
  const recipients = userIds.filter((id) => {
    const p = byUser.get(id);
    if (!p || !category) return true;
    return (p as unknown as Record<string, boolean>)[category] !== false;
  });
  if (!recipients.length) return 0;

  if (!input.pushOnly) {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body, data: (input.data ?? {}) as Prisma.InputJsonValue })),
    });
  }
  const pushUsers = recipients.filter((id) => byUser.get(id)?.pushEnabled !== false);
  if (pushUsers.length) {
    await enqueue('push.send', { userIds: pushUsers, title: input.title, body: input.body, data: { type: input.type, ...(input.data ?? {}) } }).catch((err) =>
      logger.error({ err }, 'failed to enqueue push'),
    );
  }
  return recipients.length;
}

export async function deliverPush(job: { userIds: string[]; title: string; body: string; data?: Record<string, unknown> }) {
  const devices = await prisma.userDevice.findMany({ where: { userId: { in: job.userIds } }, select: { pushToken: true } });
  const { sendPush } = await import('./push');
  await sendPush({ to: devices.map((d) => d.pushToken), title: job.title, body: job.body, data: job.data });
}

export async function listNotifications(userId: string, q: { cursor?: string; limit: number }) {
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.notification.findMany({
    where: { userId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });
  return { items, unread, nextCursor: hasMore && items.length ? encodeCursor(items[items.length - 1]!) : null };
}

export async function markRead(userId: string, id: string) {
  const res = await prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  if (!res.count) throw notFound('Notification not found');
}

export async function markAllRead(userId: string) {
  const res = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return res.count;
}
