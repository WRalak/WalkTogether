import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { canViewActivity } from '../activities/visibility';
import { audit, type AuditContext } from '../audit/audit.service';
import { requireClubPermission } from '../clubs/club-access';
import { storage } from '../media/storage';
import { notify } from '../notifications/notifications.service';
import { isBlockedEitherWay } from '../users/users.service';

type Vis = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';
const MENTION = /(^|[^\w.])@([a-z0-9][a-z0-9_.]{1,28}[a-z0-9])/gi;

const postInclude = {
  author: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
  club: { select: { id: true, slug: true, name: true } },
  activity: { select: { id: true, type: true, title: true, distanceM: true, movingSeconds: true, avgPaceSecPerKm: true, startedAt: true, visibility: true, status: true, userId: true } },
  media: { orderBy: { position: 'asc' }, include: { media: true } },
} satisfies Prisma.PostInclude;
type PostRow = Prisma.PostGetPayload<{ include: typeof postInclude }>;

function serialize(p: PostRow, viewer: { liked: Set<string>; bookmarked: Set<string> }) {
  return {
    id: p.id,
    author: { id: p.author.id, username: p.author.username, displayName: p.author.profile?.displayName ?? p.author.username, avatarUrl: p.author.profile?.avatarUrl ?? null },
    club: p.club,
    activity: p.activity && { id: p.activity.id, type: p.activity.type, title: p.activity.title, distanceM: p.activity.distanceM, movingSeconds: p.activity.movingSeconds, avgPaceSecPerKm: p.activity.avgPaceSecPerKm, startedAt: p.activity.startedAt },
    body: p.body,
    visibility: p.visibility,
    media: p.media.filter((m) => m.media.status === 'READY').map((m) => ({ id: m.media.id, kind: m.media.kind, width: m.media.width, height: m.media.height, urls: Object.fromEntries(Object.entries(m.media.variants as Record<string, string>).map(([k, key]) => [k, storage.publicUrl(key)])) })),
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: viewer.liked.has(p.id),
    bookmarkedByMe: viewer.bookmarked.has(p.id),
    hidden: !!p.hiddenAt,
    createdAt: p.createdAt,
  };
}

async function viewerState(viewerId: string | undefined, postIds: string[]) {
  if (!viewerId || !postIds.length) return { liked: new Set<string>(), bookmarked: new Set<string>() };
  const [likes, marks] = await Promise.all([
    prisma.postLike.findMany({ where: { userId: viewerId, postId: { in: postIds } }, select: { postId: true } }),
    prisma.bookmark.findMany({ where: { userId: viewerId, postId: { in: postIds } }, select: { postId: true } }),
  ]);
  return { liked: new Set(likes.map((l) => l.postId)), bookmarked: new Set(marks.map((b) => b.postId)) };
}

export async function canViewPost(p: { id: string; authorId: string; clubId: string | null; activityId: string | null; visibility: Vis; deletedAt: Date | null; hiddenAt: Date | null; activity?: { id: string; userId: string; visibility: string; status: string } | null }, viewerId: string | undefined) {
  if (p.deletedAt) return false;
  if (viewerId === p.authorId) return true;
  if (p.hiddenAt) return false;
  if (viewerId && (await isBlockedEitherWay(viewerId, p.authorId))) return false;
  if (p.activityId && p.activity) return canViewActivity(p.activity, viewerId);
  if (p.clubId) {
    if (!viewerId) return false;
    return !!(await prisma.clubMembership.findFirst({ where: { clubId: p.clubId, userId: viewerId, status: 'ACTIVE', club: { status: 'ACTIVE' } }, select: { id: true } }));
  }
  if (p.visibility === 'PUBLIC') return true;
  if (p.visibility === 'FOLLOWERS' && viewerId) return !!(await prisma.follow.findFirst({ where: { followerId: viewerId, followeeId: p.authorId, status: 'ACCEPTED' }, select: { status: true } }));
  return false;
}

async function loadVisible(postId: string, viewerId: string | undefined) {
  const p = await prisma.post.findUnique({ where: { id: postId }, include: postInclude });
  if (!p || !(await canViewPost(p, viewerId))) throw notFound('Post not found');
  return p;
}

async function notifyMentions(text: string, actorId: string, postId: string, clubId: string | null) {
  const names = [...new Set([...text.matchAll(MENTION)].map((m) => m[2]!.toLowerCase()))].slice(0, 10);
  if (!names.length) return;
  const users = await prisma.user.findMany({ where: { username: { in: names }, status: 'ACTIVE', id: { not: actorId } }, select: { id: true } });
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { username: true } });
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { activity: true } });
  const allowed: string[] = [];
  for (const u of users) if (await canViewPost(post, u.id)) allowed.push(u.id); // never leak content via mentions
  await notify({ userIds: allowed, type: 'mention', title: `@${actor.username} mentioned you`, body: text.slice(0, 140), data: { postId, ...(clubId ? { clubId } : {}) } });
}

export async function createPost(authorId: string, input: { body?: string | null; visibility: Vis; clubId?: string | null; mediaIds: string[] }) {
  if (!input.body?.trim() && !input.mediaIds.length) throw badRequest('A post needs text or media');
  const recent = await prisma.post.count({ where: { authorId, createdAt: { gt: new Date(Date.now() - 60_000) } } });
  if (recent >= 10) throw new AppError(429, 'RATE_LIMITED', 'You are posting too fast');
  if (input.clubId) {
    const m = await prisma.clubMembership.findFirst({ where: { clubId: input.clubId, userId: authorId, status: 'ACTIVE', club: { status: 'ACTIVE' } } });
    if (!m) throw forbidden('You can only post in clubs you are an active member of', 'NOT_A_MEMBER');
  }
  const media = input.mediaIds.length ? await prisma.mediaAsset.findMany({ where: { id: { in: input.mediaIds }, ownerId: authorId, purpose: 'POST' } }) : [];
  if (media.length !== new Set(input.mediaIds).size) throw notFound('Media not found');
  if (media.some((m) => m.status !== 'READY')) throw conflict('Media is still processing', 'MEDIA_NOT_READY');
  const post = await prisma.post.create({
    data: { authorId, body: input.body?.trim() || null, visibility: input.visibility, clubId: input.clubId ?? null, media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) } },
    include: postInclude,
  });
  if (post.body) await notifyMentions(post.body, authorId, post.id, post.clubId);
  return serialize(post, { liked: new Set(), bookmarked: new Set() });
}

/** Called by the activity.completed job: completed, non-private (or club-shared) activities appear in feeds. */
export async function upsertActivityPost(activityId: string) {
  const a = await prisma.activity.findUnique({ where: { id: activityId }, include: { clubShares: true } });
  if (!a || a.status !== 'COMPLETED') return;
  if (a.visibility === 'PRIVATE' && !a.clubShares.length) {
    await prisma.post.deleteMany({ where: { activityId } });
    return;
  }
  await prisma.post.upsert({
    where: { activityId },
    create: { authorId: a.userId, activityId, visibility: a.visibility, body: a.notes, createdAt: a.endedAt ?? a.startedAt },
    update: { visibility: a.visibility, body: a.notes },
  });
}

export async function getPost(id: string, viewerId?: string) {
  const p = await loadVisible(id, viewerId);
  return serialize(p, await viewerState(viewerId, [p.id]));
}

export async function deletePost(id: string, actorId: string) {
  const p = await prisma.post.findUnique({ where: { id } });
  if (!p || p.deletedAt || p.authorId !== actorId) throw notFound('Post not found');
  if (p.activityId) throw badRequest('Change the activity’s visibility or delete the activity instead');
  await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
}

/**
 * Personalised feed, fan-out on read with keyset pagination: own posts, followed people
 * (respecting visibility), and posts/activities shared into the viewer's clubs. Blocks excluded.
 * Never loads the whole feed into memory.
 */
export async function feed(viewerId: string, q: { cursor?: string; limit: number; clubId?: string }) {
  const cursor = decodeCursor(q.cursor);
  const cursorSql = cursor ? Prisma.sql`AND (p.created_at, p.id) < (${cursor.createdAt}, ${cursor.id}::uuid)` : Prisma.empty;
  const clubSql = q.clubId
    ? Prisma.sql`AND (p.club_id = ${q.clubId}::uuid OR EXISTS (SELECT 1 FROM activity_club_shares s WHERE s.activity_id = p.activity_id AND s.club_id = ${q.clubId}::uuid))`
    : Prisma.empty;
  if (q.clubId) {
    const m = await prisma.clubMembership.findFirst({ where: { clubId: q.clubId, userId: viewerId, status: 'ACTIVE' } });
    if (!m) throw forbidden('Join the club to see its community feed', 'MEMBERS_ONLY');
  }
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM posts p
     WHERE p.deleted_at IS NULL AND (p.hidden_at IS NULL OR p.author_id = ${viewerId}::uuid)
       AND (
         p.author_id = ${viewerId}::uuid
         OR (p.club_id IS NULL AND p.visibility IN ('PUBLIC','FOLLOWERS')
             AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId}::uuid AND f.followee_id = p.author_id AND f.status = 'ACCEPTED'))
         OR (p.club_id IS NOT NULL AND EXISTS (SELECT 1 FROM club_memberships m JOIN clubs c ON c.id = m.club_id
               WHERE m.club_id = p.club_id AND m.user_id = ${viewerId}::uuid AND m.status = 'ACTIVE' AND c.status = 'ACTIVE'))
         OR (p.activity_id IS NOT NULL AND EXISTS (SELECT 1 FROM activity_club_shares s JOIN club_memberships m ON m.club_id = s.club_id
               WHERE s.activity_id = p.activity_id AND m.user_id = ${viewerId}::uuid AND m.status = 'ACTIVE'))
       )
       AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = ${viewerId}::uuid))
       ${clubSql}
       ${cursorSql}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ${q.limit + 1}`;
  const hasMore = ids.length > q.limit;
  const page = ids.slice(0, q.limit).map((r) => r.id);
  const rows = await prisma.post.findMany({ where: { id: { in: page } }, include: postInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = page.map((id) => byId.get(id)!).filter(Boolean);
  const state = await viewerState(viewerId, page);
  const last = ordered[ordered.length - 1];
  return { items: ordered.map((p) => serialize(p, state)), nextCursor: hasMore && last ? encodeCursor(last) : null };
}

/** A user's own posts as seen by a viewer (profile timeline). */
export async function userPosts(authorId: string, viewerId: string | undefined, q: { cursor?: string; limit: number }) {
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.post.findMany({
    where: { authorId, deletedAt: null, clubId: null, ...(viewerId === authorId ? {} : { hiddenAt: null, visibility: { not: 'PRIVATE' } }), ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit * 2,
    include: postInclude,
  });
  const visible: PostRow[] = [];
  for (const r of rows) if (visible.length < q.limit && (await canViewPost(r, viewerId))) visible.push(r);
  const last = visible[visible.length - 1];
  return { items: visible.map((p) => serialize(p, { liked: new Set(), bookmarked: new Set() })), nextCursor: rows.length === q.limit * 2 && last ? encodeCursor(last) : null };
}

export async function setLike(postId: string, userId: string, like: boolean) {
  const p = await loadVisible(postId, userId);
  if (like) {
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.postLike.createMany({ data: [{ postId, userId }], skipDuplicates: true });
      if (r.count) await tx.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } });
      return r.count;
    });
    if (created && p.authorId !== userId) {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
      await notify({ userIds: [p.authorId], type: 'reaction.new', title: 'New like', body: `@${me.username} liked your ${p.activityId ? 'activity' : 'post'}`, data: { postId } });
    }
  } else {
    await prisma.$transaction(async (tx) => {
      const r = await tx.postLike.deleteMany({ where: { postId, userId } });
      if (r.count) await tx.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } });
    });
  }
  return { liked: like };
}

export async function setBookmark(postId: string, userId: string, on: boolean) {
  await loadVisible(postId, userId);
  if (on) await prisma.bookmark.createMany({ data: [{ postId, userId }], skipDuplicates: true });
  else await prisma.bookmark.deleteMany({ where: { postId, userId } });
  return { bookmarked: on };
}

export async function bookmarks(userId: string, q: { cursor?: string; limit: number }) {
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.bookmark.findMany({
    where: { userId, post: { deletedAt: null }, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, postId: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
    take: q.limit + 1,
    include: { post: { include: postInclude } },
  });
  const visible = [];
  for (const r of rows.slice(0, q.limit)) if (await canViewPost(r.post, userId)) visible.push(r);
  const state = await viewerState(userId, visible.map((v) => v.postId));
  const last = rows.slice(0, q.limit).at(-1);
  return { items: visible.map((v) => serialize(v.post, state)), nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.postId }) : null };
}

// Comments ----------------------------------------------------------------------------------

export async function addComment(postId: string, authorId: string, body: string, parentId?: string) {
  const p = await loadVisible(postId, authorId);
  let parent: { id: string; authorId: string; parentId: string | null } | null = null;
  if (parentId) {
    parent = await prisma.comment.findFirst({ where: { id: parentId, postId, deletedAt: null }, select: { id: true, authorId: true, parentId: true } });
    if (!parent) throw notFound('Comment not found');
  }
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: { postId, authorId, body, parentId: parent ? (parent.parentId ?? parent.id) : null }, // one level of threading
      include: { author: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
    });
    await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    return c;
  });
  const me = comment.author;
  const recipients = [p.authorId, parent?.authorId].filter((u): u is string => !!u && u !== authorId);
  await notify({ userIds: recipients, type: 'comment.new', title: `@${me.username} commented`, body: body.slice(0, 140), data: { postId, commentId: comment.id } });
  await notifyMentions(body, authorId, postId, p.clubId);
  return comment;
}

export async function listComments(postId: string, viewerId: string | undefined, q: { cursor?: string; limit: number }) {
  await loadVisible(postId, viewerId);
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.comment.findMany({
    where: {
      postId,
      deletedAt: null,
      ...(viewerId ? { OR: [{ hiddenAt: null }, { authorId: viewerId }] } : { hiddenAt: null }),
      ...(viewerId ? { author: { blocking: { none: { blockedId: viewerId } }, blockedBy: { none: { blockerId: viewerId } } } } : {}),
      ...(cursor ? { AND: [{ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: q.limit + 1,
    include: { author: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function deleteComment(commentId: string, actorId: string) {
  const c = await prisma.comment.findUnique({ where: { id: commentId }, include: { post: true } });
  if (!c || c.deletedAt) throw notFound('Comment not found');
  // Authors can delete their comments; post authors can remove comments on their posts.
  if (c.authorId !== actorId && c.post.authorId !== actorId) throw forbidden();
  await prisma.$transaction([prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } }), prisma.post.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } })]);
}

export async function likeComment(commentId: string, userId: string, like: boolean) {
  const c = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!c || c.deletedAt) throw notFound('Comment not found');
  await loadVisible(c.postId, userId);
  await prisma.$transaction(async (tx) => {
    const r = like ? await tx.commentReaction.createMany({ data: [{ commentId, userId }], skipDuplicates: true }) : await tx.commentReaction.deleteMany({ where: { commentId, userId } });
    if (r.count) await tx.comment.update({ where: { id: commentId }, data: { likeCount: { increment: like ? 1 : -1 } } });
  });
}

// Club moderation ----------------------------------------------------------------------------

export async function moderateClubContent(clubId: string, actorId: string, target: { type: 'POST' | 'COMMENT'; id: string }, hide: boolean, reason: string | undefined, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'community.moderate');
  if (target.type === 'POST') {
    const p = await prisma.post.findFirst({ where: { id: target.id, clubId } });
    if (!p) throw notFound('Post not found');
    await prisma.post.update({ where: { id: p.id }, data: { hiddenAt: hide ? new Date() : null, hiddenReason: hide ? (reason ?? null) : null } });
  } else {
    const c = await prisma.comment.findFirst({ where: { id: target.id, post: { clubId } } });
    if (!c) throw notFound('Comment not found');
    await prisma.comment.update({ where: { id: c.id }, data: { hiddenAt: hide ? new Date() : null } });
  }
  await audit({ actorType: 'USER', actorId, action: hide ? 'moderation.hidden' : 'moderation.unhidden', targetType: target.type.toLowerCase(), targetId: target.id, clubId, metadata: { reason } }, ctx);
}
