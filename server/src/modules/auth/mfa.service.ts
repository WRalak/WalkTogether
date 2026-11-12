/**
 * Optional TOTP multi-factor authentication for members (RFC 6238, 30 s steps, ±1 step).
 *
 * Enrolment: setup → the secret is stored encrypted as *pending* → enable with a valid code, which
 * activates MFA and returns 10 single-use recovery codes exactly once (only HMACs are stored).
 * Sign-in: every login method (password, phone OTP, Google/Apple) ends in completeLogin, which issues
 * a 5-minute MFA challenge instead of tokens; verifyLogin exchanges it for a session. Codes cannot
 * be replayed, failures count toward the account lockout, and every change is audit-logged.
 */
import { authenticator } from 'otplib';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';
import { decrypt, encrypt, hashToken, randomToken } from '../../shared/crypto';
import { AppError, badRequest, unauthorized } from '../../shared/errors';
import { recordSecurityEvent } from '../../shared/metrics';
import { verifyPassword } from '../../shared/password';
import { audit, type AuditContext } from '../audit/audit.service';
import { signToken, verifyToken } from './tokens';

authenticator.options = { window: 1, step: 30 };

const CHALLENGE_TTL_SECONDS = 300;
const RECOVERY_CODES = 10;
export const MAX_MFA_FAILURES = 10;

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresAt: string;
}

export async function issueChallenge(userId: string, method: string): Promise<MfaChallenge> {
  const { token, expiresAt } = await signToken('member_mfa', userId, { method }, CHALLENGE_TTL_SECONDS);
  return { mfaRequired: true, mfaToken: token, expiresAt: expiresAt.toISOString() };
}

export async function readChallenge(mfaToken: string) {
  const payload = await verifyToken<{ method: string }>('member_mfa', mfaToken);
  return { userId: payload.sub, method: payload.method };
}

/** Checks a TOTP code; a code can be used only once inside its validity window (replay protection). */
async function checkTotp(userId: string, secretEncrypted: string, code: string) {
  if (!authenticator.check(code, decrypt(secretEncrypted))) return false;
  return (await redis.set(`member:totp:${userId}:${code}`, '1', 'EX', 120, 'NX')) === 'OK';
}

async function consumeRecoveryCode(userId: string, code: string) {
  const used = await prisma.userMfaRecoveryCode.updateMany({ where: { userId, codeHash: hashToken(code.toLowerCase()), usedAt: null }, data: { usedAt: new Date() } });
  return used.count === 1;
}

/** Verifies a second factor for an MFA-enabled user, counting failures toward the lockout. */
export async function checkSecondFactor(
  user: { id: string; mfaSecretEncrypted: string | null; failedLoginCount: number },
  input: { code?: string; recoveryCode?: string },
  ctx: AuditContext,
) {
  if (!user.mfaSecretEncrypted) throw badRequest('Two-step verification is not enabled');
  const ok = input.code ? await checkTotp(user.id, user.mfaSecretEncrypted, input.code) : input.recoveryCode ? await consumeRecoveryCode(user.id, input.recoveryCode) : false;
  if (ok) {
    if (input.recoveryCode) await audit({ actorType: 'USER', actorId: user.id, action: 'mfa.recovery_code_used', targetType: 'user', targetId: user.id }, ctx);
    return;
  }
  recordSecurityEvent('mfa_failure', input.recoveryCode ? 'recovery_code' : 'totp');
  const failed = user.failedLoginCount + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: failed, lockedUntil: failed >= MAX_MFA_FAILURES ? new Date(Date.now() + 15 * 60_000) : undefined },
  });
  throw unauthorized('That code is not valid. Try again or use a recovery code.', 'INVALID_MFA_CODE');
}

function newRecoveryCodes() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = randomToken(16);
    let out = '';
    for (let i = 0; i < 10; i++) out += alphabet[raw.charCodeAt(i) % alphabet.length];
    return `${out.slice(0, 5)}-${out.slice(5)}`;
  });
}

async function storeRecoveryCodes(userId: string) {
  const codes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.userMfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.userMfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashToken(c) })) }),
  ]);
  return codes;
}

export async function status(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true } });
  const remaining = user.mfaEnabledAt ? await prisma.userMfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0;
  return { enabled: !!user.mfaEnabledAt, enabledAt: user.mfaEnabledAt, recoveryCodesRemaining: remaining };
}

export async function setup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, email: true, phone: true, username: true } });
  if (user.mfaEnabledAt) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Two-step verification is already on');
  const secret = authenticator.generateSecret(20);
  await prisma.user.update({ where: { id: userId }, data: { mfaPendingSecretEncrypted: encrypt(secret) } });
  return { secret, otpauthUrl: authenticator.keyuri(user.email ?? user.phone ?? user.username, env.MEMBER_TOTP_ISSUER, secret) };
}

export async function enable(userId: string, code: string, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, mfaPendingSecretEncrypted: true } });
  if (user.mfaEnabledAt) throw new AppError(409, 'MFA_ALREADY_ENABLED', 'Two-step verification is already on');
  if (!user.mfaPendingSecretEncrypted) throw badRequest('Start setup first');
  if (!(await checkTotp(userId, user.mfaPendingSecretEncrypted, code))) {
    recordSecurityEvent('mfa_failure', 'enrolment');
    throw badRequest('That code is not valid. Check the time on your phone and try again.', 'INVALID_MFA_CODE');
  }
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: user.mfaPendingSecretEncrypted, mfaPendingSecretEncrypted: null, mfaEnabledAt: new Date() } });
  const recoveryCodes = await storeRecoveryCodes(userId);
  await audit({ actorType: 'USER', actorId: userId, action: 'mfa.enabled', targetType: 'user', targetId: userId }, ctx);
  return { recoveryCodes };
}

export async function disable(userId: string, input: { code?: string; recoveryCode?: string; password?: string }, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, mfaEnabledAt: true, mfaSecretEncrypted: true, failedLoginCount: true, passwordHash: true },
  });
  if (!user.mfaEnabledAt) throw badRequest('Two-step verification is not on');
  // Accounts with a password must re-enter it, so a stolen unlocked phone alone can't remove MFA.
  if (user.passwordHash && !(input.password && (await verifyPassword(user.passwordHash, input.password)))) {
    throw unauthorized('Your password is incorrect', 'INVALID_CREDENTIALS');
  }
  await checkSecondFactor(user, input, ctx);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: null, mfaPendingSecretEncrypted: null, mfaEnabledAt: null } }),
    prisma.userMfaRecoveryCode.deleteMany({ where: { userId } }),
  ]);
  await audit({ actorType: 'USER', actorId: userId, action: 'mfa.disabled', targetType: 'user', targetId: userId }, ctx);
}

export async function regenerateRecoveryCodes(userId: string, code: string, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, mfaEnabledAt: true, mfaSecretEncrypted: true, failedLoginCount: true } });
  if (!user.mfaEnabledAt) throw badRequest('Two-step verification is not on');
  await checkSecondFactor(user, { code }, ctx);
  const recoveryCodes = await storeRecoveryCodes(userId);
  await audit({ actorType: 'USER', actorId: userId, action: 'mfa.recovery_codes_regenerated', targetType: 'user', targetId: userId }, ctx);
  return { recoveryCodes };
}
