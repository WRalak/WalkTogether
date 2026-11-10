import { Prisma, type ActivityType } from '@prisma/client';
import { computeStats, decodePolyline, encodePolyline, privateDisplayRoute, simplify, type RawPoint } from '@walktogether/gps';
import { prisma } from '../../database/prisma';
import { enqueue } from '../../queues';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { logger } from '../../shared/logger';
import { canViewActivity } from './visibility';

const MAX_POINTS_PER_ACTIVITY = 50_000;

type Vis = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';

export async function createActivity(userId: string, input: { clientId: string; type: ActivityType; startedAt: Date; visibility?: Vis; title?: string }) {
  if (input.startedAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('startedAt is in the future');
  const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId } });
  // Idempotent: retries with the same clientId return the same activity.
  const activity = await prisma.activity.upsert({
    where: { userId_clientId: { userId, clientId: input.clientId } },
    create: { userId, clientId: input.clientId, type: input.type, startedAt: input.startedAt, title: input.title, visibility: input.visibility ?? privacy?.activityDefaultVisibility ?? 'FOLLOWERS' },
    update: {},
  });
  return serializeOwn(activity);
}

async function ownActivity(userId: string, id: string) {
  const a = await prisma.activity.findFirst({ where: { id, userId } });
  if (!a) throw notFound('Activity not found');
  return a;
}

export async function addPoints(userId: string, id: string, points: { seq: number; segment: number; t: number; lat: number; lng: number; accuracy?: number | null; altitude?: number | null; altitudeAccuracy?: number | null; speed?: number | null }[]) {
  const a = await ownActivity(userId, id);
  if (a.status !== 'RECORDING') throw conflict('Activity is already completed', 'ACTIVITY_CLOSED');
  if (a.pointCount + points.length > MAX_POINTS_PER_ACTIVITY) throw badRequest('Too many points for one activity');
  const minT = a.startedAt.getTime() - 10 * 60_000;
  const maxT = Date.now() + 2 * 60_000;
  const valid = points.filter((p) => p.t >= minT && p.t <= maxT);
  // Duplicate seq from retries are ignored (ON CONFLICT DO NOTHING).
  const res = await prisma.activityGpsPoint.createMany({
    data: valid.map((p) => ({ activityId: id, seq: p.seq, segment: p.segment, recordedAt: new Date(p.t), lat: p.lat, lng: p.lng, accuracyM: p.accuracy ?? null, altitudeM: p.altitude ?? null, altitudeAccuracyM: p.altitudeAccuracy ?? null, speedMps: p.speed ?? null })),
    skipDuplicates: true,
  });
  if (res.count) await prisma.activity.update({ where: { id }, data: { pointCount: { increment: res.count } } });
  return { accepted: res.count, ignored: points.length - res.count };
}

async function assertShareableClubs(userId: string, clubIds: string[]) {
  if (!clubIds.length) return;
  const n = await prisma.clubMembership.count({ where: { userId, status: 'ACTIVE', clubId: { in: clubIds }, club: { status: 'ACTIVE' } } });
  if (n !== new Set(clubIds).size) throw forbidden('You can only share activities with clubs you are an active member of', 'NOT_A_MEMBER');
}

/** Authoritative recomputation from stored points. Client statistics are only compared, never trusted. */
export async function completeActivity(
  userId: string,
  id: string,
  input: { endedAt: Date; title?: string | null; notes?: string | null; visibility?: Vis; clubIds?: string[]; clientStats?: { distanceM: number; movingSeconds: number }; mockLocationDetected?: boolean },
) {
  const a = await ownActivity(userId, id);
  if (a.status === 'COMPLETED') return getActivity(id, userId); // idempotent retry
  if (a.status !== 'RECORDING') throw conflict('Activity was discarded', 'ACTIVITY_CLOSED');
  if (input.clubIds) await assertShareableClubs(userId, input.clubIds);

  const rows = await prisma.activityGpsPoint.findMany({ where: { activityId: id }, orderBy: { seq: 'asc' } });
  const bySegment = new Map<number, RawPoint[]>();
  for (const r of rows) {
    const list = bySegment.get(r.segment) ?? [];
    list.push({ lat: r.lat, lng: r.lng, t: r.recordedAt.getTime(), accuracy: r.accuracyM, altitude: r.altitudeM, altitudeAccuracy: r.altitudeAccuracyM, speed: r.speedMps });
    bySegment.set(r.segment, list);
  }
  const segments = [...bySegment.entries()].sort((x, y) => x[0] - y[0]).map(([, points]) => ({ points }));
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { weightKg: true } });
  const stats = computeStats(segments, a.type, { weightKg: profile?.weightKg });

  const flags: Record<string, unknown> = {};
  const total = rows.length || 1;
  if (stats.rejected.speed / total > 0.1) flags.impossibleSpeed = stats.rejected.speed;
  if (input.mockLocationDetected) flags.mockLocation = true;
  if (input.clientStats && Math.abs(input.clientStats.distanceM - stats.distanceM) > Math.max(200, stats.distanceM * 0.25)) {
    flags.clientMismatch = { client: input.clientStats.distanceM, server: stats.distanceM };
  }
  if (stats.avgSpeedMps && stats.avgSpeedMps > (a.type === 'RUN' ? 7 : 3.5)) flags.unrealisticAverageSpeed = stats.avgSpeedMps;
  const flagged = Object.keys(flags).length > 0;

  const accepted = segments.flatMap((s) => s.points);
  const display = simplify(accepted.map((p) => ({ lat: p.lat, lng: p.lng })), 4);
  await prisma.$transaction(async (tx) => {
    await tx.activity.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        endedAt: input.endedAt,
        title: input.title ?? a.title,
        notes: input.notes ?? a.notes,
        visibility: input.visibility ?? a.visibility,
        distanceM: stats.distanceM,
        movingSeconds: stats.movingSeconds,
        elapsedSeconds: Math.max(stats.elapsedSeconds, Math.round((input.endedAt.getTime() - a.startedAt.getTime()) / 1000)),
        avgPaceSecPerKm: stats.avgPaceSecPerKm,
        avgSpeedMps: stats.avgSpeedMps,
        maxSpeedMps: stats.maxSpeedMps,
        elevationGainM: stats.elevationGainM,
        caloriesEstimate: stats.caloriesEstimate,
        routePolyline: display.length >= 2 ? encodePolyline(display) : null,
        flagged,
        flags: { ...flags, rejected: stats.rejected } as Prisma.InputJsonValue,
        clientStats: (input.clientStats ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
    if (display.length >= 2) {
      // WKT built from validated numbers only, passed as a bound parameter.
      const wkt = `LINESTRING(${display.map((p) => `${p.lng} ${p.lat}`).join(',')})`;
      await tx.$executeRaw`UPDATE activities SET route = ST_GeogFromText(${wkt}) WHERE id = ${id}::uuid`;
    }
    if (input.clubIds?.length) await tx.activityClubShare.createMany({ data: input.clubIds.map((clubId) => ({ activityId: id, clubId })), skipDuplicates: true });
  });
  await enqueue('activity.completed', { activityId: id }).catch((err) => logger.error({ err }, 'failed to enqueue activity.completed'));
  return getActivity(id, userId);
}

export async function discardActivity(userId: string, id: string) {
  const a = await ownActivity(userId, id);
  if (a.status === 'COMPLETED') throw conflict('Delete completed activities instead', 'ACTIVITY_CLOSED');
  await prisma.activity.delete({ where: { id: a.id } });
}

export async function updateActivity(userId: string, id: string, input: { title?: string | null; notes?: string | null; visibility?: Vis; clubIds?: string[] }) {
  await ownActivity(userId, id);
  const { clubIds, ...fields } = input;
  if (clubIds) await assertShareableClubs(userId, clubIds);
  await prisma.$transaction(async (tx) => {
    await tx.activity.update({ where: { id }, data: fields });
    if (clubIds) {
      await tx.activityClubShare.deleteMany({ where: { activityId: id, clubId: { notIn: clubIds } } });
      await tx.activityClubShare.createMany({ data: clubIds.map((clubId) => ({ activityId: id, clubId })), skipDuplicates: true });
    }
  });
  return getActivity(id, userId);
}

export async function deleteActivity(userId: string, id: string) {
  const a = await ownActivity(userId, id);
  await prisma.activity.delete({ where: { id: a.id } }); // cascades points and shares
  await enqueue('activity.deleted', { userId, activityId: id, type: a.type }).catch(() => undefined);
}

type ActivityRow = Prisma.ActivityGetPayload<object>;

function serializeOwn(a: ActivityRow) {
  const { route: _r, clientStats: _c, ...rest } = a as ActivityRow & { route?: unknown };
  return rest;
}

/** Public shape for non-owners: no anti-cheat internals, privacy-trimmed route. */
async function serializeForViewer(a: ActivityRow & { clubShares?: { clubId: string }[] }, viewerId: string | undefined) {
  if (viewerId === a.userId) return { ...serializeOwn(a), clubIds: a.clubShares?.map((s) => s.clubId) ?? [] };
  const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId: a.userId } });
  let polyline = a.routePolyline;
  if (polyline) {
    const radius = privacy?.hideStartEndPoints === false ? 0 : (privacy?.privacyZoneRadiusMeters ?? 200);
    const trimmed = privateDisplayRoute(decodePolyline(polyline), radius);
    polyline = trimmed.length >= 2 ? encodePolyline(trimmed) : null;
  }
  return {
    id: a.id,
    userId: a.userId,
    type: a.type,
    title: a.title,
    notes: a.notes,
    visibility: a.visibility,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    distanceM: a.distanceM,
    movingSeconds: a.movingSeconds,
    elapsedSeconds: a.elapsedSeconds,
    avgPaceSecPerKm: a.avgPaceSecPerKm,
    avgSpeedMps: a.avgSpeedMps,
    maxSpeedMps: a.maxSpeedMps,
    elevationGainM: a.elevationGainM,
    routePolyline: polyline,
  };
}

export async function getActivity(id: string, viewerId: string | undefined) {
  const a = await prisma.activity.findUnique({ where: { id }, include: { clubShares: { select: { clubId: true } } } });
  // Not visible == not found (no existence leaks).
  if (!a || !(await canViewActivity(a, viewerId))) throw notFound('Activity not found');
  return serializeForViewer(a, viewerId);
}

export async function listMyActivities(userId: string, q: { cursor?: string; limit: number; type?: ActivityType; from?: Date; to?: Date }) {
  const cursor = decodeCursor(q.cursor);
  const rows = await prisma.activity.findMany({
    where: {
      userId,
      status: 'COMPLETED',
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to ? { startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(cursor ? { OR: [{ startedAt: { lt: cursor.createdAt } }, { startedAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items: items.map(serializeOwn), nextCursor: hasMore && last ? encodeCursor({ createdAt: last.startedAt, id: last.id }) : null };
}

/** Another user's activities, filtered by what the viewer may see. */
export async function listUserActivities(ownerId: string, viewerId: string | undefined, q: { cursor?: string; limit: number }) {
  if (ownerId === viewerId) return listMyActivities(ownerId, q);
  const cursor = decodeCursor(q.cursor);
  const out: Awaited<ReturnType<typeof serializeForViewer>>[] = [];
  let scanCursor = cursor;
  let nextCursor: string | null = null;
  // Scan in pages so visibility checks never load a whole history into memory.
  for (let guard = 0; guard < 5 && out.length < q.limit; guard++) {
    const rows = await prisma.activity.findMany({
      where: { userId: ownerId, status: 'COMPLETED', visibility: { not: 'PRIVATE' }, ...(scanCursor ? { OR: [{ startedAt: { lt: scanCursor.createdAt } }, { startedAt: scanCursor.createdAt, id: { lt: scanCursor.id } }] } : {}) },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: q.limit * 2,
    });
    if (!rows.length) {
      nextCursor = null;
      break;
    }
    for (const r of rows) {
      scanCursor = { createdAt: r.startedAt, id: r.id };
      if (await canViewActivity(r, viewerId)) out.push(await serializeForViewer(r, viewerId));
      if (out.length >= q.limit) break;
    }
    nextCursor = rows.length === q.limit * 2 || out.length >= q.limit ? encodeCursor(scanCursor!) : null;
    if (rows.length < q.limit * 2) break;
  }
  return { items: out, nextCursor };
}

/** GPX export for the owner (premium entitlement checked by the route). */
export async function exportGpx(userId: string, id: string) {
  const a = await ownActivity(userId, id);
  const pts = await prisma.activityGpsPoint.findMany({ where: { activityId: id }, orderBy: { seq: 'asc' } });
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const trkpts = pts.map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}">${p.altitudeM != null ? `<ele>${p.altitudeM}</ele>` : ''}<time>${p.recordedAt.toISOString()}</time></trkpt>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="WalkTogether" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(a.title ?? `${a.type} ${a.startedAt.toISOString()}`)}</name><trkseg>${trkpts}</trkseg></trk></gpx>`;
}
