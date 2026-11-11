'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MeUser } from '@walktogether/shared-types';
import { api, onSignedOut } from './api';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: MeUser | null;
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<MeUser | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.users.me());
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    // Restore the session from the httpOnly refresh cookie.
    api.http.refresh().then((ok) => (ok ? refreshUser() : setStatus('anonymous')));
    return onSignedOut(() => {
      setUser(null);
      setStatus('anonymous');
      qc.clear();
    });
  }, [refreshUser, qc]);

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
  }, []);

  return <AuthContext.Provider value={{ status, user, refreshUser, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
