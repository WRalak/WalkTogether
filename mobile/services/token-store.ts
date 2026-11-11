import type { TokenStore } from '@walktogether/api-client';
import { KEYS, secureStorage } from './secure-storage';

type Listener = () => void;

/**
 * Access token: memory only (short-lived). Refresh token: OS keystore.
 * `onCleared` listeners let the auth store react when the server ends the session.
 */
export function createNativeTokenStore(storage = secureStorage) {
  let accessToken: string | null = null;
  const listeners = new Set<Listener>();
  const store: TokenStore & { onCleared: (l: Listener) => () => void; hasRefreshToken: () => Promise<boolean> } = {
    getAccessToken: () => accessToken,
    getRefreshToken: () => storage.get(KEYS.refreshToken),
    async setTokens({ accessToken: a, refreshToken }) {
      accessToken = a;
      if (refreshToken) await storage.set(KEYS.refreshToken, refreshToken);
    },
    async clear() {
      accessToken = null;
      await storage.remove(KEYS.refreshToken);
      listeners.forEach((l) => l());
    },
    onCleared(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async hasRefreshToken() {
      return !!(await storage.get(KEYS.refreshToken));
    },
  };
  return store;
}
