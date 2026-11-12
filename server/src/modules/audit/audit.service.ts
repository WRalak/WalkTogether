import { recordSecurityEvent } from '../../shared/metrics';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../database/prisma';

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  actorType: 'ADMIN' | 'USER' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  clubId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Write an append-only audit record. Pass the transaction client when the audited change
 * is transactional, so the audit row commits (or rolls back) together with the change.
 */
export async function audit(entry: AuditEntry, ctx: AuditContext = {}, tx: Tx = prisma) {
  if (entry.actorType === 'ADMIN') recordSecurityEvent('admin_action', entry.action);
  await tx.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      clubId: entry.clubId ?? null,
      metadata: entry.metadata ?? {},
      ipAddress: ctx.ipAddress?.slice(0, 64),
      userAgent: ctx.userAgent?.slice(0, 500),
      requestId: ctx.requestId?.slice(0, 64),
    },
  });
}
