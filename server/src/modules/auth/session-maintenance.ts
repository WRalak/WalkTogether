import { prisma } from '../../database/prisma';

/** Deletes long-expired sessions, tokens and one-time codes. Runs on the maintenance queue. */
export async function cleanupExpiredSessions() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const [sessions, codes, resets, verifications] = await prisma.$transaction([
    prisma.userSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } }),
    prisma.phoneVerification.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.emailVerification.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
  return { sessions: sessions.count, codes: codes.count, resets: resets.count, verifications: verifications.count };
}
