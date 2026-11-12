import { Text, View } from 'react-native';
import { Stack, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { ErrorState, Loading, SectionTitle } from '@/components/ui';
import { NavRow, Notice, StatTile } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

type Section = { path: string; label: string; detail: string; permission: ClubPermissionKey };

// Sections are shown only when the viewer holds the permission; the API enforces each one anyway.
const SECTIONS: Section[] = [
  { path: 'members', label: 'Members', detail: 'Requests, roles, suspensions', permission: 'members.view' },
  { path: 'invitations', label: 'Invitations', detail: 'Invite codes and links', permission: 'members.invite' },
  { path: 'roles', label: 'Roles & ownership', detail: 'Custom roles, transfer ownership', permission: 'roles.manage' },
  { path: 'events', label: 'Events', detail: 'Create walks, RSVPs, QR check-in', permission: 'club.view_private' },
  { path: 'attendance', label: 'Attendance', detail: 'Check-ins per event', permission: 'analytics.view' },
  { path: 'activities', label: 'Shared activities', detail: 'Walks members shared with the club', permission: 'members.view' },
  { path: 'challenges', label: 'Challenges', detail: 'Club challenges and leaderboards', permission: 'club.view_private' },
  { path: 'announcements', label: 'Announcements', detail: 'Pinned club news', permission: 'club.view_private' },
  { path: 'analytics', label: 'Analytics', detail: 'Growth, engagement, exports', permission: 'analytics.view' },
  { path: 'moderation', label: 'Moderation', detail: 'Reported posts and comments', permission: 'community.moderate' },
  { path: 'sponsorships', label: 'Sponsorship offers', detail: 'Accept or decline event sponsors', permission: 'events.manage' },
  { path: 'subscription', label: 'Subscription', detail: 'Plan, payments, invoices', permission: 'billing.view' },
  { path: 'settings', label: 'Club settings', detail: 'Profile, visibility, logo and cover', permission: 'club.settings.update' },
];

export default function ClubAdminOverview() {
  const { clubId, club, isLoading, error, refetch, isRefetching, can } = useAdminClub();
  const overview = useQuery({ queryKey: ['club-overview', clubId], queryFn: () => api.reports.overview(clubId), enabled: !!club && can('analytics.view') });
  const pending = useQuery({
    queryKey: ['members', clubId, 'PENDING', ''],
    queryFn: () => api.clubs.members(clubId, { status: 'PENDING', limit: 100 }),
    enabled: !!club && can('members.approve'),
  });

  if (isLoading) return <Loading />;
  if (error || !club)
    return (
      <Screen edges={[]}>
        <ErrorState message={errorMessage(error, 'Club not found')} onRetry={() => void refetch()} />
      </Screen>
    );

  const o = overview.data;
  const pendingCount = pending.data?.items.length ?? 0;
  return (
    <Screen edges={[]} refreshing={isRefetching} onRefresh={() => void Promise.all([refetch(), overview.refetch(), pending.refetch()])}>
      <Stack.Screen options={{ title: club.name }} />
      <Text className="mb-3 text-sm text-ink-muted">Your role: {club.viewer.role}</Text>
      {club.status === 'PENDING_APPROVAL' && <Notice tone="info">This club is awaiting approval by the WalkTogether team. You can prepare everything in the meantime.</Notice>}
      {club.status === 'SUSPENDED' && <Notice>This club has been suspended by the platform. Contact support for details.</Notice>}
      <View className="flex-row flex-wrap gap-3">
        <StatTile label="Active members" value={club.memberCount} hint={o ? `${o.members.new30d} new in 30 days` : undefined} />
        {can('members.approve') && <StatTile label="Join requests" value={pending.isLoading ? '…' : pendingCount} />}
        {o && <StatTile label="Upcoming events" value={o.events.upcoming30d} hint="next 30 days" />}
        {o && <StatTile label="Attendance rate" value={o.events.attendanceRate != null ? `${o.events.attendanceRate}%` : '—'} hint={`${o.events.attendance30d} check-ins`} />}
        {o && <StatTile label="Engagement" value={`${o.members.engagementRate}%`} hint={`${o.members.engaged30d} active members`} />}
        {o && <StatTile label="Plan" value={o.plan.name ?? 'Free'} hint={o.plan.status.toLowerCase()} />}
      </View>
      <SectionTitle>Manage</SectionTitle>
      <View>
        {SECTIONS.filter((s) => can(s.permission)).map((s) => (
          <NavRow
            key={s.path}
            href={`/admin/${clubId}/${s.path}` as Href}
            label={s.label}
            detail={s.detail}
            badge={s.path === 'members' && pendingCount ? pendingCount : undefined}
          />
        ))}
      </View>
    </Screen>
  );
}
