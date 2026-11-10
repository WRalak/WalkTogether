import type { z } from 'zod';
import type { AuthTokens, ClubDetail, ClubSummary, MeUser } from '@walktogether/shared-types';
import type * as v from '@walktogether/validation';
import { HttpClient, type HttpClientOptions } from './http';

type In<S extends z.ZodTypeAny> = z.input<S>;

export interface MyClub {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  status: string;
  visibility: string;
  memberCount: number;
  membershipStatus: 'ACTIVE' | 'PENDING';
  role: string;
  roleKey: string | null;
  permissions: string[];
}

export interface ClubMember {
  membershipId: string;
  status: string;
  joinedAt: string | null;
  requestedAt: string;
  requestMessage?: string | null;
  statusReason: string | null;
  role: { id: string; name: string; systemKey: string | null };
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
}

export interface ClubRoleInfo {
  id: string;
  name: string;
  systemKey: string | null;
  isOwner: boolean;
  description: string | null;
  permissions: string[];
  memberCount: number;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  deviceName: string | null;
  platform: string | null;
  authMethod: string;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface Announcement {
  id: string;
  clubId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  author: { id: string; username: string; profile: { displayName: string } | null };
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: string;
  audience: 'CLUB' | 'INDIVIDUAL';
  name: string;
  description: string | null;
  currency: string;
  amountMinor: number;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
  isDefault: boolean;
  entitlements: { key: string; intLimit: number | null; boolValue: boolean | null }[];
}

export interface BillingInfo {
  subscription: { id: string; status: string; currentPeriodEnd: string; graceUntil: string | null; cancelAtPeriodEnd: boolean; plan: Plan } | null;
  entitlements: { planCode: string | null; planName: string | null; status: string; values: Record<string, number | boolean> };
}

export type ClubWithCoords = ClubDetail & { latitude: number | null; longitude: number | null };

/** Typed client for the member-facing API (mobile app, public web, club admin dashboard). */
export function createMemberApi(options: Omit<HttpClientOptions, 'refreshPath'>) {
  const http = new HttpClient({ ...options, refreshPath: '/api/v1/auth/refresh' });
  const storeTokens = async (t: Partial<AuthTokens> & { accessToken: string }) => {
    await options.tokens.setTokens({ accessToken: t.accessToken, refreshToken: t.refreshToken });
    return t;
  };

  return {
    http,
    auth: {
      register: async (body: In<typeof v.registerSchema>) => storeTokens(await http.request<AuthTokens & { userId: string }>('/api/v1/auth/register', { method: 'POST', body, auth: false })),
      login: async (body: In<typeof v.loginSchema>) => storeTokens(await http.request<AuthTokens>('/api/v1/auth/login', { method: 'POST', body, auth: false })),
      logout: async () => {
        try {
          await http.request<void>('/api/v1/auth/logout', { method: 'POST' });
        } finally {
          await options.tokens.clear();
        }
      },
      logoutAll: async () => {
        try {
          return await http.request<{ revokedSessions: number }>('/api/v1/auth/logout-all', { method: 'POST' });
        } finally {
          await options.tokens.clear();
        }
      },
      sessions: () => http.request<SessionInfo[]>('/api/v1/auth/sessions'),
      revokeSession: (id: string) => http.request<void>(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' }),
      forgotPassword: (email: string) => http.request<{ message: string }>('/api/v1/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
      resetPassword: (token: string, password: string) => http.request<{ reset: true }>('/api/v1/auth/reset-password', { method: 'POST', body: { token, password }, auth: false }),
      verifyEmail: (token: string) => http.request<{ verified: true }>('/api/v1/auth/verify-email', { method: 'POST', body: { token }, auth: false }),
      resendVerification: () => http.request<{ sent: true }>('/api/v1/auth/verify-email/resend', { method: 'POST' }),
      changePassword: (body: In<typeof v.changePasswordSchema>) => http.request<{ changed: true }>('/api/v1/auth/change-password', { method: 'POST', body }),
      requestPhoneOtp: (body: In<typeof v.phoneOtpRequestSchema>) => http.request<{ sent: true }>('/api/v1/auth/phone/request-otp', { method: 'POST', body }),
      verifyPhoneOtp: async (body: In<typeof v.phoneOtpVerifySchema>) => {
        const res = await http.request<(AuthTokens & { status: 'authenticated' }) | { status: 'registration_required'; registrationToken: string } | { verified: true }>(
          '/api/v1/auth/phone/verify-otp',
          { method: 'POST', body },
        );
        if ('status' in res && res.status === 'authenticated') await storeTokens(res);
        return res;
      },
      completePhoneRegistration: async (body: In<typeof v.phoneRegistrationSchema>) =>
        storeTokens(await http.request<AuthTokens>('/api/v1/auth/phone/register', { method: 'POST', body, auth: false })),
      oauth: async (body: In<typeof v.oauthLoginSchema>) => storeTokens(await http.request<AuthTokens & { created: boolean }>('/api/v1/auth/oauth', { method: 'POST', body, auth: false })),
    },
    notifications: {
      list: (query: { cursor?: string; limit?: number } = {}) => http.requestWithMeta<AppNotification[]>('/api/v1/notifications', { query }),
      read: (id: string) => http.request<void>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
      readAll: () => http.request<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST', body: {} }),
    },
    subscriptions: {
      plans: (audience?: 'CLUB' | 'INDIVIDUAL') => http.request<Plan[]>('/api/v1/subscriptions/plans', { query: { audience }, auth: false }),
      me: () => http.request<BillingInfo>('/api/v1/subscriptions/me'),
      cancelMine: () => http.request<unknown>('/api/v1/subscriptions/me/cancel', { method: 'POST', body: {} }),
    },
    users: {
      me: () => http.request<MeUser>('/api/v1/users/me'),
      updateMe: (body: In<typeof v.updateMeSchema>) => http.request<MeUser>('/api/v1/users/me', { method: 'PATCH', body }),
      updatePrivacy: (body: In<typeof v.updatePrivacySchema>) => http.request<unknown>('/api/v1/users/me/privacy', { method: 'PATCH', body }),
      myClubs: () => http.request<MyClub[]>('/api/v1/users/me/clubs'),
      registerDevice: (body: In<typeof v.registerDeviceSchema>) => http.request<unknown>('/api/v1/users/me/devices', { method: 'POST', body }),
      profile: (username: string) => http.request<Record<string, unknown>>(`/api/v1/users/${encodeURIComponent(username)}`),
      deleteAccount: (body: In<typeof v.deleteAccountSchema>) => http.request<{ scheduledAt: string }>('/api/v1/users/me', { method: 'DELETE', body }),
    },
    clubs: {
      list: (query: Partial<In<typeof v.listClubsQuerySchema>> = {}) => http.page<ClubSummary>('/api/v1/clubs', { query, auth: true }),
      get: (slugOrId: string) => http.request<ClubWithCoords>(`/api/v1/clubs/${encodeURIComponent(slugOrId)}`),
      create: (body: In<typeof v.createClubSchema>) => http.request<ClubWithCoords>('/api/v1/clubs', { method: 'POST', body }),
      update: (clubId: string, body: In<typeof v.updateClubSchema>) => http.request<ClubWithCoords>(`/api/v1/clubs/${clubId}`, { method: 'PATCH', body }),
      join: (clubId: string, body: In<typeof v.joinClubSchema> = {}) => http.request<{ membershipId: string; status: string }>(`/api/v1/clubs/${clubId}/join`, { method: 'POST', body }),
      leave: (clubId: string) => http.request<void>(`/api/v1/clubs/${clubId}/leave`, { method: 'POST' }),
      members: (clubId: string, query: Partial<In<typeof v.listMembersQuerySchema>> = {}) => http.page<ClubMember>(`/api/v1/clubs/${clubId}/members`, { query }),
      review: (clubId: string, membershipId: string, body: In<typeof v.reviewMembershipSchema>) =>
        http.request<{ status: string }>(`/api/v1/clubs/${clubId}/members/${membershipId}/review`, { method: 'POST', body }),
      assignRole: (clubId: string, membershipId: string, roleId: string) => http.request<unknown>(`/api/v1/clubs/${clubId}/members/${membershipId}/role`, { method: 'PUT', body: { roleId } }),
      moderate: (clubId: string, membershipId: string, body: In<typeof v.memberModerationSchema>) =>
        http.request<{ status: string }>(`/api/v1/clubs/${clubId}/members/${membershipId}/moderation`, { method: 'POST', body }),
      roles: (clubId: string) => http.request<ClubRoleInfo[]>(`/api/v1/clubs/${clubId}/roles`),
      createInvitation: (clubId: string, body: In<typeof v.createInvitationSchema>) =>
        http.request<{ id: string; code: string; expiresAt: string; maxUses: number }>(`/api/v1/clubs/${clubId}/invitations`, { method: 'POST', body }),
      invitations: (clubId: string) =>
        http.request<{ id: string; codeHint: string; email: string | null; phone: string | null; maxUses: number; useCount: number; expiresAt: string; revokedAt: string | null; createdAt: string }[]>(
          `/api/v1/clubs/${clubId}/invitations`,
        ),
      revokeInvitation: (clubId: string, invitationId: string) => http.request<void>(`/api/v1/clubs/${clubId}/invitations/${invitationId}`, { method: 'DELETE' }),
      createRole: (clubId: string, body: In<typeof v.roleInputSchema>) => http.request<ClubRoleInfo>(`/api/v1/clubs/${clubId}/roles`, { method: 'POST', body }),
      updateRole: (clubId: string, roleId: string, body: In<typeof v.updateRoleSchema>) => http.request<unknown>(`/api/v1/clubs/${clubId}/roles/${roleId}`, { method: 'PATCH', body }),
      deleteRole: (clubId: string, roleId: string) => http.request<void>(`/api/v1/clubs/${clubId}/roles/${roleId}`, { method: 'DELETE' }),
      transferOwnership: (clubId: string, membershipId: string, password?: string) => http.request<{ ownerId: string }>(`/api/v1/clubs/${clubId}/transfer-ownership`, { method: 'POST', body: { membershipId, password } }),
      announcements: (clubId: string, query: { cursor?: string; limit?: number } = {}) => http.page<Announcement>(`/api/v1/clubs/${clubId}/announcements`, { query }),
      createAnnouncement: (clubId: string, body: In<typeof v.announcementSchema>) => http.request<Announcement>(`/api/v1/clubs/${clubId}/announcements`, { method: 'POST', body }),
      updateAnnouncement: (clubId: string, id: string, body: In<typeof v.updateAnnouncementSchema>) => http.request<Announcement>(`/api/v1/clubs/${clubId}/announcements/${id}`, { method: 'PATCH', body }),
      deleteAnnouncement: (clubId: string, id: string) => http.request<void>(`/api/v1/clubs/${clubId}/announcements/${id}`, { method: 'DELETE' }),
      billing: (clubId: string) => http.request<BillingInfo>(`/api/v1/subscriptions/clubs/${clubId}`),
      cancelSubscription: (clubId: string) => http.request<unknown>(`/api/v1/subscriptions/clubs/${clubId}/cancel`, { method: 'POST', body: {} }),
      previewInvitation: (code: string) => http.request<{ club: { id: string; slug: string; name: string; logoUrl: string | null }; expiresAt: string }>(`/api/v1/clubs/invitations/${encodeURIComponent(code)}`, { auth: false }),
    },
  };
}

export type MemberApi = ReturnType<typeof createMemberApi>;
