'use client';
import { createMemberApi } from '@walktogether/api-client';

/** Browser client for the few unauthenticated actions the public site performs (email links). */
export const publicApi = createMemberApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  mode: 'web',
  tokens: { getAccessToken: () => null, setTokens: () => undefined, clear: () => undefined },
});
