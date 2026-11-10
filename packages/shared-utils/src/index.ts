/**
 * Small, dependency-free helpers shared by the mobile app, web apps and server.
 * Keep this package framework-agnostic (no React, no Node-only APIs).
 */

/** Amounts are stored in minor units (cents). `formatMoney(150000, 'KES')` → "KES 1,500". */
export function formatMoney(minor: number, currency: string, opts: { decimals?: boolean } = {}) {
  const value = minor / 100;
  const digits = opts.decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
  return `${currency} ${value.toLocaleString('en-KE', digits)}`;
}

/** Sums of several currencies, e.g. `{ KES: 150000, USD: 2000 }` → "KES 1,500 · USD 20". */
export function formatMoneyMap(totals: Record<string, number> | undefined | null) {
  if (!totals || !Object.keys(totals).length) return '—';
  return Object.entries(totals)
    .map(([currency, minor]) => formatMoney(minor, currency))
    .join(' · ');
}

/** Metres → kilometres string with sensible precision: 2 decimals under 10 km, 1 above. */
export function formatKm(metres: number) {
  return (metres / 1000).toFixed(metres < 10_000 ? 2 : 1);
}

/** "Nairobi Sunrise Walkers" → "NS"; "Amina" → "AM". */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
}

const CLUB_CATEGORIES: Record<string, string> = {
  WALKING: 'Walking',
  RUNNING: 'Running',
  HIKING: 'Hiking',
  MIXED_FITNESS: 'Mixed fitness',
  CORPORATE_WELLNESS: 'Corporate wellness',
  CHARITY: 'Charity',
  SCHOOL_UNIVERSITY: 'School / university',
  OTHER: 'Other',
};

export function categoryLabel(category: string) {
  return CLUB_CATEGORIES[category] ?? category;
}

export function activityTypeLabel(type: string) {
  return type === 'RUN' ? 'Run' : type === 'HIKE' ? 'Hike' : 'Walk';
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Compact relative time for feeds: "just now", "5m", "3h", then a date. */
export function timeAgo(iso: string | Date, now = Date.now()) {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const s = Math.floor((now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(t).toLocaleDateString();
}

/** Seconds → "1:05:09" or "5:09". */
export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Seconds per km → "6:05" (or "--:--" when unknown). */
export function formatPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
