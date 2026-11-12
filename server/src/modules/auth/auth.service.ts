import type { AuthMethod, DevicePlatform, Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { deviceInfoSchema, LoginInput, RegisterInput } from '@walktogether/validation';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../database/prisma';
import { enqueue } from '../../queues';
import { hashToken, randomToken } from '../../shared/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { recordSecurityEvent } from '../../shared/metrics';
import * as mfa from './mfa.service';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from '../../shared/password';
import { audit, type AuditContext } from '../audit/audit.service';
import { templates } from '../notifications/templates';
import { markSessionsRevoked } from './session-revocation';
import { signAccessToken } from './tokens';

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export interface ClientContext extends AuditContext {
  device?: DeviceInfo;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
const EMAIL_VERIFICATION_TTL_MS = 24 * 3600_000;
const PASSWORD_RESET_TTL_MS = 30 * 60_000;

const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600_000;

// ---------------------------------------------------------------------------
// Sessions & tokens
// ---------------------------------------------------------------------------

async function createRefreshToken(tx: Tx, sessionId: string, expiresAt: Date) {
  const raw = randomToken(48);
  const row = await tx.refreshToken.create({ data: { sessionId, tokenHash: hashToken(raw), expiresAt } });
  return { raw, id: row.id };
}

/** Starts a new device session and issues an access + refresh token pair. */
export async function startSession(userId: string, method: AuthMethod, ctx: ClientContext, tx: Tx = prisma): Promise<IssuedTokens> {
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  const session = await tx.userSession.create({
    data: {
      userId,
      authMethod: method,
      deviceId: ctx.device?.deviceId,
      deviceName: ctx.device?.deviceName,
      platform: ctx.device?.platform as DevicePlatform | undefined,
      appVersion: ctx.device?.appVersion,
      ipAddress: ctx.ipAddress?.slice(0, 64),
      userAgent: ctx.userAgent?.slice(0, 500),
      expiresAt,
    },
  });
  const refresh = await createRefreshToken(tx, session.id, expiresAt);
  const access = await signAccessToken(userId, session.id);
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.raw,
    refreshTokenExpiresAt: expiresAt.toISOString(),
    sessionId: session.id,
  };
}

export async function revokeSessions(where: Prisma.UserSessionWhereInput, reason: string, tx: Tx = prisma) {
  const sessions = await tx.userSession.findMany({ where: { ...where, revokedAt: null }, select: { id: true } });
  if (!sessions.length) return 0;
  const ids = sessions.map((s) => s.id);
  await tx.userSession.updateMany({ where: { id: { in: ids } }, data: { revokedAt: new Date(), revokedReason: reason } });
  await markSessionsRevoked(ids);
  return ids.length;
}

/**
 * Refresh-token rotation with reuse detection. Each refresh token can be used exactly once;
 * presenting an already-used token means it was copied, so the whole session is revoked.
 */
export async function refreshSession(rawToken: string, ctx: AuditContext): Promise<IssuedTokens> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { session: { include: { user: { select: { id: true, status: true } } } } },
  });
  if (!token) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');

  const { session } = token;
  if (token.usedAt) {
    recordSecurityEvent('refresh_token_reuse');
    await revokeSessions({ id: session.id }, 'refresh_token_reuse');
    await audit({ actorType: 'SYSTEM', action: 'auth.refresh_token_reuse_detected', targetType: 'user', targetId: session.userId, metadata: { sessionId: session.id } }, ctx);
    logger.warn({ sessionId: session.id }, 'refresh token reuse detected; session revoked');
    throw unauthorized('Refresh token has already been used', 'REFRESH_TOKEN_REUSED');
  }
  if (session.revokedAt || session.expiresAt < new Date() || token.expiresAt < new Date()) {
    throw unauthorized('Session expired', 'SESSION_EXPIRED');
  }
  if (session.user.status !== 'ACTIVE') throw unauthorized('Account is not active', 'ACCOUNT_INACTIVE');

  return prisma.$transaction(async (tx) => {
    // Conditional update guards against two concurrent refreshes with the same token.
    const claimed = await tx.refreshToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw unauthorized('Refresh token has already been used', 'REFRESH_TOKEN_REUSED');
    const next = await createRefreshToken(tx, session.id, session.expiresAt);
    await tx.refreshToken.update({ where: { id: token.id }, data: { replacedById: next.id } });
    await tx.userSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date(), ipAddress: ctx.ipAddress?.slice(0, 64) } });
    const access = await signAccessToken(session.userId, session.id);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: next.raw,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
    };
  });
}

// ---------------------------------------------------------------------------
// Registration & verification
// ---------------------------------------------------------------------------

export async function createUserWithDefaults(
  tx: Tx,
  data: { email?: string | null; emailVerified?: boolean; phone?: string | null; phoneVerified?: boolean; username: string; displayName: string; passwordHash?: string | null },
) {
  const now = new Date();
  return tx.user.create({
    data: {
      email: data.email ?? null,
      emailVerifiedAt: data.emailVerified ? now : null,
      phone: data.phone ?? null,
      phoneVerifiedAt: data.phoneVerified ? now : null,
      username: data.username,
      passwordHash: data.passwordHash ?? null,
      termsAcceptedAt: now,
      profile: { create: { displayName: data.displayName } },
      privacySettings: { create: {} },
      notificationSettings: { create: {} },
    },
  });
}

export async function issueEmailVerification(userId: string, email: string, displayName: string, tx: Tx = prisma) {
  const token = randomToken(32);
  await tx.emailVerification.create({
    data: { userId, email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
  });
  return () => enqueue('email.send', templates.verifyEmail(email, displayName, token));
}

export async function register(input: RegisterInput, ctx: ClientContext) {
  const [emailTaken, usernameTaken, phoneTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username: input.username }, select: { id: true } }),
    input.phone ? prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } }) : null,
  ]);
  if (usernameTaken) throw conflict('That username is already taken', 'USERNAME_TAKEN');
  if (emailTaken || phoneTaken) throw conflict('An account with these details already exists. Try signing in instead.', 'ACCOUNT_EXISTS');

  const passwordHash = await hashPassword(input.password);

  const { user, tokens, sendVerification } = await prisma.$transaction(async (tx) => {
    const user = await createUserWithDefaults(tx, {
      email: input.email,
      phone: input.phone,
      username: input.username,
      displayName: input.displayName,
      passwordHash,
    });
    const sendVerification = await issueEmailVerification(user.id, input.email, input.displayName, tx);
    const tokens = await startSession(user.id, 'PASSWORD', ctx, tx);
    await tx.loginEvent.create({
      data: { userId: user.id, method: 'PASSWORD', success: true, ipAddress: ctx.ipAddress?.slice(0, 64), userAgent: ctx.userAgent?.slice(0, 500), deviceId: ctx.device?.deviceId },
    });
    await audit({ actorType: 'USER', actorId: user.id, action: 'auth.registered', targetType: 'user', targetId: user.id }, ctx, tx);
    return { user, tokens, sendVerification };
  });

  await sendVerification().catch((err) => logger.error({ err, userId: user.id }, 'failed to send verification email'));
  return { userId: user.id, tokens };
}

export async function verifyEmail(token: string, ctx: AuditContext) {
  const row = await prisma.emailVerification.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('This verification link is invalid or has expired');
  if (row.user.email !== row.email) throw badRequest('This verification link is no longer valid for your account');
  await prisma.$transaction(async (tx) => {
    await tx.emailVerification.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await audit({ actorType: 'USER', actorId: row.userId, action: 'auth.email_verified', targetType: 'user', targetId: row.userId }, ctx, tx);
  });
}

export async function resendEmailVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  if (!user.email) throw badRequest('No email address on this account');
  if (user.emailVerifiedAt) throw conflict('Email is already verified', 'ALREADY_VERIFIED');
  const recent = await prisma.emailVerification.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (recent >= 3) throw new AppError(429, 'RATE_LIMITED', 'Please wait before requesting another verification email');
  const send = await issueEmailVerification(user.id, user.email, user.profile?.displayName ?? user.username);
  await send();
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function recordLogin(data: { userId?: string; method: AuthMethod; success: boolean; failureReason?: string; suspicious?: boolean }, ctx: ClientContext) {
  if (!data.success) recordSecurityEvent('auth_failure', data.failureReason ?? 'unknown');
  if (data.suspicious) recordSecurityEvent('suspicious_login', data.method);
  await prisma.loginEvent.create({
    data: {
      ...data,
      ipAddress: ctx.ipAddress?.slice(0, 64),
      userAgent: ctx.userAgent?.slice(0, 500),
      deviceId: ctx.device?.deviceId,
    },
  });
}

/**
 * Heuristic: a successful login is "suspicious" when the user has prior successful logins
 * but none from this device id or IP address within the last 90 days.
 */
async function isSuspiciousLogin(userId: string, ctx: ClientContext) {
  const since = new Date(Date.now() - 90 * 24 * 3600_000);
  const prior = await prisma.loginEvent.findMany({
    where: { userId, success: true, createdAt: { gt: since } },
    select: { ipAddress: true, deviceId: true },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  if (!prior.length) return false;
  return !prior.some((p) => (ctx.device?.deviceId && p.deviceId === ctx.device.deviceId) || (ctx.ipAddress && p.ipAddress === ctx.ipAddress));
}

/**
 * Shared post-authentication steps for every login method (password, phone OTP, Google/Apple).
 * When the member has turned on two-step verification, the first factor only earns a short-lived
 * MFA challenge; tokens are issued by verifyMfaLogin once the second factor checks out.
 */
export async function completeLogin(user: { id: string; email: string | null; status: string }, method: AuthMethod, ctx: ClientContext, opts: { mfaVerified?: boolean } = {}): Promise<IssuedTokens | mfa.MfaChallenge> {
  if (user.status === 'SUSPENDED') {
    await recordLogin({ userId: user.id, method, success: false, failureReason: 'suspended' }, ctx);
    throw forbidden('This account has been suspended. Contact support for help.', 'ACCOUNT_SUSPENDED');
  }
  if (!opts.mfaVerified) {
    const { mfaEnabledAt } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaEnabledAt: true } });
    if (mfaEnabledAt) return mfa.issueChallenge(user.id, method);
  }
  const suspicious = await isSuspiciousLogin(user.id, ctx);
  const tokens = await prisma.$transaction(async (tx) => {
    // Signing in during the deletion grace period cancels the deletion request.
    if (user.status === 'PENDING_DELETION') {
      await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', deletionRequestedAt: null, deletionScheduledAt: null } });
      await audit({ actorType: 'USER', actorId: user.id, action: 'account.deletion_cancelled', targetType: 'user', targetId: user.id }, ctx, tx);
    }
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return startSession(user.id, method, ctx, tx);
  });
  await recordLogin({ userId: user.id, method, success: true, suspicious }, ctx);
  if (suspicious && user.email) {
    await enqueue('email.send', templates.suspiciousLogin(user.email, { ip: ctx.ipAddress, device: ctx.device?.deviceName ?? ctx.userAgent, at: new Date() })).catch(
      (err) => logger.error({ err }, 'failed to enqueue suspicious login email'),
    );
  }
  return tokens;
}

export async function login(input: LoginInput, ctx: ClientContext) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const invalid = unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');

  if (!user || user.status === 'DELETED' || !user.passwordHash) {
    await burnPasswordCheck(input.password);
    await recordLogin({ userId: user?.id, method: 'PASSWORD', success: false, failureReason: 'invalid_credentials' }, ctx);
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin({ userId: user.id, method: 'PASSWORD', success: false, failureReason: 'locked' }, ctx);
    throw new AppError(429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed sign-in attempts. Try again later or reset your password.');
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
    });
    await recordLogin({ userId: user.id, method: 'PASSWORD', success: false, failureReason: 'invalid_credentials' }, ctx);
    throw invalid;
  }

  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
  }
  return completeLogin(user, 'PASSWORD', ctx);
}

/** Second step of sign-in for members with two-step verification turned on. */
export async function verifyMfaLogin(input: { mfaToken: string; code?: string; recoveryCode?: string }, ctx: ClientContext) {
  const challenge = await mfa.readChallenge(input.mfaToken);
  const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
  if (!user || user.status === 'DELETED') throw unauthorized('Invalid token', 'INVALID_TOKEN');
  const method = challenge.method as AuthMethod;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin({ userId: user.id, method, success: false, failureReason: 'locked' }, ctx);
    throw new AppError(429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed sign-in attempts. Try again later or reset your password.');
  }
  try {
    await mfa.checkSecondFactor(user, input, ctx);
  } catch (err) {
    await recordLogin({ userId: user.id, method, success: false, failureReason: 'mfa_invalid' }, ctx);
    throw err;
  }
  return completeLogin(user, method, ctx, { mfaVerified: true });
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

export async function forgotPassword(email: string, ctx: AuditContext) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always behave identically to avoid revealing which emails are registered.
  if (!user || user.status === 'DELETED' || user.status === 'SUSPENDED') return;
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (recent >= 3) return;
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS), ipAddress: ctx.ipAddress?.slice(0, 64) },
    }),
  ]);
  await enqueue('email.send', templates.passwordReset(email, token));
}

export async function resetPassword(token: string, newPassword: string, ctx: AuditContext) {
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || row.user.status === 'DELETED') {
    throw badRequest('This reset link is invalid or has expired');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await revokeSessions({ userId: row.userId }, 'password_reset', tx);
    await audit({ actorType: 'USER', actorId: row.userId, action: 'auth.password_reset', targetType: 'user', targetId: row.userId }, ctx, tx);
  });
  if (row.user.email) await enqueue('email.send', templates.passwordChanged(row.user.email));
}

export async function changePassword(userId: string, currentSessionId: string, current: string, next: string, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
    throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }
  const passwordHash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await revokeSessions({ userId, id: { not: currentSessionId } }, 'password_changed', tx);
    await audit({ actorType: 'USER', actorId: userId, action: 'auth.password_changed', targetType: 'user', targetId: userId }, ctx, tx);
  });
  if (user.email) await enqueue('email.send', templates.passwordChanged(user.email));
}

// ---------------------------------------------------------------------------
// Session management (per device)
// ---------------------------------------------------------------------------

export async function listSessions(userId: string, currentSessionId: string) {
  const sessions = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    take: 50,
  });
  return sessions.map((s) => ({
    id: s.id,
    current: s.id === currentSessionId,
    deviceName: s.deviceName,
    platform: s.platform,
    authMethod: s.authMethod,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
  }));
}

export async function revokeOwnSession(userId: string, sessionId: string, ctx: AuditContext) {
  // Scoped by userId: users can never revoke (or learn about) another user's session.
  const count = await revokeSessions({ id: sessionId, userId }, 'user_logout');
  if (!count) throw notFound('Session not found');
  await audit({ actorType: 'USER', actorId: userId, action: 'auth.session_revoked', targetType: 'session', targetId: sessionId }, ctx);
}

export async function logoutAll(userId: string, ctx: AuditContext) {
  const count = await revokeSessions({ userId }, 'user_logout_all');
  await audit({ actorType: 'USER', actorId: userId, action: 'auth.logout_all', targetType: 'user', targetId: userId, metadata: { sessions: count } }, ctx);
  return count;
}

export async function loginHistory(userId: string) {
  return prisma.loginEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, method: true, success: true, failureReason: true, ipAddress: true, userAgent: true, suspicious: true, createdAt: true },
  });
}
