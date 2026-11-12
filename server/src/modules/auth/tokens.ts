import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../../config/env';
import { unauthorized } from '../../shared/errors';

const ISSUER = 'walktogether-api';
const memberKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const adminKey = new TextEncoder().encode(env.JWT_ADMIN_SECRET);

type TokenType = 'access' | 'phone_registration' | 'member_mfa' | 'admin_access' | 'admin_mfa';

const AUDIENCE: Record<TokenType, string> = {
  access: 'walktogether:member',
  phone_registration: 'walktogether:phone-registration',
  member_mfa: 'walktogether:member-mfa',
  admin_access: 'walktogether:platform-admin',
  admin_mfa: 'walktogether:platform-admin-mfa',
};

function keyFor(type: TokenType) {
  // Admin tokens use a separate secret, so a leaked member secret can never mint admin tokens.
  return type.startsWith('admin') ? adminKey : memberKey;
}

export async function signToken(type: TokenType, subject: string, claims: Record<string, unknown>, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;
  const token = await new SignJWT({ ...claims, typ: type })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE[type])
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(keyFor(type));
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyToken<T extends Record<string, unknown>>(type: TokenType, token: string) {
  try {
    const { payload } = await jwtVerify(token, keyFor(type), {
      issuer: ISSUER,
      audience: AUDIENCE[type],
      algorithms: ['HS256'],
    });
    if (payload.typ !== type || typeof payload.sub !== 'string') throw unauthorized('Invalid token');
    return payload as T & { sub: string; exp: number };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw unauthorized('Token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid token', 'INVALID_TOKEN');
  }
}

export const signAccessToken = (userId: string, sessionId: string) =>
  signToken('access', userId, { sid: sessionId }, env.ACCESS_TOKEN_TTL_SECONDS);
