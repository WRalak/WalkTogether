import express, { Router } from 'express';
import { z } from 'zod';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { parse } from '../../middleware/validate';
import { badRequest, notFound, unauthorized } from '../../shared/errors';
import * as svc from './media.service';
import { ALLOWED } from './sniff';
import { localStorageDriver } from './storage';

export const mediaRouter = Router();
const idParam = z.object({ id: z.string().uuid() });

mediaRouter.post('/', requireAuth, async (req, res) => {
  const body = parse(
    z
      .object({
        purpose: z.enum(['AVATAR', 'CLUB_LOGO', 'CLUB_COVER', 'POST', 'EVENT_COVER']),
        mimeType: z.string().max(100),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(200 * 1024 * 1024),
      })
      .strict(),
    req.body,
  );
  res.status(201).json({ data: await svc.requestUpload(authUserId(req), body) });
});
mediaRouter.post('/:id/complete', requireAuth, async (req, res) => {
  res.json({ data: await svc.completeUpload(authUserId(req), parse(idParam, req.params).id) });
});
mediaRouter.get('/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.getMedia(authUserId(req), parse(idParam, req.params).id) });
});
mediaRouter.delete('/:id', requireAuth, async (req, res) => {
  await svc.deleteMedia(authUserId(req), parse(idParam, req.params).id);
  res.status(204).end();
});

/** Development-only stand-in for S3 presigned PUT (the router is not mounted when STORAGE_DRIVER=s3). */
export const localUploadRouter = Router();
localUploadRouter.put('/local-upload/*key', express.raw({ type: () => true, limit: '110mb' }), async (req, res) => {
  if (!localStorageDriver) throw notFound();
  const key = (req.params as unknown as { key: string[] }).key.join('/');
  const { exp, token } = parse(z.object({ exp: z.coerce.number().int(), token: z.string().max(100) }), req.query);
  if (!localStorageDriver.verifyUploadToken(key, exp, token)) throw unauthorized('Upload URL is invalid or expired');
  if (!ALLOWED[String(req.header('content-type'))]) throw badRequest('Content-Type mismatch');
  await localStorageDriver.write(key, req.body as Buffer);
  res.status(200).end();
});
