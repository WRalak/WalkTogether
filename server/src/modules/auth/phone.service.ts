import { createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { numericCode, safeEqual } from '../../shared/crypto';
import { AppError, badRequest, conflict, unauthorized } from '../../shared/errors';
import { audit, type AuditContext } from '../audit/audit.service';
import { completeLogin, createUserWithDefaults, startSession, type ClientContext } from './auth.service';
import { signToken, verifyToken } from './tokens';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MS = 60 * 60_000;

type Purpose = 'LOGIN' | 'VERIFY';

function hashOtp(phone: string, purpose: Purpose, code: string) {
  return createHmac('sha256', env.TOKEN_HASH_SECRET).update(`${phone}:${purpose}:${code}`).digest('hex');
}

/**
 * Sends a one-time code. For LOGIN the response is identical whether or not the number is
 * registered (unregistered numbers may complete phone sign-up). VERIFY binds the code to the
 * authenticated user who is adding the number.
 */
export async function requestOtp(phone: string, purpose: Purpose, userId?: string) {
  if (purpose === 'VERIFY') {
    if (!userId) throw unauthorized();
    const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } });
    if (owner && owner.id !== userId && owner.phoneVerifiedAt) throw conflict('This phone number is already in use', 'PHONE_TAKEN');
  }

  const recent = await prisma.phoneVerification.findMany({
    where: { phone, createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    throw new AppError(429, 'OTP_COOLDOWN', 'Please wait a minute before requesting another code');
  }
  if (recent.length >= OTP_MAX_PER_WINDOW) throw new AppError(429, 'OTP_LIMIT', 'Too many codes requested. Try again later.');

  const code = numericCode(6);
  await prisma.$transaction([
    // Only the newest code for a phone/purpose is valid.
    prisma.phoneVerification.updateMany({ where: { phone, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.phoneVerification.create({
      data: { phone, purpose, userId: purpose === 'VERIFY' ? userId : null, codeHash: hashOtp(phone, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    }),
  ]);
  await enqueue('sms.send', { to: phone, body: `Your WalkTogether code is ${code}. It expires in 10 minutes. Never share this code.` });
}

async function consumeOtp(phone: string, purpose: Purpose, code: string, userId?: string) {
  const row = await prisma.phoneVerification.findFirst({
    where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() }, ...(purpose === 'VERIFY' ? { userId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  const invalid = badRequest('The code is invalid or has expired');
  if (!row) throw invalid;
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.phoneVerification.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    throw invalid;
  }
  if (!safeEqual(row.codeHash, hashOtp(phone, purpose, code))) {
    await prisma.phoneVerification.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }
  const claimed = await prisma.phoneVerification.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalid;
}

/** Verify a phone number for the signed-in user. */
export async function verifyPhoneForUser(userId: string, phone: string, code: string, ctx: AuditContext) {
  await consumeOtp(phone, 'VERIFY', code, userId);
  await prisma.$transaction(async (tx) => {
    const other = await tx.user.findUnique({ where: { phone }, select: { id: true } });
    if (other && other.id !== userId) {
      // An unverified claim on this number by another account is released.
      await tx.user.update({ where: { id: other.id }, data: { phone: null, phoneVerifiedAt: null } });
    }
    await tx.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
    await audit({ actorType: 'USER', actorId: userId, action: 'auth.phone_verified', targetType: 'user', targetId: userId }, ctx, tx);
  });
}

/**
 * Phone sign-in. Existing verified numbers receive tokens; unknown numbers receive a short-lived
 * registration token that must be exchanged via completePhoneRegistration.
 */
export async function loginWithPhone(phone: string, code: string, ctx: ClientContext) {
  await consumeOtp(phone, 'LOGIN', code);
  const user = await prisma.user.findUnique({ where: { phone } });
  if (user && user.phoneVerifiedAt && user.status !== 'DELETED') {
    return { status: 'authenticated' as const, tokens: await completeLogin(user, 'PHONE_OTP', ctx) };
  }
  const reg = await signToken('phone_registration', phone, {}, 15 * 60);
  return { status: 'registration_required' as const, registrationToken: reg.token, expiresAt: reg.expiresAt.toISOString() };
}

export async function completePhoneRegistration(
  input: { registrationToken: string; username: string; displayName: string },
  ctx: ClientContext,
) {
  const payload = await verifyToken('phone_registration', input.registrationToken);
  const phone = payload.sub;
  const [phoneOwner, usernameOwner] = await Promise.all([
    prisma.user.findUnique({ where: { phone }, select: { id: true, phoneVerifiedAt: true } }),
    prisma.user.findUnique({ where: { username: input.username }, select: { id: true } }),
  ]);
  if (phoneOwner?.phoneVerifiedAt) throw conflict('This phone number is already registered', 'ACCOUNT_EXISTS');
  if (usernameOwner) throw conflict('That username is already taken', 'USERNAME_TAKEN');

  return prisma.$transaction(async (tx) => {
    if (phoneOwner) await tx.user.update({ where: { id: phoneOwner.id }, data: { phone: null, phoneVerifiedAt: null } });
    const user = await createUserWithDefaults(tx, { phone, phoneVerified: true, username: input.username, displayName: input.displayName });
    await audit({ actorType: 'USER', actorId: user.id, action: 'auth.registered', targetType: 'user', targetId: user.id, metadata: { method: 'phone' } }, ctx, tx);
    await tx.loginEvent.create({ data: { userId: user.id, method: 'PHONE_OTP', success: true, ipAddress: ctx.ipAddress?.slice(0, 64), userAgent: ctx.userAgent?.slice(0, 500) } });
    return startSession(user.id, 'PHONE_OTP', ctx, tx);
  });
}
