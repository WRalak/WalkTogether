import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Secrets. In non-development environments these MUST be long random values.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ADMIN_SECRET: z.string().min(32),
  TOKEN_HASH_SECRET: z.string().min(32),
  /** 32-byte key, base64 encoded, used for AES-256-GCM field encryption. */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes base64'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(60),
  ADMIN_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),

  CORS_ORIGINS: csv.default('http://localhost:3000,http://localhost:3001,http://localhost:3002'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool.optional(),

  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  // Email
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('WalkTogether <no-reply@walktogether.app>'),
  SMTP_URL: z.string().optional(),

  // SMS
  SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
  AFRICASTALKING_USERNAME: z.string().optional(),
  AFRICASTALKING_API_KEY: z.string().optional(),
  AFRICASTALKING_SENDER_ID: z.string().optional(),

  // OAuth
  GOOGLE_CLIENT_IDS: csv.default(''),
  APPLE_CLIENT_IDS: csv.default(''),

  // Queues: 'bullmq' in deployed environments, 'inline' runs jobs synchronously (tests only).
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),

  RATE_LIMIT_ENABLED: bool.default('true'),

  // Push notifications: console (dev only) | expo
  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Object storage for media (S3-compatible: AWS S3, Cloudflare R2, MinIO).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MEDIA_PUBLIC_BASE_URL: z.string().optional(),
  // Malware scanning of uploads: clamav (clamd INSTREAM) | none (development only)
  MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  // Payments
  PAYMENT_PROVIDERS: csv.default(''),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Maps (served to clients; keys must be platform-restricted in the provider console)
  MAP_PROVIDER: z.enum(['google', 'mapbox']).default('google'),

  SENTRY_DSN: z.string().optional(),
  ADMIN_TOTP_ISSUER: z.string().default('WalkTogether Admin'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Print field names only; never echo values (they may be secrets).
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const env = parsed.data;
  const deployed = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  if (deployed) {
    const problems: string[] = [];
    if (env.EMAIL_PROVIDER === 'console') problems.push('EMAIL_PROVIDER must not be "console"');
    if (env.SMS_PROVIDER === 'console') problems.push('SMS_PROVIDER must not be "console"');
    if (env.QUEUE_DRIVER === 'inline') problems.push('QUEUE_DRIVER must be "bullmq"');
    if (!env.RATE_LIMIT_ENABLED) problems.push('RATE_LIMIT_ENABLED must be true');
    if (env.PUSH_PROVIDER === 'console') problems.push('PUSH_PROVIDER must not be "console"');
    if (env.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER must be "s3"');
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) problems.push('S3_BUCKET is required');
    if (env.MALWARE_SCANNER === 'none') problems.push('MALWARE_SCANNER must be "clamav"');
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) problems.push('SMTP_URL is required');
    if (env.SMS_PROVIDER === 'africastalking' && (!env.AFRICASTALKING_API_KEY || !env.AFRICASTALKING_USERNAME))
      problems.push("AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY are required");
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_ADMIN_SECRET', 'TOKEN_HASH_SECRET'] as const) {
      if (/change[-_]?me|dev|example/i.test(env[k])) problems.push(`${k} looks like a placeholder`);
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_ADMIN_SECRET) problems.push('JWT_ACCESS_SECRET and JWT_ADMIN_SECRET must differ');
    if (problems.length) throw new Error(`Unsafe ${env.NODE_ENV} configuration:\n  ${problems.join('\n  ')}`);
  }
  return env;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const cookieSecure = env.COOKIE_SECURE ?? (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging');
