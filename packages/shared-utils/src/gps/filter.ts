import { haversine, isValidCoordinate } from './geo';

export type ActivityKind = 'WALK' | 'RUN' | 'HIKE';

export interface RawPoint {
  lat: number;
  lng: number;
  /** epoch milliseconds */
  t: number;
  accuracy?: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  speed?: number | null;
}

export type RejectReason = 'invalid' | 'inaccurate' | 'duplicate' | 'time' | 'speed';

/** Shared filtering rules (client and server) — see docs/architecture/GPS_TRACKING_DESIGN.md. */
export const FILTER_RULES: Record<ActivityKind, { maxAccuracyM: number; maxSpeedMps: number }> = {
  WALK: { maxAccuracyM: 30, maxSpeedMps: 7 },
  HIKE: { maxAccuracyM: 35, maxSpeedMps: 7 },
  RUN: { maxAccuracyM: 25, maxSpeedMps: 12 },
};

const FUTURE_SKEW_MS = 2 * 60_000;

/**
 * Decides whether `p` should be accepted after `prev` (the last *accepted* point).
 * Returns null when accepted, or the rejection reason.
 */
export function checkPoint(p: RawPoint, prev: RawPoint | undefined, kind: ActivityKind, now = Date.now()): RejectReason | null {
  const rules = FILTER_RULES[kind];
  if (!isValidCoordinate(p) || !Number.isFinite(p.t)) return 'invalid';
  if (p.t > now + FUTURE_SKEW_MS) return 'time';
  if (p.accuracy != null && p.accuracy > rules.maxAccuracyM) return 'inaccurate';
  if (!prev) return null;
  if (p.t <= prev.t) return p.t === prev.t ? 'duplicate' : 'time';
  const d = haversine(prev, p);
  const dt = (p.t - prev.t) / 1000;
  if (d < 1 && dt < 1) return 'duplicate';
  // Allow for the combined position uncertainty before declaring a speed impossible.
  const slack = Math.max(0, d - (prev.accuracy ?? 0) - (p.accuracy ?? 0));
  if (slack / dt > rules.maxSpeedMps) return 'speed';
  return null;
}
