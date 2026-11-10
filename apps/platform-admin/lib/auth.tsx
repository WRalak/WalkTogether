'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminMe } from '@walktogether/api-client';
import { adminApi, onSignedOut } from './api';

interface AdminAuth {
  status: 'loading' | 'authenticated' | 'anonymous';
  me: AdminMe | null;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AdminAuth | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AdminAuth['status']>('loading');
  const [me, setMe] = useState<AdminMe | null>(null);

  const reload = useCallback(async () => {
    try {
      setMe(await adminApi.me());
      setStatus('authenticated');
    } catch {
      setMe(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    adminApi.http.refresh().then((ok) => (ok ? reload() : setStatus('anonymous')));
    return onSignedOut(() => {
      setMe(null);
      setStatus('anonymous');
      qc.clear();
    });
  }, [reload, qc]);

  const value: AdminAuth = {
    status,
    me,
    can: (p) => !!me?.permissions.includes(p),
    reload,
    signOut: async () => {
      await adminApi.auth.logout().catch(() => undefined);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return v;
}
