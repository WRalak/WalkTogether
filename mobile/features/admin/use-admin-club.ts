import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { api } from '@/services/api';

/** Permissions that only grant participation, not administration. */
const MEMBER_ONLY: string[] = ['club.view_private', 'members.view'];

/** True when a membership carries at least one administrative permission (owner, admin, organiser, moderator…). */
export function canAdminister(permissions: readonly string[]) {
  return permissions.some((p) => !MEMBER_ONLY.includes(p));
}

/**
 * The club being administered (`/admin/[clubId]/…`) with the caller's permissions *in that club*,
 * computed by the server. Hiding UI is a convenience only — the API enforces every permission and
 * tenant boundary on each request.
 */
export function useAdminClub() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const query = useQuery({ queryKey: ['admin-club', clubId], queryFn: () => api.clubs.get(clubId), enabled: !!clubId });
  const permissions = new Set(query.data?.viewer.permissions ?? []);
  return { clubId, club: query.data, ...query, can: (p: ClubPermissionKey) => permissions.has(p) };
}
