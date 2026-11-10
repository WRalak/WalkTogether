import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';
import { safeEqual } from '../../shared/crypto';

export interface PresignedUpload {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/** Object storage abstraction: S3-compatible (AWS S3, Cloudflare R2, MinIO) or local disk for development. */
export interface StorageProvider {
  presignUpload(key: string, mimeType: string, sizeBytes: number): Promise<PresignedUpload>;
  read(key: string, maxBytes?: number): Promise<Buffer | null>;
  write(key: string, body: Buffer, mimeType: string): Promise<void>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const UPLOAD_TTL_S = 15 * 60;

class S3Storage implements StorageProvider {
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials: env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
  });
  async presignUpload(key: string, mimeType: string, sizeBytes: number) {
    // ContentType and ContentLength are signed: the client cannot upload a different type or size.
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: mimeType, ContentLength: sizeBytes }), { expiresIn: UPLOAD_TTL_S });
    return { method: 'PUT' as const, url, headers: { 'Content-Type': mimeType }, expiresAt: new Date(Date.now() + UPLOAD_TTL_S * 1000).toISOString() };
  }
  async read(key: string, maxBytes?: number) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: maxBytes ? `bytes=0-${maxBytes - 1}` : undefined }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }
  async write(key: string, body: Buffer, mimeType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: mimeType, CacheControl: 'public, max-age=31536000, immutable' }));
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }
  publicUrl(key: string) {
    return `${(env.MEDIA_PUBLIC_BASE_URL ?? `https://${env.S3_BUCKET}.s3.amazonaws.com`).replace(/\/$/, '')}/${key}`;
  }
}

/** Development only (forbidden in staging/production by config validation). */
class LocalStorage implements StorageProvider {
  readonly root = resolve(env.STORAGE_LOCAL_DIR);
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + '/')) throw new Error('invalid key');
    return p;
  }
  uploadToken(key: string, exp: number) {
    return createHmac('sha256', env.TOKEN_HASH_SECRET).update(`upload:${key}:${exp}`).digest('base64url');
  }
  verifyUploadToken(key: string, exp: number, token: string) {
    return exp > Date.now() / 1000 && safeEqual(token, this.uploadToken(key, exp));
  }
  async presignUpload(key: string, mimeType: string) {
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_S;
    const url = `${env.API_PUBLIC_URL}/api/v1/media/local-upload/${key}?exp=${exp}&token=${this.uploadToken(key, exp)}`;
    return { method: 'PUT' as const, url, headers: { 'Content-Type': mimeType }, expiresAt: new Date(exp * 1000).toISOString() };
  }
  async read(key: string, maxBytes?: number) {
    try {
      const buf = await readFile(this.path(key));
      return maxBytes ? buf.subarray(0, maxBytes) : buf;
    } catch {
      return null;
    }
  }
  async write(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
  publicUrl(key: string) {
    return `${env.API_PUBLIC_URL}/media-files/${key}`;
  }
}

export const storage: StorageProvider = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
export const localStorageDriver = storage instanceof LocalStorage ? storage : null;
