import { createHmac } from 'node:crypto';
import { Prisma, type EventType } from '@prisma/client';
import { haversine } from '@walktogether/shared-utils';
import { prisma, type Tx } from '../../database/prisma';
import { randomToken, safeEqual } from '../../shared/crypto';
import { enqueue } from '../../queues';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { canSeeClub, loadClubAccess, requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';
import { requireFeature, requireWithinLimit } from '../subscriptions/entitlements.service';

const MIN = 60_000;
const CODE_WINDOW_MS = 60_000;
const CHECK_IN_EARLY_MS = 60 * MIN;
const CHECK_IN_LATE_MS = 60 * MIN;

export interface EventInput {
  title: string;
  description?: string | null;
  type: EventType;
  visibility: 'PUBLIC' | 'MEMBERS';
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  meetingPoint: string;
  meetingLat?: number | null;
  meetingLng?: number | null;
  routeDescription?: string | null;
  distanceM?: number | null;
  difficulty: 'EASY' | 'MODERATE' | 'HARD';
  maxParticipants?: number | null;
  registrationClosesAt?: Date | null;
  coverUrl?: string | null;
  recurrence?: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; count: number };
}

function occurrences(start: Date, end: Date, r?: EventInput['recurrence']) {
  const out = [{ startsAt: start, endsAt: end }];
  if (!r) return out;
  const dur = end.getTime() - start.getTime();
  for (let i = 1; i < r.count; i++) {
    const s = new Date(start);
    if (r.frequency === 'DAILY') s.setUTCDate(s.getUTCDate() + i * r.interval);
    else if (r.frequency === 'WEEKLY') s.setUTCDate(s.getUTCDate() + 7 * i * r.interval);
    else s.setUTCMonth(s.getUTCMonth() + i * r.interval);
    out.push({ startsAt: s, endsAt: new Date(s.getTime() + dur) });
  }
  return out;
}

async function setMeetingLocation(tx: Tx, ids: string[], lat?: number | null, lng?: number | null) {
  if (lat === undefined && lng === undefined) return;
  if (lat == null || lng == null) await tx.$executeRaw`UPDATE events SET meeting_location = NULL WHERE id = ANY(${ids}::uuid[])`;
  else await tx.$executeRaw`UPDATE events SET meeting_location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography WHERE id = ANY(${ids}::uuid[])`;
}

async function assertMonthlyLimit(clubId: string, dates: Date[]) {
  const months = new Map<string, number>();
  for (const d of dates) months.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, (months.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`) ?? 0) + 1);
  for (const [key, adding] of months) {
    const [y, m] = key.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m, 1));
    const to = new Date(Date.UTC(y, m + 1, 1));
    const existing = await prisma.event.count({ where: { clubId, startsAt: { gte: from, lt: to }, status: 'SCHEDULED' } });
    await requireWithinLimit({ clubId }, 'club.max_events_per_month', existing + adding - 1);
  }
}

export async function createEvent(clubId: string, actorId: string, input: EventInput, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'events.manage');
  if (input.startsAt.getTime() < Date.now() - 60 * MIN) throw badRequest('Events cannot start in the past');
  if (input.recurrence) await requireFeature({ clubId }, 'club.recurring_events');
  const dates = occurrences(input.startsAt, input.endsAt, input.recurrence);
  await assertMonthlyLimit(
    clubId,
    dates.map((d) => d.startsAt),
  );
  const { recurrence, ...fields } = input;
  const seriesId = recurrence ? crypto.randomUUID() : null;
  const ids = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const d of dates) {
      const closeOffset = input.registrationClosesAt ? input.startsAt.getTime() - input.registrationClosesAt.getTime() : null;
      const e = await tx.event.create({
        data: {
          ...fields,
          ...d,
          clubId,
          createdById: actorId,
          seriesId,
          checkInSecret: randomToken(24),
          registrationClosesAt: closeOffset != null ? new Date(d.startsAt.getTime() - closeOffset) : null,
        },
      });
      ids.push(e.id);
    }
    await setMeetingLocation(tx, ids, input.meetingLat, input.meetingLng);
    await audit({ actorType: 'USER', actorId, action: 'event.created', targetType: 'event', targetId: ids[0], clubId, metadata: { occurrences: ids.length } }, ctx, tx);
    return ids;
  });
  return getEvent(ids[0]!, actorId);
}

const eventSelect = {
  id: true,
  clubId: true,
  seriesId: true,
  title: true,
  description: true,
  type: true,
  status: true,
  visibility: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  meetingPoint: true,
  meetingLat: true,
  meetingLng: true,
  routeDescription: true,
  distanceM: true,
  difficulty: true,
  maxParticipants: true,
  registrationClosesAt: true,
  coverUrl: true,
  cancelReason: true,
  goingCount: true,
  createdAt: true,
  club: { select: { id: true, slug: true, name: true, logoUrl: true, visibility: true, status: true } },
  sponsorship: { select: { acceptedAt: true, campaign: { select: { status: true, sponsor: { select: { name: true, logoUrl: true, websiteUrl: true } } } } } },
} satisfies Prisma.EventSelect;

async function loadVisibleEvent(eventId: string, viewerId: string | undefined) {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: { ...eventSelect, checkInSecret: true } });
  if (!e) throw notFound('Event not found');
  const access = await loadClubAccess(e.clubId, viewerId);
  if (!canSeeClub(access)) throw notFound('Event not found');
  const isMember = access.permissions.has('club.view_private');
  if (e.visibility === 'MEMBERS' && !isMember) throw notFound('Event not found');
  if (e.visibility === 'PUBLIC' && access.club.visibility !== 'PUBLIC' && !isMember) throw notFound('Event not found');
  return { event: e, access, isMember };
}

export async function getEvent(eventId: string, viewerId?: string) {
  const { event, access } = await loadVisibleEvent(eventId, viewerId);
  const { checkInSecret: _s, sponsorship, ...rest } = event;
  // Sponsored content is always clearly labelled, and only once the club accepted it.
  const sponsor = sponsorship?.acceptedAt && sponsorship.campaign.status === 'ACTIVE' ? { label: 'Sponsored', ...sponsorship.campaign.sponsor } : null;
  const [registration, attendance] = viewerId
    ? await Promise.all([
        prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId: viewerId } }, select: { status: true } }),
        prisma.eventAttendance.findUnique({ where: { eventId_userId: { eventId, userId: viewerId } }, select: { checkedInAt: true, method: true } }),
      ])
    : [null, null];
  return {
    ...rest,
    sponsor,
    viewer: {
      registration: registration?.status ?? null,
      checkedInAt: attendance?.checkedInAt ?? null,
      canManage: access.permissions.has('events.manage'),
      canManageAttendance: access.permissions.has('attendance.manage'),
    },
  };
}

export async function listClubEvents(clubId: string, viewerId: string | undefined, q: { cursor?: string; limit: number; from?: Date; to?: Date; includeCancelled: boolean }) {
  const access = await loadClubAccess(clubId, viewerId);
  if (!canSeeClub(access)) throw notFound('Club not found');
  const isMember = access.permissions.has('club.view_private');
  const cursor = decodeCursor(q.cursor);
  const from = q.from ?? new Date(Date.now() - 6 * 3600_000);
  const rows = await prisma.event.findMany({
    where: {
      clubId,
      ...(isMember ? {} : { visibility: 'PUBLIC', club: { visibility: 'PUBLIC' } }),
      ...(q.includeCancelled ? {} : { status: 'SCHEDULED' }),
      startsAt: { gte: from, ...(q.to ? { lte: q.to } : {}) },
      ...(cursor ? { OR: [{ startsAt: { gt: cursor.createdAt } }, { startsAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: q.limit + 1,
    select: eventSelect,
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.startsAt, id: last.id }) : null };
}

/** Public discovery: PUBLIC events of PUBLIC, active clubs; optionally near a point (PostGIS). */
export async function discoverEvents(q: { cursor?: string; limit: number; near?: string; radiusKm: number; type?: EventType }) {
  const cursor = decodeCursor(q.cursor);
  let nearIds: string[] | undefined;
  if (q.near) {
    const [lat, lng] = q.near.split(',').map(Number) as [number, number];
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM events WHERE status = 'SCHEDULED' AND visibility = 'PUBLIC' AND starts_at >= now() AND meeting_location IS NOT NULL
        AND ST_DWithin(meeting_location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${q.radiusKm * 1000}) LIMIT 1000`;
    nearIds = rows.map((r) => r.id);
  }
  const rows = await prisma.event.findMany({
    where: {
      status: 'SCHEDULED',
      visibility: 'PUBLIC',
      startsAt: { gte: new Date() },
      club: { visibility: 'PUBLIC', status: 'ACTIVE', deletedAt: null },
      ...(q.type ? { type: q.type } : {}),
      ...(nearIds ? { id: { in: nearIds } } : {}),
      ...(cursor ? { OR: [{ startsAt: { gt: cursor.createdAt } }, { startsAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: q.limit + 1,
    select: eventSelect,
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.startsAt, id: last.id }) : null };
}

async function manageableEvent(eventId: string, actorId: string, permission: 'events.manage' | 'attendance.manage') {
  const e = await prisma.event.findUnique({ where: { id: eventId } });
  if (!e) throw notFound('Event not found');
  const access = await requireClubPermission(e.clubId, actorId, permission, { allowInactiveClub: permission === 'attendance.manage' });
  return { e, access };
}

export async function updateEvent(eventId: string, actorId: string, input: Partial<EventInput> & { applyToSeries: boolean }, ctx: AuditContext) {
  const { e } = await manageableEvent(eventId, actorId, 'events.manage');
  const { applyToSeries, recurrence: _r, ...fields } = input;
  const merged = { startsAt: fields.startsAt ?? e.startsAt, endsAt: fields.endsAt ?? e.endsAt };
  if (merged.endsAt <= merged.startsAt) throw badRequest('endsAt must be after startsAt');
  if (fields.maxParticipants != null && fields.maxParticipants < e.goingCount)
    throw conflict('Capacity cannot be below the number of people already going', 'CAPACITY_BELOW_GOING');
  await prisma.$transaction(async (tx) => {
    const targets =
      applyToSeries && e.seriesId
        ? (await tx.event.findMany({ where: { seriesId: e.seriesId, startsAt: { gte: e.startsAt }, status: 'SCHEDULED' }, select: { id: true } })).map((x) => x.id)
        : [e.id];
    // Times are only changed on this occurrence; series edits update descriptive fields.
    const { startsAt, endsAt, ...shared } = fields;
    await tx.event.updateMany({ where: { id: { in: targets } }, data: shared });
    if (startsAt || endsAt) await tx.event.update({ where: { id: e.id }, data: { startsAt: merged.startsAt, endsAt: merged.endsAt } });
    await setMeetingLocation(tx, targets, fields.meetingLat, fields.meetingLng);
    await audit(
      {
        actorType: 'USER',
        actorId,
        action: 'event.updated',
        targetType: 'event',
        targetId: e.id,
        clubId: e.clubId,
        metadata: { fields: Object.keys(fields), occurrences: targets.length },
      },
      ctx,
      tx,
    );
  });
  return getEvent(eventId, actorId);
}

export async function cancelEvent(eventId: string, actorId: string, reason: string, applyToSeries: boolean, ctx: AuditContext) {
  const { e } = await manageableEvent(eventId, actorId, 'events.manage');
  if (e.status === 'CANCELLED') throw conflict('Event is already cancelled', 'ALREADY_CANCELLED');
  const targets =
    applyToSeries && e.seriesId
      ? await prisma.event.findMany({ where: { seriesId: e.seriesId, startsAt: { gte: e.startsAt }, status: 'SCHEDULED' }, select: { id: true, title: true, startsAt: true } })
      : [e];
  await prisma.$transaction(async (tx) => {
    await tx.event.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { status: 'CANCELLED', cancelReason: reason } });
    await audit(
      { actorType: 'USER', actorId, action: 'event.cancelled', targetType: 'event', targetId: e.id, clubId: e.clubId, metadata: { reason, occurrences: targets.length } },
      ctx,
      tx,
    );
  });
  for (const t of targets) {
    const regs = await prisma.eventRegistration.findMany({ where: { eventId: t.id, status: { in: ['GOING', 'WAITLISTED'] } }, select: { userId: true } });
    await notify({
      userIds: regs.map((r) => r.userId),
      type: 'event.cancelled',
      title: `Cancelled: ${t.title}`,
      body: `${t.startsAt.toUTCString()} — ${reason}`,
      data: { eventId: t.id },
    });
  }
}

/**
 * RSVP with capacity and waitlist. Uses a row lock on the event so concurrent RSVPs cannot
 * exceed capacity. Cancelling a GOING spot promotes the earliest waitlisted member.
 */
export async function rsvp(eventId: string, userId: string, going: boolean) {
  const { event, isMember } = await loadVisibleEvent(eventId, userId);
  if (event.status !== 'SCHEDULED') throw conflict('This event has been cancelled', 'EVENT_CANCELLED');
  if (event.endsAt < new Date()) throw conflict('This event has ended', 'EVENT_ENDED');
  if (event.visibility === 'MEMBERS' && !isMember) throw forbidden('Join the club to RSVP', 'MEMBERS_ONLY');
  if (going && event.registrationClosesAt && event.registrationClosesAt < new Date()) throw conflict('Registration has closed', 'REGISTRATION_CLOSED');

  const result = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<
      { going_count: number; max_participants: number | null }[]
    >`SELECT going_count, max_participants FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
    const current = await tx.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId } } });
    let promoted: string | null = null;
    if (going) {
      if (current?.status === 'GOING' || current?.status === 'WAITLISTED') return { status: current.status, promoted };
      const full = locked!.max_participants != null && locked!.going_count >= locked!.max_participants;
      const status = full ? 'WAITLISTED' : 'GOING';
      await tx.eventRegistration.upsert({ where: { eventId_userId: { eventId, userId } }, create: { eventId, userId, status }, update: { status } });
      if (status === 'GOING') await tx.event.update({ where: { id: eventId }, data: { goingCount: { increment: 1 } } });
      return { status, promoted };
    }
    if (!current || current.status === 'CANCELLED') return { status: 'CANCELLED' as const, promoted };
    await tx.eventRegistration.update({ where: { eventId_userId: { eventId, userId } }, data: { status: 'CANCELLED' } });
    if (current.status === 'GOING') {
      const next = await tx.eventRegistration.findFirst({ where: { eventId, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' } });
      if (next) {
        await tx.eventRegistration.update({ where: { eventId_userId: { eventId, userId: next.userId } }, data: { status: 'GOING' } });
        promoted = next.userId;
      } else {
        await tx.event.update({ where: { id: eventId }, data: { goingCount: { decrement: 1 } } });
      }
    }
    return { status: 'CANCELLED' as const, promoted };
  });
  if (result.promoted) {
    await notify({
      userIds: [result.promoted],
      type: 'event.reminder',
      title: `You’re in: ${event.title}`,
      body: 'A spot opened up and you’ve moved off the waitlist.',
      data: { eventId },
    });
  }
  return { status: result.status };
}

export async function participants(eventId: string, actorId: string) {
  const { e } = await manageableEvent(eventId, actorId, 'attendance.manage');
  const [regs, att] = await Promise.all([
    prisma.eventRegistration.findMany({
      where: { eventId: e.id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      select: { status: true, createdAt: true, user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
    }),
    prisma.eventAttendance.findMany({
      where: { eventId: e.id },
      select: {
        userId: true,
        method: true,
        checkedInAt: true,
        distanceFromMeetingM: true,
        user: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
    }),
  ]);
  const attended = new Map(att.map((a) => [a.userId, a]));
  const rows = regs.map((r) => ({
    user: { id: r.user.id, username: r.user.username, displayName: r.user.profile?.displayName ?? r.user.username },
    registration: r.status,
    registeredAt: r.createdAt,
    attendance: attended.get(r.user.id) ?? null,
  }));
  for (const a of att)
    if (!regs.some((r) => r.user.id === a.userId))
      rows.push({
        user: { id: a.user.id, username: a.user.username, displayName: a.user.profile?.displayName ?? a.user.username },
        registration: null as never,
        registeredAt: null as never,
        attendance: a,
      });
  return { eventId: e.id, going: regs.filter((r) => r.status === 'GOING').length, waitlisted: regs.filter((r) => r.status === 'WAITLISTED').length, attended: att.length, rows };
}

// QR check-in ---------------------------------------------------------------------------------

const codeFor = (eventId: string, secret: string, win: number) => `${win}.${createHmac('sha256', secret).update(`${eventId}:${win}`).digest('base64url').slice(0, 22)}`;

/** Rotating code shown by organizers as a QR; valid for ~3 minutes. */
export async function checkInCode(eventId: string, actorId: string) {
  const { e } = await manageableEvent(eventId, actorId, 'attendance.manage');
  const win = Math.floor(Date.now() / CODE_WINDOW_MS);
  return { code: codeFor(e.id, e.checkInSecret, win), expiresAt: new Date((win + 1) * CODE_WINDOW_MS), deepLink: `walktogether://events/${e.id}/check-in?code=` };
}

function verifyCode(eventId: string, secret: string, code: string) {
  const [w] = code.split('.');
  const win = Number(w);
  const now = Math.floor(Date.now() / CODE_WINDOW_MS);
  if (!Number.isInteger(win) || win > now || now - win > 2) return false;
  return safeEqual(code, codeFor(eventId, secret, win));
}

export async function selfCheckIn(eventId: string, userId: string, input: { code: string; lat?: number; lng?: number }) {
  const { event, isMember } = await loadVisibleEvent(eventId, userId);
  if (event.status !== 'SCHEDULED') throw conflict('This event has been cancelled', 'EVENT_CANCELLED');
  const now = Date.now();
  if (now < event.startsAt.getTime() - CHECK_IN_EARLY_MS || now > event.endsAt.getTime() + CHECK_IN_LATE_MS)
    throw conflict('Check-in is not open for this event', 'CHECK_IN_CLOSED');
  if (!verifyCode(event.id, event.checkInSecret, input.code)) throw badRequest('This check-in code is invalid or has expired. Scan the organizer’s current QR code.');
  if (event.visibility === 'MEMBERS' && !isMember) throw forbidden('Join the club to check in', 'MEMBERS_ONLY');
  // GPS proximity is recorded as a supporting signal only.
  const distance =
    input.lat != null && input.lng != null && event.meetingLat != null && event.meetingLng != null
      ? Math.round(haversine({ lat: input.lat, lng: input.lng }, { lat: event.meetingLat, lng: event.meetingLng }))
      : null;
  const row = await prisma.eventAttendance.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, method: 'QR', distanceFromMeetingM: distance },
    update: {},
  });
  await enqueue('achievements.evaluate', { userId }).catch(() => undefined);
  return { checkedInAt: row.checkedInAt, method: row.method, distanceFromMeetingM: row.distanceFromMeetingM };
}

export async function organizerAttendance(eventId: string, actorId: string, userId: string, present: boolean, ctx: AuditContext) {
  const { e } = await manageableEvent(eventId, actorId, 'attendance.manage');
  const member = await prisma.clubMembership.findUnique({ where: { clubId_userId: { clubId: e.clubId, userId } } });
  const registered = await prisma.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId } } });
  if (member?.status !== 'ACTIVE' && !registered) throw notFound('This person is not a member or registrant');
  if (present) {
    await prisma.eventAttendance.upsert({ where: { eventId_userId: { eventId, userId } }, create: { eventId, userId, method: 'ORGANIZER', checkedInById: actorId }, update: {} });
  } else {
    await prisma.eventAttendance.deleteMany({ where: { eventId, userId } });
  }
  await audit(
    { actorType: 'USER', actorId, action: present ? 'attendance.marked' : 'attendance.unmarked', targetType: 'event', targetId: eventId, clubId: e.clubId, metadata: { userId } },
    ctx,
  );
}

export async function attendanceCsv(eventId: string, actorId: string) {
  const { e } = await manageableEvent(eventId, actorId, 'attendance.manage');
  await requireClubPermission(e.clubId, actorId, 'reports.export', { allowInactiveClub: true });
  await requireFeature({ clubId: e.clubId }, 'club.exports');
  const p = await participants(eventId, actorId);
  return toCsv(
    ['name', 'username', 'registration', 'attended', 'method', 'checked_in_at'],
    p.rows.map((r) => [
      r.user.displayName,
      r.user.username,
      r.registration ?? '',
      r.attendance ? 'yes' : 'no',
      r.attendance?.method ?? '',
      r.attendance?.checkedInAt?.toISOString() ?? '',
    ]),
  );
}

/** RFC 4180 CSV with spreadsheet formula-injection protection. */
export function toCsv(header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Reminders (job) -----------------------------------------------------------------------------

export async function sendEventReminders(now = new Date()) {
  const windows = [
    { kind: '24h', from: now.getTime() + 23 * 3600_000, to: now.getTime() + 25 * 3600_000 },
    { kind: '2h', from: now.getTime() + 90 * MIN, to: now.getTime() + 150 * MIN },
  ];
  let sent = 0;
  for (const w of windows) {
    const events = await prisma.event.findMany({
      where: { status: 'SCHEDULED', startsAt: { gte: new Date(w.from), lte: new Date(w.to) }, reminders: { none: { kind: w.kind } } },
      select: { id: true, title: true, startsAt: true, meetingPoint: true, club: { select: { name: true } } },
      take: 200,
    });
    for (const e of events) {
      // Record first so a crash cannot cause duplicate reminders.
      const claimed = await prisma.eventReminder.createMany({ data: [{ eventId: e.id, kind: w.kind }], skipDuplicates: true });
      if (!claimed.count) continue;
      const regs = await prisma.eventRegistration.findMany({ where: { eventId: e.id, status: 'GOING' }, select: { userId: true } });
      sent += await notify({
        userIds: regs.map((r) => r.userId),
        type: 'event.reminder',
        title: `${w.kind === '24h' ? 'Tomorrow' : 'Starting soon'}: ${e.title}`,
        body: `${e.club.name} · meet at ${e.meetingPoint}`,
        data: { eventId: e.id },
      });
    }
  }
  return { sent };
}
