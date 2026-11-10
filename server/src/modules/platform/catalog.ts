import { ADMIN_PERMISSIONS, CLUB_PERMISSIONS, DEFAULT_ADMIN_ROLE_PERMISSIONS, SYSTEM_ADMIN_ROLES } from '@walktogether/shared-types';
import { prisma } from '../../database/prisma';

const CLUB_PERMISSION_DESCRIPTIONS: Record<(typeof CLUB_PERMISSIONS)[number], string> = {
  'club.view_private': 'View members-only club content',
  'club.settings.update': 'Edit club profile and settings',
  'club.delete': 'Archive or delete the club',
  'members.view': 'View the member list',
  'members.approve': 'Approve or reject membership requests',
  'members.invite': 'Create and revoke invitations',
  'members.remove': 'Remove or ban members',
  'members.suspend': 'Suspend or reinstate members',
  'members.roles.assign': 'Assign roles to members',
  'roles.manage': 'Create and edit custom roles',
  'events.manage': 'Create and manage events',
  'attendance.manage': 'Record and edit attendance',
  'announcements.manage': 'Publish announcements',
  'challenges.manage': 'Create and manage club challenges',
  'community.moderate': 'Moderate club community content',
  'analytics.view': 'View club analytics',
  'reports.export': 'Export club reports',
  'billing.view': 'View club subscription and invoices',
  'billing.manage': 'Change club subscription and payment methods',
};

/**
 * Idempotently synchronises the permission catalogues and system admin roles with the code.
 * Runs on API start-up and from the seed script; safe to run concurrently.
 */
export async function syncPermissionCatalog() {
  for (const key of CLUB_PERMISSIONS) {
    await prisma.clubPermission.upsert({ where: { key }, create: { key, description: CLUB_PERMISSION_DESCRIPTIONS[key] }, update: { description: CLUB_PERMISSION_DESCRIPTIONS[key] } });
  }
  for (const key of ADMIN_PERMISSIONS) {
    const description = key.replace(/[._]/g, ' ');
    await prisma.adminPermission.upsert({ where: { key }, create: { key, description }, update: {} });
  }
  for (const roleKey of SYSTEM_ADMIN_ROLES) {
    const name = roleKey.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
    const role = await prisma.adminRole.upsert({ where: { key: roleKey }, create: { key: roleKey, name }, update: {} });
    await prisma.adminRolePermission.createMany({
      data: DEFAULT_ADMIN_ROLE_PERMISSIONS[roleKey].map((permissionKey) => ({ roleId: role.id, permissionKey })),
      skipDuplicates: true,
    });
    if (roleKey === 'SUPER_ADMIN') continue;
    // Non-super roles are kept exactly in sync with the code-defined defaults.
    await prisma.adminRolePermission.deleteMany({ where: { roleId: role.id, permissionKey: { notIn: [...DEFAULT_ADMIN_ROLE_PERMISSIONS[roleKey]] } } });
  }
}
