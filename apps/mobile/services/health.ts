import { Platform } from 'react-native';
import { api } from './api';

/**
 * Step counts come ONLY from the phone's health platform (Android Health Connect / Apple HealthKit).
 * WalkTogether never estimates steps from GPS distance. Native modules are loaded lazily so the app
 * still runs where they are unavailable (e.g. Expo Go).
 */
export type HealthStatus = 'unavailable' | 'not_granted' | 'granted';

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    return d;
  });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function android() {
  const hc = await import('react-native-health-connect');
  return {
    async status(): Promise<HealthStatus> {
      const s = await hc.getSdkStatus();
      if (s !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';
      await hc.initialize();
      const granted = await hc.getGrantedPermissions();
      return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read') ? 'granted' : 'not_granted';
    },
    async request() {
      await hc.initialize();
      const r = await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
      return r.some((p) => p.recordType === 'Steps');
    },
    async readDaily(n: number) {
      const out: { day: string; steps: number }[] = [];
      for (const d of days(n)) {
        const end = new Date(d);
        end.setDate(end.getDate() + 1);
        // aggregateRecord de-duplicates overlapping sources (phone + watch) as Health Connect intends.
        const agg = await hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: d.toISOString(), endTime: end.toISOString() } });
        out.push({ day: ymd(d), steps: Math.round(agg.COUNT_TOTAL ?? 0) });
      }
      return { source: 'HEALTH_CONNECT' as const, days: out };
    },
  };
}

async function ios() {
  const hk = await import('@kingstinct/react-native-healthkit');
  return {
    async status(): Promise<HealthStatus> {
      if (!hk.isHealthDataAvailable()) return 'unavailable';
      // HealthKit never reveals whether read access was denied; we treat "asked" as granted.
      const s = await hk.getRequestStatusForAuthorization({ toRead: ['HKQuantityTypeIdentifierStepCount'] });
      return s === hk.AuthorizationRequestStatus.unnecessary ? 'granted' : 'not_granted';
    },
    async request() {
      return hk.requestAuthorization({ toRead: ['HKQuantityTypeIdentifierStepCount'] });
    },
    async readDaily(n: number) {
      const out: { day: string; steps: number }[] = [];
      for (const d of days(n)) {
        const end = new Date(d);
        end.setDate(end.getDate() + 1);
        const r = await hk.queryStatisticsForQuantity('HKQuantityTypeIdentifierStepCount', ['cumulativeSum'], { filter: { date: { startDate: d, endDate: end } } });
        out.push({ day: ymd(d), steps: Math.round(r.sumQuantity?.quantity ?? 0) });
      }
      return { source: 'HEALTHKIT' as const, days: out };
    },
  };
}

async function platform() {
  try {
    return Platform.OS === 'android' ? await android() : Platform.OS === 'ios' ? await ios() : null;
  } catch {
    return null; // native module not present (e.g. Expo Go)
  }
}

export async function healthStatus(): Promise<HealthStatus> {
  const p = await platform();
  if (!p) return 'unavailable';
  try {
    return await p.status();
  } catch {
    return 'unavailable';
  }
}

export async function connectHealth() {
  const p = await platform();
  if (!p) return false;
  const ok = await p.request();
  if (ok) await syncSteps();
  return ok;
}

/** Uploads the last 14 days of step totals (idempotent server-side upsert). */
export async function syncSteps() {
  const p = await platform();
  if (!p || (await p.status()) !== 'granted') return { synced: 0 };
  const { source, days: daily } = await p.readDaily(14);
  return api.activities.syncSteps({ source, days: daily });
}
