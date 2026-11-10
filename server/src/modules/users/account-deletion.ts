import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { randomToken } from '../../shared/crypto';
import { conflict, unauthorized } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { verifyPassword } from '../../shared/password';
import { audit, type AuditContext } from '../audit/audit.service';
import { revokeSessions } from '../auth/auth.service';
import { templates } from '../notifications/templates';

export const DELETION_GRACE_DAYS = 30;

/**
 * Account deletion is a two-step process: the request immediately signs the user out
 * everywhere and hides the profile, and the account is anonymised after a grace period
 * during which signing in again cancels the request.
 */
export async function requestAccountDeletion(userId: string, password: string | undefined, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash && !(password && (await verifyPassword(user.passwordHash, password)))) {
    throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  }
  const owned = await prisma.club.count({ where: { ownerId: userId, deletedAt: null, status: { not: 'ARCHIVED' } } });
  if (owned > 0) {
    throw conflict('Transfer ownership of your clubs (or archive them) before deleting your account', 'OWNS_CLUBS');
  }
  const scheduledAt = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: 'PENDING_DELETION', deletionRequestedAt: new Date(), deletionScheduledAt: scheduledAt } });
    await revokeSessions({ userId }, 'account_deletion_requested', tx);
    await audit({ actorType: 'USER', actorId: userId, action: 'account.deletion_requested', targetType: 'user', targetId: userId }, ctx, tx);
  });
  if (user.email) await enqueue('email.send', templates.accountDeletionScheduled(user.email, scheduledAt));
  return { scheduledAt };
}

/** Irreversibly anonymises one account. Personal data is removed; referential rows are kept anonymous. */
export async function anonymiseUser(userId: string) {
  const placeholder = `deleted_${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 30);
  await prisma.$transaction(async (tx) => {
    await tx.userSession.deleteMany({ where: { userId } });
    await tx.oAuthAccount.deleteMany({ where: { userId } });
    await tx.userDevice.deleteMany({ where: { userId } });
    await tx.emailVerification.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.phoneVerification.deleteMany({ where: { userId } });
    await tx.loginEvent.deleteMany({ where: { userId } });
    await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    // Personal fitness data is deleted with the account (points cascade).
    await tx.activity.deleteMany({ where: { userId } });
    await tx.personalGoal.deleteMany({ where: { userId } });
    await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followeeId: userId }] } });
    const leaving = await tx.clubMembership.findMany({ where: { userId, status: 'ACTIVE' }, select: { clubId: true } });
    for (const m of leaving) await tx.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } });
    await tx.clubMembership.deleteMany({ where: { userId } });
    await tx.userProfile.update({
      where: { userId },
      data: { displayName: 'Deleted user', bio: null, avatarUrl: null, location: null, countryCode: null, fitnessInterests: [], preferredActivityTypes: [] },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        email: null,
        phone: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        passwordHash: null,
        username: placeholder,
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });
    await audit({ actorType: 'SYSTEM', action: 'account.anonymised', targetType: 'user', targetId: userId }, {}, tx);
  });
}

export async function purgeDueAccounts() {
  const due = await prisma.user.findMany({
    where: { status: 'PENDING_DELETION', deletionScheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 100,
  });
  let purged = 0;
  for (const { id } of due) {
    try {
      await anonymiseUser(id);
      purged++;
    } catch (err) {
      logger.error({ err, userId: id }, 'failed to anonymise account');
    }
  }
  return { purged };
}
