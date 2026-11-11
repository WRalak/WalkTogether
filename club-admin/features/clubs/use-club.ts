'use client';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { api } from '@/lib/api';

/**
 * The club being managed is part of the URL (`/dashboard/<section>?club=<id>`), so links are shareable
 * and two tabs can manage two different clubs. It is only a selector: the server checks the caller's
 * membership and permissions in that club on every request, so a tampered id grants nothing.
 */
export function useClubId() {
  return useSearchParams().get('club') ?? '';
}

/** Builds a dashboard link for the active club, e.g. `clubHref('/members', { status: 'PENDING' })`. */
export function dashboardHref(clubId: string, path: string, extra: Record<string, string> = {}) {
  return `/dashboard${path}?${new URLSearchParams({ club: clubId, ...extra }).toString()}`;
}

export function useClubHref() {
  const clubId = useClubId();
  return (path: string, extra: Record<string, string> = {}) => dashboardHref(clubId, path, extra);
}

/** Club detail incl. the caller's permissions *in this club*, as computed by the server. */
export function useClub() {
  const clubId = useClubId();
  const query = useQuery({ queryKey: ['club', clubId], queryFn: () => api.clubs.get(clubId), enabled: !!clubId });
  const permissions = new Set(query.data?.viewer.permissions ?? []);
  return { clubId, ...query, can: (p: ClubPermissionKey) => permissions.has(p) };
}
