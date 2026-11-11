import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashToken, numericCode, safeEqual } from '../src/shared/crypto';
import { decodeCursor, encodeCursor } from '../src/shared/pagination';
import { hashPassword, verifyPassword } from '../src/shared/password';

describe('crypto', () => {
  it('round-trips AES-GCM and detects tampering', () => {
    const ct = encrypt('totp-secret');
    expect(decrypt(ct)).toBe('totp-secret');
    const parts = ct.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('hashes tokens deterministically and compares safely', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  it('generates 6-digit codes', () => {
    for (let i = 0; i < 50; i++) expect(numericCode()).toMatch(/^\d{6}$/);
  });

  it('hashes passwords with argon2id', async () => {
    const h = await hashPassword('walk2gether-strong');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'walk2gether-strong')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('cursor pagination', () => {
  it('round-trips and rejects garbage', () => {
    const c = { createdAt: new Date('2026-01-01T00:00:00Z'), id: 'abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(() => decodeCursor('garbage')).toThrow();
  });
});

describe('split hosting', () => {
  it('detects web origins that cannot share the API refresh cookie', async () => {
    const { crossSiteOrigins, registrableDomain } = await import('../src/config/hosting');
    expect(registrableDomain('api.walktogether.app')).toBe('walktogether.app');
    expect(registrableDomain('clubs.walktogether.co.ke')).toBe('walktogether.co.ke');
    expect(
      crossSiteOrigins('https://api.walktogether.app', ['https://walktogether.app', 'https://clubs.walktogether.app', 'https://admin.walktogether.app', 'https://wt-clubs.vercel.app']),
    ).toEqual(['https://wt-clubs.vercel.app']);
    expect(crossSiteOrigins('https://api.walktogether.co.ke', ['https://clubs.walktogether.co.ke', 'https://other.co.ke'])).toEqual(['https://other.co.ke']);
  });
});
