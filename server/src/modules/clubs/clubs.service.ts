import { Prisma } from '@prisma/client';
import { DEFAULT_CLUB_ROLE_PERMISSIONS, SYSTEM_CLUB_ROLE_LABELS, SYSTEM_CLUB_ROLES, type ClubDetail, type ClubSummary } from '@walktogether/shared-types';
import type { CreateClubInput, UpdateClubInput } from '@walktogether/validation';
import { prisma, type Tx } from '../../database/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { getSetting } from '../platform/settings';
import { canSeeClub, loadClubAccess, requireClubPermission } from './club-access';

const summarySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  category: true,
  visibility: true,
  logoUrl: true,
  coverUrl: true,
  city: true,
  countryCode: true,
  memberCount: true,
  createdAt: true,
} satisfies Prisma.ClubSelect;

type SummaryRow = Prisma.ClubGetPayload<{ select: typeof summarySelect }>;

function toSummary(c: SummaryRow, distanceKm?: number): ClubSummary {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    category: c.category,
    visibility: c.visibility,
    logoUrl: c.logoUrl,
    coverUrl: c.coverUrl,
    city: c.city,
    countryCode: c.countryCode,
    memberCount: c.memberCount,
    ...(distanceKm !== undefined ? { distanceKm: Math.round(distanceKm * 10) / 10 } : {}),
  };
}

async function setLocation(tx: Tx, clubId: string, lat: number | null | undefined, lng: number | null | undefined) {
  if (lat === undefined && lng === undefined) return;
  if (lat == null || lng == null) {
    await tx.$executeRaw`UPDATE clubs SET location = NULL WHERE id = ${clubId}::uuid`;
    return;
  }
  // Parameterised: values are bound, never interpolated into SQL text.
  await tx.$executeRaw`UPDATE clubs SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography WHERE id = ${clubId}::uuid`;
}

/** Creates the per-club system roles with their default permission sets. */
async function createSystemRoles(tx: Tx, clubId: string) {
  const roles: Record<string, string> = {};
  for (const key of SYSTEM_CLUB_ROLES) {
    const role = await tx.clubRole.create({
      data: {
        clubId,
        systemKey: key,
        name: SYSTEM_CLUB_ROLE_LABELS[key],
        isOwner: key === 'OWNER',
        permissions: { create: DEFAULT_CLUB_ROLE_PERMISSIONS[key].map((permissionKey) => ({ permissionKey })) },
      },
    });
    roles[key] = role.id;
  }
  return roles as Record<(typeof SYSTEM_CLUB_ROLES)[number], string>;
}

export async function createClub(userId: string, input: CreateClubInput, ctx: AuditContext) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true, emailVerifiedAt: true, phoneVerifiedAt: true } });
  if (user.status !== 'ACTIVE') throw forbidden('Your account cannot create clubs right now');
  if (!user.emailVerifiedAt && !user.phoneVerifiedAt) {
    throw forbidden('Verify your email address or phone number before creating a club', 'VERIFICATION_REQUIRED');
  }
  const [maxOwned, requireApproval] = await Promise.all([getSetting('clubs.maxOwnedPerUser'), getSetting('clubs.requireApproval')]);
  const owned = await prisma.club.count({ where: { ownerId: userId, deletedAt: null, status: { not: 'ARCHIVED' } } });
  if (owned >= maxOwned) throw forbidden(`You can own at most ${maxOwned} clubs`, 'CLUB_LIMIT_REACHED');
  if (await prisma.club.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
    throw conflict('That club URL is already taken', 'SLUG_TAKEN');
  }

  const { latitude, longitude, socialLinks, ...fields } = input;
  const club = await prisma.$transaction(async (tx) => {
    const club = await tx.club.create({
      data: {
        ...fields,
        socialLinks: socialLinks ?? {},
        requiresApproval: input.requiresApproval ?? input.visibility !== 'PUBLIC',
        status: requireApproval ? 'PENDING_APPROVAL' : 'ACTIVE',
        ownerId: userId,
        memberCount: 1,
        settings: { create: {} },
      },
    });
    const roles = await createSystemRoles(tx, club.id);
    await tx.clubMembership.create({
      data: { clubId: club.id, userId, roleId: roles.OWNER, status: 'ACTIVE', joinedAt: new Date() },
    });
    await setLocation(tx, club.id, latitude, longitude);
    await audit({ actorType: 'USER', actorId: userId, action: 'club.created', targetType: 'club', targetId: club.id, clubId: club.id, metadata: { slug: club.slug } }, ctx, tx);
    return club;
  });
  return getClubDetail(club.id, userId);
}

async function getCoordinates(clubId: string) {
  const rows = await prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM clubs WHERE id = ${clubId}::uuid`;
  return rows[0] ?? { lat: null, lng: null };
}

export async function getClubDetail(clubId: string, viewerId?: string): Promise<ClubDetail & { latitude: number | null; longitude: number | null }> {
  const access = await loadClubAccess(clubId, viewerId);
  if (!canSeeClub(access)) throw notFound('Club not found');
  const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId } });
  const coords = await getCoordinates(clubId);
  const showContact = club.visibility === 'PUBLIC' || access.isActiveMember;
  return {
    ...toSummary(club),
    status: club.status,
    websiteUrl: club.websiteUrl,
    socialLinks: (club.socialLinks ?? {}) as Record<string, string>,
    contactEmail: showContact ? club.contactEmail : null,
    contactPhone: showContact ? club.contactPhone : null,
    requiresApproval: club.requiresApproval,
    createdAt: club.createdAt.toISOString(),
    latitude: coords.lat,
    longitude: coords.lng,
    viewer: {
      membershipStatus: access.membership?.status ?? null,
      role: access.role?.name ?? null,
      permissions: [...access.permissions],
    },
  };
}

export async function getClubBySlug(slug: string, viewerId?: string) {
  const club = await prisma.club.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null }, select: { id: true } });
  if (!club) throw notFound('Club not found');
  return getClubDetail(club.id, viewerId);
}

export interface ListClubsQuery {
  cursor?: string;
  limit: number;
  q?: string;
  category?: string;
  countryCode?: string;
  near?: string;
  radiusKm: number;
}

/**
 * Club discovery. Only ACTIVE PUBLIC/PRIVATE clubs are discoverable; INVITE_ONLY clubs are never listed.
 * Uses keyset pagination: (createdAt,id) normally, (distance,id) for nearby searches.
 */
export async function listClubs(query: ListClubsQuery) {
  if (query.near) return listNearbyClubs(query);
  const cursor = decodeCursor(query.cursor);
  const where: Prisma.ClubWhereInput = {
    status: 'ACTIVE',
    deletedAt: null,
    visibility: { in: ['PUBLIC', 'PRIVATE'] },
    ...(query.category ? { category: query.category as Prisma.EnumClubCategoryFilter['equals'] } : {}),
    ...(query.countryCode ? { countryCode: query.countryCode } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
  };
  const rows = await prisma.club.findMany({ where, select: summarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return { items: items.map((c) => toSummary(c)), nextCursor: hasMore && last ? encodeCursor(last) : null };
}

async function listNearbyClubs(query: ListClubsQuery) {
  const [latStr, lngStr] = query.near!.split(',');
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw badRequest('Invalid coordinates');
  let after: { d: number; id: string } | undefined;
  if (query.cursor) {
    try {
      const [d, id] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as [number, string];
      if (typeof d !== 'number' || typeof id !== 'string') throw new Error();
      after = { d, id };
    } catch {
      throw badRequest('Invalid pagination cursor');
    }
  }
  const radiusM = query.radiusKm * 1000;
  const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  const filters: Prisma.Sql[] = [
    Prisma.sql`status = 'ACTIVE'`,
    Prisma.sql`deleted_at IS NULL`,
    Prisma.sql`visibility IN ('PUBLIC', 'PRIVATE')`,
    Prisma.sql`location IS NOT NULL`,
    Prisma.sql`ST_DWithin(location, ${point}, ${radiusM})`,
  ];
  if (query.category) filters.push(Prisma.sql`category = ${query.category}::"ClubCategory"`);
  if (query.countryCode) filters.push(Prisma.sql`country_code = ${query.countryCode}`);
  if (query.q) filters.push(Prisma.sql`name ILIKE ${'%' + query.q.replace(/[%_\\]/g, '\\$&') + '%'}`);

  const rows = await prisma.$queryRaw<{ id: string; distance_m: number }[]>`
    SELECT * FROM (
      SELECT id, ST_Distance(location, ${point}) AS distance_m FROM clubs WHERE ${Prisma.join(filters, ' AND ')}
    ) c
    ${after ? Prisma.sql`WHERE (c.distance_m, c.id) > (${after.d}, ${after.id}::uuid)` : Prisma.empty}
    ORDER BY c.distance_m ASC, c.id ASC
    LIMIT ${query.limit + 1}`;

  const hasMore = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const clubs = await prisma.club.findMany({ where: { id: { in: page.map((r) => r.id) } }, select: summarySelect });
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const items = page.flatMap((r) => {
    const c = byId.get(r.id);
    return c ? [toSummary(c, r.distance_m / 1000)] : [];
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify([last.distance_m, last.id])).toString('base64url') : null,
  };
}

export async function updateClub(clubId: string, userId: string, input: UpdateClubInput, ctx: AuditContext) {
  await requireClubPermission(clubId, userId, 'club.settings.update');
  const { latitude, longitude, socialLinks, ...fields } = input;
  const before = await prisma.club.findUniqueOrThrow({ where: { id: clubId }, select: { visibility: true, name: true } });
  await prisma.$transaction(async (tx) => {
    await tx.club.update({ where: { id: clubId }, data: { ...fields, ...(socialLinks ? { socialLinks } : {}) } });
    await setLocation(tx, clubId, latitude, longitude);
    await audit(
      {
        actorType: 'USER',
        actorId: userId,
        action: 'club.updated',
        targetType: 'club',
        targetId: clubId,
        clubId,
        metadata: { fields: Object.keys(input), ...(input.visibility && input.visibility !== before.visibility ? { visibility: { from: before.visibility, to: input.visibility } } : {}) },
      },
      ctx,
      tx,
    );
  });
  return getClubDetail(clubId, userId);
}

export async function listRoles(clubId: string, userId: string) {
  await requireClubPermission(clubId, userId, 'members.view', { allowInactiveClub: true });
  const roles = await prisma.clubRole.findMany({
    where: { clubId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, systemKey: true, isOwner: true, description: true, permissions: { select: { permissionKey: true } }, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
  });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    systemKey: r.systemKey,
    isOwner: r.isOwner,
    description: r.description,
    permissions: r.permissions.map((p) => p.permissionKey),
    memberCount: r._count.memberships,
  }));
}
