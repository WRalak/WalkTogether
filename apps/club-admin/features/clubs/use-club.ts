'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { api } from '@/lib/api';

export function useClubId() {
  return useParams<{ clubId: string }>().clubId;
}

/** Club detail incl. the caller's permissions *in this club*, as computed by the server. */
export function useClub() {
  const clubId = useClubId();
  const query = useQuery({ queryKey: ['club', clubId], queryFn: () => api.clubs.get(clubId) });
  const permissions = new Set(query.data?.viewer.permissions ?? []);
  return { clubId, ...query, can: (p: ClubPermissionKey) => permissions.has(p) };
}
