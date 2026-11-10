/** Environment for the automated test suite. Points at a dedicated test database. */
export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://walktogether:walktogether@localhost:5432/walktogether_test?schema=public',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
  JWT_ADMIN_SECRET: 'test-admin-secret-0123456789abcdef0123456789ab',
  TOKEN_HASH_SECRET: 'test-token-hash-secret-0123456789abcdef012345',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  QUEUE_DRIVER: 'inline',
  PAYMENT_PROVIDERS: 'sandbox',
  RATE_LIMIT_ENABLED: 'false',
  EMAIL_PROVIDER: 'console',
  SMS_PROVIDER: 'console',
  LOG_LEVEL: 'silent',
};
