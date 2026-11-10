import { pino } from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logger. Sensitive fields are redacted at the serializer level so a
 * careless log call cannot leak passwords, tokens or OTP codes.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'walktogether-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.idToken',
      '*.code',
      '*.otp',
      '*.mfaToken',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
