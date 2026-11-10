import { badRequest } from './errors';

/**
 * Opaque cursor encoding (createdAt + id) for stable keyset pagination.
 * Never use OFFSET for large tables.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (!raw) return undefined;
  try {
    const [iso, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [string, string];
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw badRequest('Invalid pagination cursor');
  }
}

/** Prisma `where` fragment for DESC (createdAt, id) keyset pagination. */
export function cursorWhere(cursor: Cursor | undefined) {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

export function paginate<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
