import { prisma } from '../../database/prisma';

export const LOGIN_HISTORY_RETENTION_DAYS = 365;

/** Deletes long-expired sessions, tokens and one-time codes, and login history past retention. Runs on the maintenance queue. */
export async function cleanupExpiredSessions() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  // Login history is kept for 12 months (security/policies/DATA_PROTECTION_POLICY.md §4).
  const loginHistoryCutoff = new Date(Date.now() - LOGIN_HISTORY_RETENTION_DAYS * 24 * 3600_000);
  const [sessions, codes, resets, verifications, loginEvents] = await prisma.$transaction([
    prisma.userSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } }),
    prisma.phoneVerification.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.emailVerification.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.loginEvent.deleteMany({ where: { createdAt: { lt: loginHistoryCutoff } } }),
  ]);
  return { sessions: sessions.count, codes: codes.count, resets: resets.count, verifications: verifications.count, loginEvents: loginEvents.count };
}
