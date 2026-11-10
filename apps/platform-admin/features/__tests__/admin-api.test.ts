import { describe, expect, it, vi } from 'vitest';
import { createAdminApi } from '@walktogether/api-client';

describe('admin api client', () => {
  it('stores tokens only after MFA verification, and targets the admin refresh endpoint', async () => {
    const calls: string[] = [];
    const tokens = { access: null as string | null };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/login')) return new Response(JSON.stringify({ data: { mfaToken: 'm'.repeat(30), mfaSetupRequired: false } }), { status: 200 });
      return new Response(JSON.stringify({ data: { accessToken: 'admin-access' } }), { status: 200 });
    });
    const api = createAdminApi({
      baseUrl: 'http://api.test',
      mode: 'web',
      fetchImpl: fetchImpl as typeof fetch,
      tokens: { getAccessToken: () => tokens.access, setTokens: (t) => void (tokens.access = t.accessToken), clear: () => void (tokens.access = null) },
    });
    const login = await api.auth.login('a@b.co', 'pw');
    expect(tokens.access).toBeNull();
    await api.auth.verifyMfa(login.mfaToken, '123456');
    expect(tokens.access).toBe('admin-access');
    await api.http.refresh();
    expect(calls.at(-1)).toBe('http://api.test/api/v1/platform-admin/auth/refresh');
  });
});
