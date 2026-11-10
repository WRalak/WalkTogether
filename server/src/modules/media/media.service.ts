import type { MediaPurpose } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { randomToken } from '../../shared/crypto';
import { badRequest, conflict, notFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { scanBuffer } from './scanner';
import { ALLOWED, sniffMime } from './sniff';
import { storage } from './storage';

const VIDEO_PURPOSES: MediaPurpose[] = ['POST'];

export async function requestUpload(ownerId: string, input: { purpose: MediaPurpose; mimeType: string; sizeBytes: number }) {
  const rule = ALLOWED[input.mimeType];
  if (!rule) throw badRequest('Unsupported file type. Use JPEG, PNG, WebP, HEIC or MP4.');
  if (rule.kind === 'VIDEO' && !VIDEO_PURPOSES.includes(input.purpose)) throw badRequest('Videos are only allowed in posts');
  if (input.sizeBytes > rule.maxBytes) throw badRequest(`File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`);
  const pending = await prisma.mediaAsset.count({ where: { ownerId, status: 'PENDING_UPLOAD', createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (pending > 30) throw conflict('Too many unfinished uploads', 'UPLOAD_LIMIT');
  const key = `uploads/${ownerId}/${randomToken(12)}`;
  const asset = await prisma.mediaAsset.create({ data: { ownerId, purpose: input.purpose, kind: rule.kind, mimeType: input.mimeType, sizeBytes: input.sizeBytes, storageKey: key } });
  return { mediaId: asset.id, upload: await storage.presignUpload(key, input.mimeType, input.sizeBytes) };
}

export async function completeUpload(ownerId: string, mediaId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, ownerId } });
  if (!asset) throw notFound('Media not found');
  if (asset.status !== 'PENDING_UPLOAD') return serialize(asset);
  const head = await storage.read(asset.storageKey, 16);
  if (!head) throw badRequest('Upload not found in storage. Upload the file before completing.');
  const updated = await prisma.mediaAsset.update({ where: { id: mediaId }, data: { status: 'PROCESSING' } });
  await enqueue('media.process', { mediaId });
  return serialize((await prisma.mediaAsset.findUnique({ where: { id: mediaId } })) ?? updated);
}

async function reject(id: string, key: string, reason: string) {
  await storage.remove(key).catch(() => undefined);
  await prisma.mediaAsset.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason } });
  logger.warn({ mediaId: id, reason }, 'media rejected');
}

/**
 * Background processing: verify real type by magic bytes, malware-scan, then for images
 * re-encode (strips EXIF incl. GPS location) into responsive WebP variants.
 */
export async function processMedia(mediaId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset || asset.status !== 'PROCESSING') return;
  const buf = await storage.read(asset.storageKey);
  if (!buf) return reject(asset.id, asset.storageKey, 'missing');
  if (buf.length > asset.sizeBytes * 1.01 + 1024) return reject(asset.id, asset.storageKey, 'size_mismatch');
  const real = sniffMime(buf);
  if (!real || real !== asset.mimeType) return reject(asset.id, asset.storageKey, 'type_mismatch');
  const scan = await scanBuffer(buf);
  if (!scan.clean) return reject(asset.id, asset.storageKey, `malware:${scan.signature ?? 'detected'}`);

  if (asset.kind === 'VIDEO') {
    // Videos are published as uploaded after scanning; server-side transcoding (e.g. AWS
    // MediaConvert) is the documented next step for adaptive streaming and metadata stripping.
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'READY', variants: { original: asset.storageKey } } });
    return;
  }
  try {
    const img = sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
    const meta = await img.metadata();
    const variants: Record<string, string> = {};
    for (const [name, width] of [['medium', 1280], ['thumb', 320]] as const) {
      const out = await img.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(); // metadata dropped by default
      const key = `media/${asset.id}/${name}.webp`;
      await storage.write(key, out, 'image/webp');
      variants[name] = key;
    }
    // Remove the original: it may contain EXIF GPS coordinates.
    await storage.remove(asset.storageKey);
    const portrait = (meta.orientation ?? 1) >= 5;
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'READY', variants, width: portrait ? meta.height : meta.width, height: portrait ? meta.width : meta.height } });
  } catch (err) {
    logger.warn({ err, mediaId }, 'image processing failed');
    await reject(asset.id, asset.storageKey, 'unreadable_image');
  }
}

type Asset = NonNullable<Awaited<ReturnType<typeof prisma.mediaAsset.findUnique>>>;
export function serialize(a: Asset) {
  const v = (a.variants ?? {}) as Record<string, string>;
  return {
    id: a.id,
    kind: a.kind,
    purpose: a.purpose,
    status: a.status,
    width: a.width,
    height: a.height,
    rejectReason: a.rejectReason,
    urls: a.status === 'READY' ? Object.fromEntries(Object.entries(v).map(([k, key]) => [k, storage.publicUrl(key)])) : {},
  };
}

export async function getMedia(ownerId: string, id: string) {
  const a = await prisma.mediaAsset.findFirst({ where: { id, ownerId } });
  if (!a) throw notFound('Media not found');
  return serialize(a);
}

/** Resolves a READY asset owned by `ownerId` for the given purpose, returning its display URL. */
export async function readyAssetUrl(ownerId: string, id: string, purposes: MediaPurpose[]) {
  const a = await prisma.mediaAsset.findFirst({ where: { id, ownerId } });
  if (!a) throw notFound('Media not found');
  if (!purposes.includes(a.purpose)) throw badRequest('This media was uploaded for a different purpose');
  if (a.status !== 'READY') throw conflict('Media is still processing', 'MEDIA_NOT_READY');
  const v = a.variants as Record<string, string>;
  return storage.publicUrl(v.medium ?? v.original!);
}

export async function deleteMedia(ownerId: string, id: string) {
  const a = await prisma.mediaAsset.findFirst({ where: { id, ownerId } });
  if (!a) throw notFound('Media not found');
  const keys = [a.storageKey, ...Object.values((a.variants ?? {}) as Record<string, string>)];
  await Promise.all(keys.map((k) => storage.remove(k).catch(() => undefined)));
  await prisma.mediaAsset.delete({ where: { id } });
}
