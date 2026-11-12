import { testEnv } from './env';

Object.assign(process.env, testEnv);
// Least-privilege mode: tests talk to PostgreSQL as the restricted application role.
if (process.env.TEST_APP_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_APP_DATABASE_URL;
