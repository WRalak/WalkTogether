/**
 * GPS module: storage and server-side validation of raw location points.
 *
 * Owns the partitioned `activity_gps_points` table. Activities call into this module; the client's
 * statistics are never trusted — distance, pace and route are recomputed here from stored points.
 */
import { Prisma, type ActivityType } from '@prisma/client';
import { computeStats, encodePolyline, simplify, type RawPoint } from '@walktogether/shared-utils';
import { prisma } from '../../database/prisma';
import { badRequest } from '../../shared/errors';

export const MAX_POINTS_PER_ACTIVITY = 50_000;

export interface IncomingPoint {
  seq: number;
  segment: number;
  t: number;
  lat: number;
  lng: number;
  accuracy?: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  speed?: number | null;
}

/** Stores a batch of points for a recording activity. Retries are idempotent (duplicate seq ignored). */
export async function ingestPoints(activity: { id: string; startedAt: Date; pointCount: number }, points: IncomingPoint[]) {
  if (activity.pointCount + points.length > MAX_POINTS_PER_ACTIVITY) throw badRequest('Too many points for one activity');
  const minT = activity.startedAt.getTime() - 10 * 60_000;
  const maxT = Date.now() + 2 * 60_000;
  const valid = points.filter((p) => p.t >= minT && p.t <= maxT);
  const res = await prisma.activityGpsPoint.createMany({
    data: valid.map((p) => ({
      activityId: activity.id,
      seq: p.seq,
      segment: p.segment,
      recordedAt: new Date(p.t),
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracy ?? null,
      altitudeM: p.altitude ?? null,
      altitudeAccuracyM: p.altitudeAccuracy ?? null,
      speedMps: p.speed ?? null,
    })),
    skipDuplicates: true,
  });
  if (res.count) await prisma.activity.update({ where: { id: activity.id }, data: { pointCount: { increment: res.count } } });
  return { accepted: res.count, ignored: points.length - res.count };
}

/** Loads stored points grouped into recording segments (pauses split segments). */
export async function loadSegments(activityId: string) {
  const rows = await prisma.activityGpsPoint.findMany({ where: { activityId }, orderBy: { seq: 'asc' } });
  const bySegment = new Map<number, RawPoint[]>();
  for (const r of rows) {
    const list = bySegment.get(r.segment) ?? [];
    list.push({ lat: r.lat, lng: r.lng, t: r.recordedAt.getTime(), accuracy: r.accuracyM, altitude: r.altitudeM, altitudeAccuracy: r.altitudeAccuracyM, speed: r.speedMps });
    bySegment.set(r.segment, list);
  }
  return { total: rows.length, segments: [...bySegment.entries()].sort((x, y) => x[0] - y[0]).map(([, pts]) => ({ points: pts })) };
}

/** Recomputes statistics and integrity flags from stored points. */
export async function analyseActivity(
  activity: { id: string; userId: string; type: ActivityType },
  input: { clientStats?: { distanceM: number; movingSeconds: number }; mockLocationDetected?: boolean },
) {
  const { total, segments } = await loadSegments(activity.id);
  const profile = await prisma.userProfile.findUnique({ where: { userId: activity.userId }, select: { weightKg: true } });
  const stats = computeStats(segments, activity.type, { weightKg: profile?.weightKg });

  const flags: Record<string, unknown> = {};
  if (stats.rejected.speed / (total || 1) > 0.1) flags.impossibleSpeed = stats.rejected.speed;
  if (input.mockLocationDetected) flags.mockLocation = true;
  if (input.clientStats && Math.abs(input.clientStats.distanceM - stats.distanceM) > Math.max(200, stats.distanceM * 0.25)) {
    flags.clientMismatch = { client: input.clientStats.distanceM, server: stats.distanceM };
  }
  if (stats.avgSpeedMps && stats.avgSpeedMps > (activity.type === 'RUN' ? 7 : 3.5)) flags.unrealisticAverageSpeed = stats.avgSpeedMps;

  const display = simplify(segments.flatMap((s) => s.points).map((p) => ({ lat: p.lat, lng: p.lng })), 4);
  return {
    stats,
    flags,
    flagged: Object.keys(flags).length > 0,
    display,
    routePolyline: display.length >= 2 ? encodePolyline(display) : null,
  };
}

/** Writes the simplified display route into the PostGIS `route` column (inside the caller's transaction). */
export async function storeRoute(tx: Prisma.TransactionClient, activityId: string, display: { lat: number; lng: number }[]) {
  if (display.length < 2) return;
  // WKT built from validated numbers only, passed as a bound parameter.
  const wkt = `LINESTRING(${display.map((p) => `${p.lng} ${p.lat}`).join(',')})`;
  await tx.$executeRaw`UPDATE activities SET route = ST_GeogFromText(${wkt}) WHERE id = ${activityId}::uuid`;
}
