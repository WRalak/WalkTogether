import { prisma } from '../../database/prisma';
import { storage } from './storage';

/** Removes abandoned uploads (never completed within 24 h) and rejected assets. */
export async function cleanupStaleMedia() {
  const stale = await prisma.mediaAsset.findMany({
    where: { OR: [{ status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, { status: 'REJECTED', updatedAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } }] },
    take: 500,
  });
  for (const a of stale) {
    await storage.remove(a.storageKey).catch(() => undefined);
    await prisma.mediaAsset.delete({ where: { id: a.id } });
  }
  return { removed: stale.length };
}
