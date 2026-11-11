import { checkPoint, type ActivityKind, type RawPoint, type RejectReason } from './filter';
import { haversine } from './geo';

export interface Segment {
  /** points of one recording segment (pauses split segments) */
  points: RawPoint[];
}

export interface ActivityStats {
  distanceM: number;
  movingSeconds: number;
  elapsedSeconds: number;
  avgPaceSecPerKm: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  elevationGainM: number | null;
  caloriesEstimate: number | null;
  acceptedPoints: number;
  rejected: Record<RejectReason, number>;
}

export const SPEED_REANCHOR_STREAK = 5;
const ELEVATION_HYSTERESIS_M = 3;
const MAX_ALT_ACCURACY_M = 15;
/** Approximate MET values (Compendium of Physical Activities). */
const MET: Record<ActivityKind, number> = { WALK: 3.5, HIKE: 6.0, RUN: 9.8 };

/** Filters raw points; segments keep pauses out of distance and moving time. */
export function filterSegments(segments: Segment[], kind: ActivityKind, now = Date.now()) {
  const rejected: Record<RejectReason, number> = { invalid: 0, inaccurate: 0, duplicate: 0, time: 0, speed: 0 };
  let prevAccepted: RawPoint | undefined;
  const out: RawPoint[][] = [];
  for (const seg of segments) {
    // Each segment (pause/resume) starts fresh: the paused gap never counts.
    prevAccepted = undefined;
    let acc: RawPoint[] = [];
    let speedStreak = 0;
    for (const p of seg.points) {
      const reason = checkPoint(p, prevAccepted, kind, now);
      if (reason) {
        rejected[reason]++;
        speedStreak = reason === 'speed' ? speedStreak + 1 : speedStreak;
        // A sustained "jump" (e.g. after a tunnel or cold GPS start) re-anchors as a new
        // segment instead of rejecting the rest of the activity; the gap is not counted.
        if (speedStreak >= SPEED_REANCHOR_STREAK) {
          if (acc.length) out.push(acc);
          acc = [p];
          prevAccepted = p;
          speedStreak = 0;
        }
        continue;
      }
      speedStreak = 0;
      acc.push(p);
      prevAccepted = p;
    }
    if (acc.length) out.push(acc);
  }
  return { segments: out, rejected };
}

/**
 * Computes statistics from filtered segments. Distance ignores sub-accuracy jitter while
 * stationary (GPS drift). Elevation is only reported when altitude accuracy is available.
 */
export function computeStats(segments: Segment[], kind: ActivityKind, opts: { weightKg?: number | null; now?: number } = {}): ActivityStats {
  const { segments: segs, rejected } = filterSegments(segments, kind, opts.now);
  let distanceM = 0;
  let movingSeconds = 0;
  let maxSpeed = 0;
  let accepted = 0;
  let gain = 0;
  let altSamples = 0;
  for (const seg of segs) {
    accepted += seg.length;
    let anchor = seg[0]!;
    let altBase: number | null = null;
    for (let i = 1; i < seg.length; i++) {
      const p = seg[i]!;
      const d = haversine(anchor, p);
      const dt = (p.t - anchor.t) / 1000;
      const jitter = Math.max(3, Math.min(anchor.accuracy ?? 5, p.accuracy ?? 5));
      if (d >= jitter) {
        distanceM += d;
        movingSeconds += dt;
        if (dt >= 2) maxSpeed = Math.max(maxSpeed, d / dt);
        anchor = p;
      } else if (dt > 30) {
        // stationary for a while: move the anchor without adding distance/moving time
        anchor = p;
      }
    }
    for (const p of seg) {
      if (p.altitude == null || p.altitudeAccuracy == null || p.altitudeAccuracy > MAX_ALT_ACCURACY_M) continue;
      altSamples++;
      if (altBase === null) altBase = p.altitude;
      else if (p.altitude - altBase >= ELEVATION_HYSTERESIS_M) {
        gain += p.altitude - altBase;
        altBase = p.altitude;
      } else if (altBase - p.altitude >= ELEVATION_HYSTERESIS_M) altBase = p.altitude;
    }
  }
  const all = segs.flat();
  const elapsedSeconds = all.length ? Math.round((all[all.length - 1]!.t - all[0]!.t) / 1000) : 0;
  movingSeconds = Math.round(movingSeconds);
  const km = distanceM / 1000;
  const weight = opts.weightKg && opts.weightKg > 20 && opts.weightKg < 300 ? opts.weightKg : 70;
  return {
    distanceM: Math.round(distanceM * 10) / 10,
    movingSeconds,
    elapsedSeconds,
    avgPaceSecPerKm: km >= 0.05 ? Math.round(movingSeconds / km) : null,
    avgSpeedMps: movingSeconds > 0 ? Math.round((distanceM / movingSeconds) * 100) / 100 : null,
    maxSpeedMps: maxSpeed > 0 ? Math.round(maxSpeed * 100) / 100 : null,
    elevationGainM: altSamples >= 10 ? Math.round(gain) : null,
    // Estimate only — never presented as a medical measurement.
    caloriesEstimate: movingSeconds > 0 ? Math.round(MET[kind] * weight * (movingSeconds / 3600)) : null,
    acceptedPoints: accepted,
    rejected,
  };
}

/** Current pace over the trailing window (sec/km), for live display. */
export function rollingPace(points: RawPoint[], windowSec = 45): number | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1]!;
  let d = 0;
  let i = points.length - 1;
  while (i > 0 && (end.t - points[i - 1]!.t) / 1000 <= windowSec) {
    d += haversine(points[i - 1]!, points[i]!);
    i--;
  }
  const dt = (end.t - points[i]!.t) / 1000;
  if (d < 10 || dt <= 0) return null;
  return Math.round(dt / (d / 1000));
}


