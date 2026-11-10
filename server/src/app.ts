import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { globalLimiter } from './middleware/rate-limit';
import { requestContext } from './middleware/request-context';
import { adminRouter } from './modules/administration/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { clubsRouter } from './modules/clubs/clubs.routes';
import { healthRouter } from './modules/health/health.routes';
import { usersRouter } from './modules/users/users.routes';
import { activitiesRouter } from './modules/activities/activities.routes';
import { eventsRouter } from './modules/events/events.routes';
import { conversationsRouter } from './modules/messaging/messaging.routes';
import { localUploadRouter, mediaRouter } from './modules/media/media.routes';
import { localStorageDriver } from './modules/media/storage';
import { commentsRouter, feedRouter, followRoutes, postsRouter, reportsRouter } from './modules/social/social.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { subscriptionsRouter } from './modules/subscriptions/subscriptions.routes';
import { buildOpenApiDocument } from './openapi';
import { logger } from './shared/logger';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      // Only log the path, never query strings (they can carry tokens such as reset links).
      serializers: { req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }) },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-WT-Client', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/health', healthRouter);

  const api = express.Router();
  api.use(globalLimiter);
  api.use('/auth', authRouter);
  api.use('/users', followRoutes);
  api.use('/users', usersRouter);
  api.use('/clubs', clubsRouter);
  api.use('/activities', activitiesRouter);
  api.use('/events', eventsRouter);
  api.use('/feed', feedRouter);
  api.use('/posts', postsRouter);
  api.use('/comments', commentsRouter);
  api.use('/reports', reportsRouter);
  api.use('/conversations', conversationsRouter);
  api.use('/media', mediaRouter);
  if (localStorageDriver) {
    // Development-only stand-ins for S3 presigned uploads and CDN delivery.
    api.use('/media', localUploadRouter);
    app.use('/media-files', express.static(localStorageDriver.root, { immutable: true, maxAge: '1y', fallthrough: false }));
  }
  api.use('/notifications', notificationsRouter);
  api.use('/subscriptions', subscriptionsRouter);
  api.use('/platform-admin', adminRouter);
  app.use('/api/v1', api);

  // API documentation. Disabled in production unless explicitly needed behind auth.
  if (env.NODE_ENV !== 'production') {
    const doc = buildOpenApiDocument();
    app.get('/api/v1/openapi.json', (_req, res) => {
      res.json(doc);
    });
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(doc));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
