import type { ClubDetail, ClubSummary, PaginationMeta } from '@walktogether/shared-types';
import { siteConfig } from './config';

/**
 * Server-side data fetching for public pages. Only public, unauthenticated endpoints are used here,
 * so private club data can never leak into statically generated or cached HTML.
 */
async function get<T>(path: string, revalidate = 300): Promise<{ data: T; meta?: PaginationMeta } | null> {
  try {
    const res = await fetch(`${siteConfig.apiInternalUrl}${path}`, { next: { revalidate }, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as { data: T; meta?: PaginationMeta };
  } catch (err) {
    console.error('public API fetch failed', path, err instanceof Error ? err.message : err);
    throw err;
  }
}

export async function fetchClubs(params: { q?: string; category?: string; cursor?: string; countryCode?: string }) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  qs.set('limit', '24');
  const res = await get<ClubSummary[]>(`/api/v1/clubs?${qs.toString()}`, 60);
  return { items: res?.data ?? [], nextCursor: res?.meta?.nextCursor ?? null };
}

export async function fetchClub(slug: string) {
  const res = await get<ClubDetail & { latitude: number | null; longitude: number | null }>(`/api/v1/clubs/${encodeURIComponent(slug)}`, 120);
  return res?.data ?? null;
}

export interface PublicPlan {
  id: string;
  code: string;
  audience: 'CLUB' | 'INDIVIDUAL';
  name: string;
  description: string | null;
  currency: string;
  amountMinor: number;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
  isDefault: boolean;
}

/** Live plan catalogue: prices are configured by platform admins, never hardcoded in the site. */
export async function fetchPlans() {
  try {
    return (await get<PublicPlan[]>('/api/v1/subscriptions/plans', 300))?.data ?? [];
  } catch {
    return [];
  }
}
