import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { randomToken } from '../../shared/crypto';
import { AppError, unauthorized } from '../../shared/errors';
import { audit } from '../audit/audit.service';
import { completeLogin, createUserWithDefaults, startSession, type ClientContext } from './auth.service';

type Provider = 'google' | 'apple';

const providers: Record<Provider, { jwks: ReturnType<typeof createRemoteJWKSet>; issuers: string[]; audiences: () => string[] }> = {
  google: {
    jwks: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audiences: () => env.GOOGLE_CLIENT_IDS,
  },
  apple: {
    jwks: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
    issuers: ['https://appleid.apple.com'],
    audiences: () => env.APPLE_CLIENT_IDS,
  },
};

interface VerifiedIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Verifies a provider ID token's signature, issuer, audience and expiry against the provider JWKS. */
export async function verifyIdToken(provider: Provider, idToken: string): Promise<VerifiedIdentity> {
  const cfg = providers[provider];
  const audiences = cfg.audiences();
  if (!audiences.length) throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', `${provider} sign-in is not configured on this server`);
  let payload: JWTPayload & { email?: string; email_verified?: boolean | string; name?: string };
  try {
    ({ payload } = await jwtVerify(idToken, cfg.jwks, { issuer: cfg.issuers, audience: audiences }));
  } catch {
    throw unauthorized('Could not verify sign-in with provider', 'INVALID_ID_TOKEN');
  }
  if (!payload.sub) throw unauthorized('Could not verify sign-in with provider', 'INVALID_ID_TOKEN');
  return {
    subject: payload.sub,
    email: payload.email?.toLowerCase() ?? null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name ?? null,
  };
}

async function generateUsername(seed: string) {
  const base = (
    seed
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, '')
      .replace(/^[_.]+|[_.]+$/g, '') || 'walker'
  ).slice(0, 20);
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}${
      i === 0 && base.length >= 3
        ? ''
        : randomToken(3)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
    }`.slice(0, 30);
    if (candidate.length >= 3 && !(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `walker${Date.now().toString(36)}`;
}

export async function loginWithOAuth(provider: Provider, idToken: string, displayName: string | undefined, ctx: ClientContext) {
  const identity = await verifyIdToken(provider, idToken);
  const method = provider === 'google' ? 'GOOGLE' : 'APPLE';

  const linked = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: identity.subject } },
    include: { user: true },
  });
  if (linked && linked.user.status !== 'DELETED') return { created: false, tokens: await completeLogin(linked.user, method, ctx) };

  // Auto-link only when BOTH the provider and our records confirm ownership of the email.
  if (identity.email && identity.emailVerified) {
    const existing = await prisma.user.findUnique({ where: { email: identity.email } });
    if (existing && existing.status !== 'DELETED') {
      if (!existing.emailVerifiedAt) {
        throw new AppError(409, 'ACCOUNT_LINK_REQUIRED', 'An account with this email exists. Sign in with your password and verify your email first.');
      }
      await prisma.oAuthAccount.create({ data: { userId: existing.id, provider, providerAccountId: identity.subject, email: identity.email } });
      await audit({ actorType: 'USER', actorId: existing.id, action: 'auth.oauth_linked', targetType: 'user', targetId: existing.id, metadata: { provider } }, ctx);
      return { created: false, tokens: await completeLogin(existing, method, ctx) };
    }
  }

  const username = await generateUsername(identity.email?.split('@')[0] ?? identity.name ?? 'walker');
  const tokens = await prisma.$transaction(async (tx) => {
    const user = await createUserWithDefaults(tx, {
      email: identity.email && identity.emailVerified ? identity.email : null,
      emailVerified: identity.emailVerified,
      username,
      displayName: (displayName ?? identity.name ?? username).slice(0, 60),
    });
    await tx.oAuthAccount.create({ data: { userId: user.id, provider, providerAccountId: identity.subject, email: identity.email } });
    await audit({ actorType: 'USER', actorId: user.id, action: 'auth.registered', targetType: 'user', targetId: user.id, metadata: { method: provider } }, ctx, tx);
    return startSession(user.id, method, ctx, tx);
  });
  return { created: true, tokens };
}
