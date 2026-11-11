import { create } from 'zustand';
import type { MeUser } from '@walktogether/shared-types';
import { api, tokenStore } from '@/services/api';

type Status = 'booting' | 'signedOut' | 'signedIn';

interface AuthStore {
  status: Status;
  user: MeUser | null;
  /** Restore a session from the keystore on app start. */
  bootstrap: () => Promise<void>;
  /** Call after any successful sign-in/sign-up: tokens are already stored by the API client. */
  loadUser: () => Promise<void>;
  setUser: (u: MeUser) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: 'booting',
  user: null,
  bootstrap: async () => {
    try {
      if (!(await tokenStore.hasRefreshToken())) return set({ status: 'signedOut' });
      if (!(await api.http.refresh())) return set({ status: 'signedOut', user: null });
      await get().loadUser();
    } catch {
      set({ status: 'signedOut', user: null });
    }
  },
  loadUser: async () => {
    const user = await api.users.me();
    set({ user, status: 'signedIn' });
  },
  setUser: (user) => set({ user }),
  signOut: async () => {
    await api.auth.logout().catch(() => undefined);
    set({ status: 'signedOut', user: null });
  },
}));

// If the server revokes the session (logout elsewhere, suspension, token reuse), drop to signed-out.
tokenStore.onCleared(() => useAuthStore.setState({ status: 'signedOut', user: null }));
