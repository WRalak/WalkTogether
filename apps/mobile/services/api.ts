import { createMemberApi } from '@walktogether/api-client';
import { config } from './config';
import { createNativeTokenStore } from './token-store';

export const tokenStore = createNativeTokenStore();

export const api = createMemberApi({
  baseUrl: config.apiUrl,
  mode: 'native',
  tokens: tokenStore,
  timeoutMs: 20_000,
});
