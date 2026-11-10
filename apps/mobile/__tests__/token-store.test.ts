import { createNativeTokenStore } from '@/services/token-store';

function memoryStorage() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), remove: async (k: string) => void m.delete(k), m };
}

describe('native token store', () => {
  it('keeps access token in memory and refresh token in secure storage', async () => {
    const storage = memoryStorage();
    const store = createNativeTokenStore(storage);
    await store.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    expect(store.getAccessToken()).toBe('a1');
    expect(await store.getRefreshToken!()).toBe('r1');
    expect([...storage.m.values()]).not.toContain('a1');
  });

  it('clearing removes the refresh token and notifies listeners', async () => {
    const storage = memoryStorage();
    const store = createNativeTokenStore(storage);
    const cleared = jest.fn();
    store.onCleared(cleared);
    await store.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    await store.clear();
    expect(await store.hasRefreshToken()).toBe(false);
    expect(store.getAccessToken()).toBeNull();
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
