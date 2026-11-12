import argon2 from 'argon2';
import { env } from '../config/env';

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1). Tests use cheaper params.
const options: argon2.Options & { raw?: false } =
  env.NODE_ENV === 'test' ? { type: argon2.argon2id, memoryCost: 1024, timeCost: 1, parallelism: 1 } : { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, options);
}

/** Hash computed once and used to equalise timing when the account does not exist. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation-1');
  await verifyPassword(await dummyHash, password);
}
