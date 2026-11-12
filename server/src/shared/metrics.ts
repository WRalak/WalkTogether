import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import { env } from '../config/env';
import { safeEqual } from './crypto';

export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'walktogether-api', env: env.NODE_ENV });
if (env.NODE_ENV !== 'test') client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency by route and status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const jobCounter = new client.Counter({ name: 'jobs_processed_total', help: 'Background jobs processed', labelNames: ['job', 'outcome'] as const, registers: [registry] });
export const paymentCounter = new client.Counter({ name: 'payments_total', help: 'Payment outcomes', labelNames: ['provider', 'outcome'] as const, registers: [registry] });

/**
 * Security-relevant events for threat detection (Prometheus alerts in infrastructure/monitoring).
 * Label values come from fixed code sets (error codes, limiter names, audit actions) — never from
 * user input — so cardinality stays bounded and no personal data reaches the metrics store.
 */
export type SecurityEventType =
  | 'auth_failure'
  | 'mfa_failure'
  | 'suspicious_login'
  | 'refresh_token_reuse'
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'admin_action'
  | 'payment_anomaly';
export const securityEvents = new client.Counter({
  name: 'walktogether_security_events_total',
  help: 'Security-relevant events (authentication failures, abuse, denials, privileged actions, payment anomalies)',
  labelNames: ['type', 'detail'] as const,
  registers: [registry],
});
export function recordSecurityEvent(type: SecurityEventType, detail = '') {
  securityEvents.inc({ type, detail: detail.slice(0, 64) });
}

/** Records latency with the matched route pattern (never the raw URL, so ids don't explode cardinality). */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

/** Prometheus scrape endpoint; requires METRICS_TOKEN (and should also be network-restricted). */
export async function metricsHandler(req: Request, res: Response) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!env.METRICS_TOKEN || !safeEqual(token, env.METRICS_TOKEN)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
