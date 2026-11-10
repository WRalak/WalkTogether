import { Router } from 'express';
import { z } from 'zod';
import { commentSchema, createPostSchema, feedQuerySchema, followResponseSchema, listQuerySchema, reportSchema } from '@walktogether/validation';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import * as posts from './posts.service';
import * as follows from './follows.service';
import { fileReport } from '../moderation/reports.service';

const idParam = z.object({ id: z.string().uuid() });

export const feedRouter = Router();
feedRouter.get('/', requireAuth, async (req, res) => {
  const { items, nextCursor } = await posts.feed(authUserId(req), parse(feedQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});

export const postsRouter = Router();
postsRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json({ data: await posts.createPost(authUserId(req), parse(createPostSchema, req.body)) });
});
postsRouter.get('/bookmarks', requireAuth, async (req, res) => {
  const { items, nextCursor } = await posts.bookmarks(authUserId(req), parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
postsRouter.get('/:id', optionalAuth, async (req, res) => {
  res.json({ data: await posts.getPost(parse(idParam, req.params).id, req.auth?.userId) });
});
postsRouter.delete('/:id', requireAuth, async (req, res) => {
  await posts.deletePost(parse(idParam, req.params).id, authUserId(req));
  res.status(204).end();
});
postsRouter.post('/:id/like', requireAuth, async (req, res) => {
  res.json({ data: await posts.setLike(parse(idParam, req.params).id, authUserId(req), true) });
});
postsRouter.delete('/:id/like', requireAuth, async (req, res) => {
  res.json({ data: await posts.setLike(parse(idParam, req.params).id, authUserId(req), false) });
});
postsRouter.post('/:id/bookmark', requireAuth, async (req, res) => {
  res.json({ data: await posts.setBookmark(parse(idParam, req.params).id, authUserId(req), true) });
});
postsRouter.delete('/:id/bookmark', requireAuth, async (req, res) => {
  res.json({ data: await posts.setBookmark(parse(idParam, req.params).id, authUserId(req), false) });
});
postsRouter.get('/:id/comments', optionalAuth, async (req, res) => {
  const { items, nextCursor } = await posts.listComments(parse(idParam, req.params).id, req.auth?.userId, parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
postsRouter.post('/:id/comments', requireAuth, async (req, res) => {
  const { body, parentId } = parse(commentSchema, req.body);
  res.status(201).json({ data: await posts.addComment(parse(idParam, req.params).id, authUserId(req), body, parentId) });
});

export const commentsRouter = Router();
commentsRouter.delete('/:id', requireAuth, async (req, res) => {
  await posts.deleteComment(parse(idParam, req.params).id, authUserId(req));
  res.status(204).end();
});
commentsRouter.post('/:id/like', requireAuth, async (req, res) => {
  await posts.likeComment(parse(idParam, req.params).id, authUserId(req), true);
  res.status(204).end();
});
commentsRouter.delete('/:id/like', requireAuth, async (req, res) => {
  await posts.likeComment(parse(idParam, req.params).id, authUserId(req), false);
  res.status(204).end();
});

export const reportsRouter = Router();
reportsRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json({ data: await fileReport(authUserId(req), parse(reportSchema, req.body)) });
});

/** Follow graph routes mounted under /users. */
export const followRoutes = Router();
followRoutes.get('/me/follow-requests', requireAuth, async (req, res) => {
  res.json({ data: await follows.pendingRequests(authUserId(req)) });
});
followRoutes.post('/me/follow-requests/:id', requireAuth, async (req, res) => {
  await follows.respondToRequest(authUserId(req), parse(idParam, req.params).id, parse(followResponseSchema, req.body).accept);
  res.status(204).end();
});
followRoutes.delete('/me/followers/:id', requireAuth, async (req, res) => {
  await follows.removeFollower(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});
followRoutes.post('/:id/follow', requireAuth, async (req, res) => {
  res.json({ data: await follows.follow(authUserId(req), parse(idParam, req.params).id) });
});
followRoutes.delete('/:id/follow', requireAuth, async (req, res) => {
  await follows.unfollow(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});
followRoutes.get('/:id/followers', optionalAuth, async (req, res) => {
  const { items, nextCursor } = await follows.listFollows(parse(idParam, req.params).id, req.auth?.userId, 'followers', parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
followRoutes.get('/:id/following', optionalAuth, async (req, res) => {
  const { items, nextCursor } = await follows.listFollows(parse(idParam, req.params).id, req.auth?.userId, 'following', parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
followRoutes.get('/:id/posts', optionalAuth, async (req, res) => {
  const { items, nextCursor } = await posts.userPosts(parse(idParam, req.params).id, req.auth?.userId, parse(listQuerySchema, req.query));
  res.json({ data: items, meta: { nextCursor, limit: items.length } });
});
