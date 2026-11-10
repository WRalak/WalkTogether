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
  users: { total: number; active30d: number; new7d: number; suspended: number };
  clubs: { total: number; active: number; pendingApproval: number; suspended: number };
  memberships: { active: number };
  generatedAt: string;
}

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
