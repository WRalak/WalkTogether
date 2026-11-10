import { prisma } from '../../database/prisma';

/**
 * Typed accessors for super-admin-configurable platform settings, with safe defaults.
 * Values live in the platform_settings table and are editable from the platform admin.
 */
export const PLATFORM_SETTING_DEFAULTS = {
  'clubs.requireApproval': false,
  'clubs.maxOwnedPerUser': 5,
  'clubs.supportedCountries': ['KE', 'UG', 'TZ', 'RW'] as string[],
} as const;

export type PlatformSettingKey = keyof typeof PLATFORM_SETTING_DEFAULTS;

export async function getSetting<K extends PlatformSettingKey>(key: K): Promise<(typeof PLATFORM_SETTING_DEFAULTS)[K]> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return (row?.value as (typeof PLATFORM_SETTING_DEFAULTS)[K] | undefined) ?? PLATFORM_SETTING_DEFAULTS[key];
}
