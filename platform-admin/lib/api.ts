'use client';
import { createAdminApi } from '@walktogether/api-client';

/** Admin access token lives in memory only; the refresh token is an httpOnly SameSite=Strict cookie. */
let accessToken: string | null = null;
const listeners = new Set<() => void>();

export const tokenStore = {
  getAccessToken: () => accessToken,
  setTokens: ({ accessToken: t }: { accessToken: string }) => {
    accessToken = t;
  },
  clear: () => {
    accessToken = null;
    listeners.forEach((l) => l());
  },
};

export function onSignedOut(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const adminApi = createAdminApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  mode: 'web',
  tokens: tokenStore,
  onSessionExpired: () => tokenStore.clear(),
});
