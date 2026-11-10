/**
 * Club-level permissions. These are the atomic capabilities a club role can hold.
 * They are tenant-scoped: holding a permission in club A grants nothing in club B.
 */
export const CLUB_PERMISSIONS = [
  'club.view_private',
  'club.settings.update',
  'club.delete',
  'members.view',
  'members.approve',
  'members.invite',
  'members.remove',
  'members.suspend',
  'members.roles.assign',
  'roles.manage',
  'events.manage',
  'attendance.manage',
  'announcements.manage',
  'challenges.manage',
  'community.moderate',
  'analytics.view',
  'reports.export',
  'billing.view',
  'billing.manage',
] as const;

export type ClubPermissionKey = (typeof CLUB_PERMISSIONS)[number];

export const SYSTEM_CLUB_ROLES = ['OWNER', 'ADMIN', 'EVENT_ORGANIZER', 'MODERATOR', 'MEMBER'] as const;
export type SystemClubRole = (typeof SYSTEM_CLUB_ROLES)[number];

/** Default permission sets copied into each new club. Clubs may later customise non-owner roles. */
export const DEFAULT_CLUB_ROLE_PERMISSIONS: Record<SystemClubRole, readonly ClubPermissionKey[]> = {
  OWNER: CLUB_PERMISSIONS,
  ADMIN: CLUB_PERMISSIONS.filter((p) => p !== 'club.delete' && p !== 'billing.manage'),
  EVENT_ORGANIZER: ['club.view_private', 'members.view', 'events.manage', 'attendance.manage', 'announcements.manage'],
  MODERATOR: ['club.view_private', 'members.view', 'community.moderate', 'members.suspend'],
  MEMBER: ['club.view_private', 'members.view'],
};

export const SYSTEM_CLUB_ROLE_LABELS: Record<SystemClubRole, string> = {
  OWNER: 'Club Owner',
  ADMIN: 'Club Administrator',
  EVENT_ORGANIZER: 'Event Organizer',
  MODERATOR: 'Moderator',
  MEMBER: 'Member',
};

/** Platform (super-admin) permissions. Entirely separate namespace from club permissions. */
export const ADMIN_PERMISSIONS = [
  'platform.overview.view',
  'users.view',
  'users.suspend',
  'clubs.view',
  'clubs.suspend',
  'clubs.approve',
  'plans.manage',
  'billing.view',
  'sponsorships.manage',
  'moderation.manage',
  'settings.manage',
  'feature_flags.manage',
  'audit_logs.view',
  'admins.manage',
] as const;
export type AdminPermissionKey = (typeof ADMIN_PERMISSIONS)[number];

export const SYSTEM_ADMIN_ROLES = ['SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'MODERATOR'] as const;
export type SystemAdminRole = (typeof SYSTEM_ADMIN_ROLES)[number];

export const DEFAULT_ADMIN_ROLE_PERMISSIONS: Record<SystemAdminRole, readonly AdminPermissionKey[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  SUPPORT: ['platform.overview.view', 'users.view', 'users.suspend', 'clubs.view', 'audit_logs.view'],
  FINANCE: ['platform.overview.view', 'billing.view', 'plans.manage', 'sponsorships.manage', 'clubs.view'],
  MODERATOR: ['platform.overview.view', 'users.view', 'users.suspend', 'clubs.view', 'moderation.manage'],
};
