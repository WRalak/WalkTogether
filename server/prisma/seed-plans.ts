import type { PlanAudience } from '@prisma/client';
import { prisma } from '../src/database/prisma';

/**
 * Creates the plan catalogue skeleton if missing. Only the FREE plans are active.
 * Paid plans are created INACTIVE with amount 0: platform admins set real prices and activate
 * them in the platform admin dashboard. Prices are never hardcoded in application code.
 */
const PLANS: { code: string; audience: PlanAudience; name: string; isDefault: boolean; isActive: boolean; sortOrder: number; ent: Record<string, number | boolean> }[] = [
  { code: 'club_free', audience: 'CLUB', name: 'Free Club', isDefault: true, isActive: true, sortOrder: 0, ent: { 'club.max_admins': 2, 'club.max_events_per_month': 4 } },
  {
    code: 'club_pro', audience: 'CLUB', name: 'Club Pro', isDefault: false, isActive: false, sortOrder: 10,
    ent: { 'club.max_admins': 10, 'club.max_events_per_month': 100, 'club.recurring_events': true, 'club.challenges': true, 'club.analytics_advanced': true, 'club.exports': true, 'club.custom_branding': true },
  },
  {
    code: 'club_enterprise', audience: 'CLUB', name: 'Club Enterprise', isDefault: false, isActive: false, sortOrder: 20,
    ent: { 'club.max_admins': 1000, 'club.max_events_per_month': 10000, 'club.recurring_events': true, 'club.challenges': true, 'club.analytics_advanced': true, 'club.exports': true, 'club.custom_branding': true, 'club.branches': true },
  },
  { code: 'individual_free', audience: 'INDIVIDUAL', name: 'WalkTogether Free', isDefault: true, isActive: true, sortOrder: 0, ent: {} },
  { code: 'premium_monthly', audience: 'INDIVIDUAL', name: 'WalkTogether Premium', isDefault: false, isActive: false, sortOrder: 10, ent: { 'user.advanced_analytics': true, 'user.activity_exports': true, 'user.premium_challenges': true } },
];

export async function seedPlans() {
  for (const p of PLANS) {
    if (await prisma.subscriptionPlan.findUnique({ where: { code: p.code } })) continue;
    await prisma.subscriptionPlan.create({
      data: {
        code: p.code, audience: p.audience, name: p.name, isDefault: p.isDefault, isActive: p.isActive, sortOrder: p.sortOrder, currency: 'KES', amountMinor: 0,
        entitlements: { create: Object.entries(p.ent).map(([key, v]) => (typeof v === 'number' ? { key, intLimit: v } : { key, boolValue: v })) },
      },
    });
  }
}
