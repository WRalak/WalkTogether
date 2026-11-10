import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { prisma } from '../src/database/prisma';
import { redis } from '../src/database/redis';
import { devOutbox } from '../src/modules/notifications/email';
import { hashPassword } from '../src/shared/password';
import { decrypt } from '../src/shared/crypto';

export const app = createApp();
export const api = () => request(app);

export const uid = () => randomUUID().replace(/-/g, '').slice(0, 10);

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export async function registerUser(overrides: { verified?: boolean } = {}): Promise<TestUser> {
  const id = uid();
  const body = { email: `user_${id}@example.com`, password: 'walk2gether-strong', username: `u_${id}`, displayName: `User ${id}`, acceptTerms: true };
  const res = await api().post('/api/v1/auth/register').send(body).expect(201);
  if (overrides.verified !== false) {
    await prisma.user.update({ where: { id: res.body.data.userId }, data: { emailVerifiedAt: new Date() } });
  }
  return {
    id: res.body.data.userId,
    email: body.email,
    username: body.username,
    password: body.password,
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
    sessionId: res.body.data.sessionId,
  };
}

export const bearer = (u: { accessToken: string }) => ({ Authorization: `Bearer ${u.accessToken}` });

export async function createClub(owner: TestUser, overrides: Record<string, unknown> = {}) {
  const slug = `club-${uid()}`;
  const res = await api()
    .post('/api/v1/clubs')
    .set(bearer(owner))
    .send({ name: `Club ${slug}`, slug, category: 'WALKING', visibility: 'PUBLIC', ...overrides })
    .expect(201);
  return res.body.data as { id: string; slug: string; visibility: string };
}

export async function roleId(clubId: string, systemKey: string) {
  const role = await prisma.clubRole.findUniqueOrThrow({ where: { clubId_systemKey: { clubId, systemKey } } });
  return role.id;
}

export async function membershipId(clubId: string, userId: string) {
  const m = await prisma.clubMembership.findUniqueOrThrow({ where: { clubId_userId: { clubId, userId } } });
  return m.id;
}

/** Makes `user` an active member of `club` with the given system role. */
export async function addMember(clubId: string, userId: string, systemKey = 'MEMBER') {
  const rid = await roleId(clubId, systemKey);
  await prisma.$transaction([
    prisma.clubMembership.upsert({
      where: { clubId_userId: { clubId, userId } },
      create: { clubId, userId, roleId: rid, status: 'ACTIVE', joinedAt: new Date() },
      update: { roleId: rid, status: 'ACTIVE' },
    }),
    prisma.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } }),
  ]);
}

export function lastEmailTo(email: string) {
  for (let i = devOutbox.length - 1; i >= 0; i--) if (devOutbox[i]!.to === email) return devOutbox[i]!;
  throw new Error(`no email sent to ${email}`);
}

export function tokenFromEmail(email: string) {
  const match = lastEmailTo(email).text.match(/token=([^\s&]+)/);
  if (!match) throw new Error('no token in email');
  return decodeURIComponent(match[1]!);
}

/** Creates an MFA-enrolled platform admin and returns an admin access token. */
export async function createAdmin(roleKey = 'SUPER_ADMIN') {
  const id = uid();
  const email = `admin_${id}@walktogether.test`;
  const password = 'admin-password-very-strong-1';
  const role = await prisma.adminRole.findUniqueOrThrow({ where: { key: roleKey } });
  await prisma.adminUser.create({ data: { email, displayName: `Admin ${id}`, passwordHash: await hashPassword(password), roleId: role.id } });

  const login = await api().post('/api/v1/platform-admin/auth/login').send({ email, password }).expect(200);
  const setup = await api().post('/api/v1/platform-admin/auth/mfa/setup').send({ mfaToken: login.body.data.mfaToken }).expect(200);
  const code = authenticator.generate(setup.body.data.secret);
  const verify = await api().post('/api/v1/platform-admin/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code }).expect(200);
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
  return { email, password, accessToken: verify.body.data.accessToken as string, refreshToken: verify.body.data.refreshToken as string, totpSecret: decrypt(admin.mfaSecretEncrypted!) };
}

export async function teardown() {
  await prisma.$disconnect();
  await redis.quit();
}
