'use client';
import { createMemberApi } from '@walktogether/api-client';

/**
 * Access token lives only in memory; the refresh token is an httpOnly, SameSite=Strict cookie
 * set by the API (X-WT-Client: web). Nothing sensitive is stored in localStorage.
 */
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

export const onSignedOut = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const api = createMemberApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  mode: 'web',
  tokens: tokenStore,
  onSessionExpired: () => tokenStore.clear(),
});
