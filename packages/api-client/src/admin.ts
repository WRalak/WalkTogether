import { HttpClient, type HttpClientOptions } from './http';

export interface AdminMe {
  id: string;
  email: string;
  displayName: string;
  lastLoginAt: string | null;
  role: { key: string; name: string };
  permissions: string[];
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  username: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  displayName: string | null;
  clubCount: number;
}

export interface AdminClubRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  visibility: string;
  category: string;
  city: string | null;
  countryCode: string | null;
  memberCount: number;
  createdAt: string;
  owner: { id: string; username: string };
}

export interface AuditLogRow {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  clubId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PlatformOverview {
  users: { total: number; active30d: number; new7d: number; suspended: number; premium: number };
  clubs: { total: number; active: number; pendingApproval: number; suspended: number; paid: number; free: number };
  memberships: { active: number };
  activities: { total: number; last30d: number; totalDistanceM: number };
  events: { held: number; upcoming: number };
  challenges: { active: number; participants: number };
  revenue: {
    mrr: Record<string, number>;
    arr: Record<string, number>;
    sponsorship30d: { currency: string; grossMinor: number; payments: number }[];
    subscriptions30d: { currency: string; grossMinor: number; payments: number }[];
    cancellations30d: number;
  };
  generatedAt: string;
}

type Json = Record<string, unknown>;

type Query = Record<string, string | number | undefined>;

/** Typed client for the platform super-admin API. Uses separate tokens/cookies from the member API. */
export function createAdminApi(options: Omit<HttpClientOptions, 'refreshPath'>) {
  const http = new HttpClient({ ...options, refreshPath: '/api/v1/platform-admin/auth/refresh' });
  return {
    http,
    auth: {
      login: (email: string, password: string) =>
        http.request<{ mfaToken: string; mfaSetupRequired: boolean }>('/api/v1/platform-admin/auth/login', { method: 'POST', body: { email, password }, auth: false }),
      setupMfa: (mfaToken: string) => http.request<{ secret: string; otpauthUrl: string }>('/api/v1/platform-admin/auth/mfa/setup', { method: 'POST', body: { mfaToken }, auth: false }),
      verifyMfa: async (mfaToken: string, code: string) => {
        const t = await http.request<{ accessToken: string; refreshToken?: string }>('/api/v1/platform-admin/auth/mfa/verify', { method: 'POST', body: { mfaToken, code }, auth: false });
        await options.tokens.setTokens(t);
        return t;
      },
      logout: async () => {
        try {
          await http.request<void>('/api/v1/platform-admin/auth/logout', { method: 'POST' });
        } finally {
          await options.tokens.clear();
        }
      },
    },
    me: () => http.request<AdminMe>('/api/v1/platform-admin/me'),
    overview: () => http.request<PlatformOverview>('/api/v1/platform-admin/overview'),
    users: {
      list: (query: Query = {}) => http.page<AdminUserRow>('/api/v1/platform-admin/users', { query }),
      get: (id: string) => http.request<Record<string, unknown>>(`/api/v1/platform-admin/users/${id}`),
      setStatus: (id: string, action: 'SUSPEND' | 'REACTIVATE', reason: string) =>
        http.request<unknown>(`/api/v1/platform-admin/users/${id}/status`, { method: 'POST', body: { action, reason } }),
    },
    clubs: {
      list: (query: Query = {}) => http.page<AdminClubRow>('/api/v1/platform-admin/clubs', { query }),
      get: (id: string) => http.request<Record<string, unknown>>(`/api/v1/platform-admin/clubs/${id}`),
      setStatus: (id: string, action: 'SUSPEND' | 'REACTIVATE', reason: string) =>
        http.request<unknown>(`/api/v1/platform-admin/clubs/${id}/status`, { method: 'POST', body: { action, reason } }),
      approve: (id: string) => http.request<unknown>(`/api/v1/platform-admin/clubs/${id}/approve`, { method: 'POST', body: {} }),
    },
    reports: {
      list: (query: Query = {}) => http.page<{ id: string; targetType: string; targetId: string; reason: string; details: string | null; status: string; preview: string | null; createdAt: string; reporter: { username: string } }>('/api/v1/platform-admin/reports', { query }),
      resolve: (id: string, action: 'DISMISS' | 'HIDE_CONTENT' | 'SUSPEND_USER', note: string) => http.request<void>(`/api/v1/platform-admin/reports/${id}/resolve`, { method: 'POST', body: { action, note } }),
    },
    revenue: () => http.request<Json>('/api/v1/platform-admin/revenue'),
    system: () => http.request<Json>('/api/v1/platform-admin/system'),
    security: () => http.request<Json>('/api/v1/platform-admin/security'),
    revokeAdminSession: (id: string) => http.request<void>(`/api/v1/platform-admin/admin-sessions/${id}/revoke`, { method: 'POST' }),
    plans: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/plans'),
      create: (body: Json) => http.request<Json>('/api/v1/platform-admin/plans', { method: 'POST', body }),
      update: (id: string, body: Json) => http.request<Json>(`/api/v1/platform-admin/plans/${id}`, { method: 'PATCH', body }),
      grant: (body: { planId: string; clubId?: string; userId?: string }) => http.request<Json>('/api/v1/platform-admin/subscriptions/grant', { method: 'POST', body }),
    },
    promotions: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/promotions'),
      save: (code: string, body: Json) => http.request<Json>(`/api/v1/platform-admin/promotions/${encodeURIComponent(code)}`, { method: 'PUT', body }),
    },
    payments: {
      list: (status?: string) => http.request<Json[]>('/api/v1/platform-admin/payments', { query: { status } }),
      refund: (id: string, amountMinor: number, reason: string) => http.request<Json>(`/api/v1/platform-admin/payments/${id}/refund`, { method: 'POST', body: { amountMinor, reason } }),
    },
    sponsors: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/sponsors'),
      setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') => http.request<Json>(`/api/v1/platform-admin/sponsors/${id}/status`, { method: 'POST', body: { status } }),
    },
    campaigns: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/campaigns'),
      review: (id: string, decision: 'APPROVE' | 'REJECT', note: string) => http.request<void>(`/api/v1/platform-admin/campaigns/${id}/review`, { method: 'POST', body: { decision, note } }),
      report: (id: string) => http.request<Json>(`/api/v1/platform-admin/campaigns/${id}/report`),
      award: (id: string, topN: number, description: string) => http.request<Json[]>(`/api/v1/platform-admin/campaigns/${id}/rewards`, { method: 'POST', body: { topN, description } }),
      fulfil: (rewardId: string) => http.request<Json>(`/api/v1/platform-admin/rewards/${rewardId}/fulfil`, { method: 'POST' }),
    },
    challenges: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/challenges'),
      create: (body: Json) => http.request<Json>('/api/v1/platform-admin/challenges', { method: 'POST', body }),
      cancel: (id: string) => http.request<void>(`/api/v1/platform-admin/challenges/${id}/cancel`, { method: 'POST' }),
    },
    achievements: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/achievements'),
      save: (code: string, body: Json) => http.request<Json>(`/api/v1/platform-admin/achievements/${encodeURIComponent(code)}`, { method: 'PUT', body }),
    },
    admins: {
      list: () => http.request<Json[]>('/api/v1/platform-admin/admins'),
      create: (body: { email: string; displayName: string; roleKey: string; password: string }) => http.request<Json>('/api/v1/platform-admin/admins', { method: 'POST', body }),
      setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') => http.request<void>(`/api/v1/platform-admin/admins/${id}/status`, { method: 'POST', body: { status } }),
    },
    auditLogs: (query: Query = {}) => http.page<AuditLogRow>('/api/v1/platform-admin/audit-logs', { query }),
    settings: {
      list: () => http.request<{ key: string; value: unknown; description: string | null; updatedAt: string }[]>('/api/v1/platform-admin/settings'),
      set: (key: string, value: unknown) => http.request<unknown>(`/api/v1/platform-admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),
    },
    featureFlags: {
      list: () => http.request<{ key: string; description: string | null; enabled: boolean; rolloutPercentage: number }[]>('/api/v1/platform-admin/feature-flags'),
      set: (key: string, enabled: boolean, rolloutPercentage = 100) =>
        http.request<unknown>(`/api/v1/platform-admin/feature-flags/${encodeURIComponent(key)}`, { method: 'PUT', body: { enabled, rolloutPercentage } }),
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
