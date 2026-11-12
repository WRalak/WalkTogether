import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { env } from '../../config/env';
import { createQueueConnection } from '../../database/redis';
import { logger } from '../../shared/logger';
import { isSessionRevoked } from '../auth/session-revocation';
import { verifyToken } from '../auth/tokens';
// Circular import is safe: only used inside handlers at runtime.
import { assertMember, markRead, sendMessage } from './messaging.service';

let io: Server | null = null;

export function emitToConversation(conversationId: string, event: string, payload: unknown) {
  io?.of('/rt').to(`conv:${conversationId}`).emit(event, payload);
}

/**
 * Socket.IO on namespace "/rt". Every socket authenticates with a member access token; every
 * room join is authorised against the database (assertMember). Redis adapter fans out across
 * API instances.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 20_000,
  });
  if (env.NODE_ENV !== 'test') {
    const pub = createQueueConnection();
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
  }
  const nsp = io.of('/rt');
  nsp.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = await verifyToken<{ sid: string }>('access', token);
      if (await isSessionRevoked(payload.sid)) return next(new Error('SESSION_REVOKED'));
      socket.data.userId = payload.sub;
      socket.data.exp = payload.exp;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });
  nsp.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);
    // Disconnect when the access token expires; clients reconnect with a fresh token.
    const ttl = Math.max(0, (socket.data.exp as number) * 1000 - Date.now());
    const timer = setTimeout(() => socket.disconnect(true), ttl);
    socket.on('disconnect', () => clearTimeout(timer));

    socket.on('conversation:join', async (raw, ack?: (r: unknown) => void) => {
      const parsed = z.object({ conversationId: z.string().uuid() }).safeParse(raw);
      if (!parsed.success) return ack?.({ error: 'BAD_REQUEST' });
      try {
        await assertMember(parsed.data.conversationId, userId);
        await socket.join(`conv:${parsed.data.conversationId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'FORBIDDEN' });
      }
    });
    socket.on('message:send', async (raw, ack?: (r: unknown) => void) => {
      const parsed = z.object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(4000), clientId: z.string().uuid().optional() }).safeParse(raw);
      if (!parsed.success) return ack?.({ error: 'BAD_REQUEST' });
      try {
        ack?.({ ok: true, message: await sendMessage(parsed.data.conversationId, userId, parsed.data.body, parsed.data.clientId) });
      } catch (err) {
        ack?.({ error: (err as { code?: string }).code ?? 'ERROR' });
      }
    });
    socket.on('conversation:read', async (raw) => {
      const parsed = z.object({ conversationId: z.string().uuid() }).safeParse(raw);
      if (parsed.success) await markRead(parsed.data.conversationId, userId).catch(() => undefined);
    });
    socket.on('typing', async (raw) => {
      const parsed = z.object({ conversationId: z.string().uuid() }).safeParse(raw);
      if (parsed.success && socket.rooms.has(`conv:${parsed.data.conversationId}`))
        socket.to(`conv:${parsed.data.conversationId}`).emit('typing', { conversationId: parsed.data.conversationId, userId });
    });
  });
  logger.info('realtime attached');
  return nsp;
}

export async function closeRealtime() {
  await io?.close();
  io = null;
}
