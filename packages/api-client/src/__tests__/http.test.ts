import { describe, expect, it, vi } from 'vitest';
import { ApiError, HttpClient, type TokenStore } from '../http';

function memoryStore(access: string | null, refresh: string | null): TokenStore & { state: { access: string | null; refresh: string | null } } {
  const state = { access, refresh };
  return {
    state,
    getAccessToken: () => state.access,
    getRefreshToken: () => state.refresh,
    setTokens: (t) => {
      state.access = t.accessToken;
      if (t.refreshToken) state.refresh = t.refreshToken;
    },
    clear: () => {
      state.access = null;
      state.refresh = null;
    },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpClient', () => {
  it('refreshes once for concurrent 401s and retries', async () => {
    const store = memoryStore('old', 'r1');
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshCalls++;
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'r1' });
        return json(200, { data: { accessToken: 'new', refreshToken: 'r2' } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { data: { ok: true } }) : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    });
    const client = new HttpClient({ baseUrl: 'http://api.test', mode: 'native', tokens: store, refreshPath: '/api/v1/auth/refresh', fetchImpl: fetchImpl as typeof fetch });
    const results = await Promise.all([client.request('/a'), client.request('/b'), client.request('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(store.state).toEqual({ access: 'new', refresh: 'r2' });
  });

  it('clears tokens and signals expiry when refresh fails', async () => {
    const store = memoryStore('old', 'r1');
    const onSessionExpired = vi.fn();
    const fetchImpl = vi.fn(async () => json(401, { error: { code: 'SESSION_EXPIRED', message: 'no' } }));
    const client = new HttpClient({ baseUrl: 'http://api.test', mode: 'native', tokens: store, refreshPath: '/r', fetchImpl: fetchImpl as typeof fetch, onSessionExpired });
    await expect(client.request('/a')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalled();
    expect(store.state.access).toBeNull();
  });

  it('web mode sends the client header and includes credentials', async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['X-WT-Client']).toBe('web');
      expect(init?.credentials).toBe('include');
      return json(200, { data: [1], meta: { nextCursor: 'abc', limit: 1 } });
    });
    const client = new HttpClient({ baseUrl: 'http://api.test', mode: 'web', tokens: memoryStore(null, null), refreshPath: '/r', fetchImpl: fetchImpl as typeof fetch });
    const page = await client.page<number>('/list', { query: { q: 'x', empty: undefined } });
    expect(page).toEqual({ items: [1], meta: { nextCursor: 'abc', limit: 1 } });
  });

  it('maps error envelopes to ApiError', async () => {
    const fetchImpl = vi.fn(async () => json(409, { error: { code: 'SLUG_TAKEN', message: 'taken', requestId: 'r' } }));
    const client = new HttpClient({ baseUrl: 'http://api.test', mode: 'native', tokens: memoryStore('a', 'b'), refreshPath: '/r', fetchImpl: fetchImpl as typeof fetch });
    await expect(client.request('/x', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409, code: 'SLUG_TAKEN', requestId: 'r' });
  });
});
