import type { ClubPermissionKey } from '@walktogether/shared-types';

/** Human-readable labels for club permissions (role editor). */
export const PERMISSION_LABELS: Record<ClubPermissionKey, string> = {
  'club.view_private': 'See members-only content',
  'club.settings.update': 'Edit club profile & settings',
  'club.delete': 'Archive the club',
  'members.view': 'See member list',
  'members.approve': 'Approve join requests',
  'members.invite': 'Invite people',
  'members.remove': 'Remove / ban members',
  'members.suspend': 'Suspend members',
  'members.roles.assign': 'Assign roles',
  'roles.manage': 'Manage roles',
  'events.manage': 'Manage events',
  'attendance.manage': 'Manage attendance',
  'announcements.manage': 'Publish announcements',
  'challenges.manage': 'Manage challenges',
  'community.moderate': 'Moderate community',
  'analytics.view': 'View analytics',
  'reports.export': 'Export reports',
  'billing.view': 'View billing',
  'billing.manage': 'Manage billing',
};
