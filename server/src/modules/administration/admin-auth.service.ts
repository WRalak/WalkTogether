import { authenticator } from 'otplib';
import type { AdminPermissionKey } from '@walktogether/shared-types';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';
import { decrypt, encrypt, hashToken, randomToken } from '../../shared/crypto';
import { AppError, badRequest, forbidden, unauthorized } from '../../shared/errors';
import { burnPasswordCheck, verifyPassword } from '../../shared/password';
import { audit, type AuditContext } from '../audit/audit.service';
import { signToken, verifyToken } from '../auth/tokens';

authenticator.options = { window: 1, step: 30 };

const MAX_FAILED = 5;
const LOCK_MINUTES = 30;

export interface AdminTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/**
 * Step 1: password. Never returns usable tokens; MFA is mandatory for every platform admin.
 * Returns a short-lived token that can only be used for the MFA step.
 */
export async function adminLogin(email: string, password: string, ctx: AuditContext) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  const invalid = unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  if (!admin) {
    await burnPasswordCheck(password);
    throw invalid;
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new AppError(429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again later.');
  }
  if (!(await verifyPassword(admin.passwordHash, password))) {
    const failed = admin.failedLoginCount + 1;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit({ actorType: 'ADMIN', actorId: admin.id, action: 'admin.login_failed', targetType: 'admin', targetId: admin.id }, ctx);
    throw invalid;
  }
  if (admin.status !== 'ACTIVE') throw forbidden('This administrator account is suspended', 'ACCOUNT_SUSPENDED');

  const stage = admin.mfaEnabledAt ? 'verify' : 'setup';
  const mfa = await signToken('admin_mfa', admin.id, { stage }, 5 * 60);
  return { mfaToken: mfa.token, mfaSetupRequired: stage === 'setup' };
}

async function readMfaToken(mfaToken: string) {
  const payload = await verifyToken<{ stage: 'setup' | 'verify' }>('admin_mfa', mfaToken);
  const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
  if (!admin || admin.status !== 'ACTIVE') throw unauthorized('Invalid token', 'INVALID_TOKEN');
  return { admin, stage: payload.stage };
}

/** Step 2a (first login only): enrol an authenticator app. */
export async function adminMfaSetup(mfaToken: string) {
  const { admin, stage } = await readMfaToken(mfaToken);
  if (stage !== 'setup' || admin.mfaEnabledAt) throw badRequest('MFA is already enabled');
  const secret = authenticator.generateSecret(20);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { mfaSecretEncrypted: encrypt(secret) } });
  return { secret, otpauthUrl: authenticator.keyuri(admin.email, env.ADMIN_TOTP_ISSUER, secret) };
}

async function checkTotp(adminId: string, secretEncrypted: string, code: string) {
  const ok = authenticator.check(code, decrypt(secretEncrypted));
  if (!ok) return false;
  // Prevent replay of the same code inside its validity window.
  const fresh = await redis.set(`admin:totp:${adminId}:${code}`, '1', 'EX', 120, 'NX');
  return fresh === 'OK';
}

/** Step 2b: verify a TOTP code and start an admin session. */
export async function adminMfaVerify(mfaToken: string, code: string, ctx: AuditContext): Promise<AdminTokens> {
  const { admin } = await readMfaToken(mfaToken);
  if (!admin.mfaSecretEncrypted) throw badRequest('MFA has not been set up');
  if (!(await checkTotp(admin.id, admin.mfaSecretEncrypted, code))) {
    const failed = admin.failedLoginCount + 1;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit({ actorType: 'ADMIN', actorId: admin.id, action: 'admin.mfa_failed', targetType: 'admin', targetId: admin.id }, ctx);
    throw unauthorized('Invalid verification code', 'INVALID_MFA_CODE');
  }
  const refresh = randomToken(48);
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 3600_000);
  const session = await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), mfaEnabledAt: admin.mfaEnabledAt ?? new Date() },
    });
    const s = await tx.adminSession.create({
      data: { adminId: admin.id, refreshTokenHash: hashToken(refresh), expiresAt, ipAddress: ctx.ipAddress?.slice(0, 64), userAgent: ctx.userAgent?.slice(0, 500) },
    });
    await audit({ actorType: 'ADMIN', actorId: admin.id, action: admin.mfaEnabledAt ? 'admin.login' : 'admin.mfa_enrolled', targetType: 'admin', targetId: admin.id }, ctx, tx);
    return s;
  });
  const access = await signToken('admin_access', admin.id, { sid: session.id }, env.ADMIN_ACCESS_TOKEN_TTL_SECONDS);
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh, refreshTokenExpiresAt: expiresAt.toISOString() };
}

export async function adminRefresh(rawToken: string, ctx: AuditContext): Promise<AdminTokens> {
  const hash = hashToken(rawToken);
  const session = await prisma.adminSession.findUnique({ where: { refreshTokenHash: hash }, include: { admin: true } });
  if (!session) {
    const replayed = await prisma.adminSession.findUnique({ where: { previousTokenHash: hash } });
    if (replayed && !replayed.revokedAt) {
      await prisma.adminSession.update({ where: { id: replayed.id }, data: { revokedAt: new Date() } });
      await audit({ actorType: 'SYSTEM', action: 'admin.refresh_token_reuse_detected', targetType: 'admin', targetId: replayed.adminId }, ctx);
    }
    throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }
  if (session.revokedAt || session.expiresAt < new Date() || session.admin.status !== 'ACTIVE') throw unauthorized('Session expired', 'SESSION_EXPIRED');
  const next = randomToken(48);
  const rotated = await prisma.adminSession.updateMany({
    where: { id: session.id, refreshTokenHash: hash },
    data: { refreshTokenHash: hashToken(next), previousTokenHash: hash, lastUsedAt: new Date() },
  });
  if (rotated.count !== 1) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  const access = await signToken('admin_access', session.adminId, { sid: session.id }, env.ADMIN_ACCESS_TOKEN_TTL_SECONDS);
  return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: next, refreshTokenExpiresAt: session.expiresAt.toISOString() };
}

export async function adminLogout(sessionId: string, adminId: string, ctx: AuditContext) {
  await prisma.adminSession.updateMany({ where: { id: sessionId, adminId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.logout', targetType: 'admin', targetId: adminId }, ctx);
}

/** Admin sessions are validated against the database on every request (low volume, high privilege). */
export async function resolveAdminSession(accessToken: string) {
  const payload = await verifyToken<{ sid: string }>('admin_access', accessToken);
  const session = await prisma.adminSession.findUnique({
    where: { id: payload.sid },
    include: { admin: { include: { role: { include: { permissions: { select: { permissionKey: true } } } } } } },
  });
  if (!session || session.adminId !== payload.sub || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized('Session has been revoked', 'SESSION_REVOKED');
  }
  if (session.admin.status !== 'ACTIVE' || !session.admin.mfaEnabledAt) throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');
  return {
    adminId: session.adminId,
    sessionId: session.id,
    roleKey: session.admin.role.key,
    permissions: new Set<AdminPermissionKey>(session.admin.role.permissions.map((p) => p.permissionKey as AdminPermissionKey)),
    admin: session.admin,
  };
}
