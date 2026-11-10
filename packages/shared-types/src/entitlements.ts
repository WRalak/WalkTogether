/**
 * Plan entitlement keys. Values (limits/booleans) live in subscription_entitlements and are
 * managed by platform admins. These defaults apply only if no default plan is configured.
 */
export const ENTITLEMENTS = {
  // Club plans
  'club.max_admins': { audience: 'CLUB', kind: 'limit', fallback: 2, label: 'Administrators & organizers' },
  'club.max_events_per_month': { audience: 'CLUB', kind: 'limit', fallback: 4, label: 'Events per month' },
  'club.recurring_events': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'Recurring events' },
  'club.challenges': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'Club challenges' },
  'club.analytics_advanced': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'Advanced analytics' },
  'club.exports': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'CSV report exports' },
  'club.custom_branding': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'Custom branding' },
  'club.branches': { audience: 'CLUB', kind: 'flag', fallback: false, label: 'Branches / chapters' },
  // Individual plans
  'user.advanced_analytics': { audience: 'INDIVIDUAL', kind: 'flag', fallback: false, label: 'Advanced fitness analytics' },
  'user.activity_exports': { audience: 'INDIVIDUAL', kind: 'flag', fallback: false, label: 'Downloadable activity reports' },
  'user.premium_challenges': { audience: 'INDIVIDUAL', kind: 'flag', fallback: false, label: 'Premium challenges' },
} as const;

export type EntitlementKey = keyof typeof ENTITLEMENTS;
export type EntitlementValues = Partial<Record<EntitlementKey, number | boolean>>;
