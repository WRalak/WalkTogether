import { describe, expect, it } from 'vitest';
import { clubSlugSchema, createClubSchema, passwordSchema, phoneSchema, registerSchema, usernameSchema } from '../index';

describe('validation', () => {
  it('accepts Kenyan E.164 phones and rejects local format', () => {
    expect(phoneSchema.safeParse('+254712345678').success).toBe(true);
    expect(phoneSchema.safeParse('0712345678').success).toBe(false);
  });

  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletterslong').success).toBe(false);
    expect(passwordSchema.safeParse('walk2gether-nairobi').success).toBe(true);
  });

  it('normalises usernames and rejects bad characters', () => {
    expect(usernameSchema.parse('Jane_Doe')).toBe('jane_doe');
    expect(usernameSchema.safeParse('_jane').success).toBe(false);
    expect(usernameSchema.safeParse('ja ne').success).toBe(false);
  });

  it('rejects reserved and malformed club slugs', () => {
    expect(clubSlugSchema.safeParse('admin').success).toBe(false);
    expect(clubSlugSchema.safeParse('nairobi--walkers').success).toBe(false);
    expect(clubSlugSchema.parse('Nairobi-Walkers')).toBe('nairobi-walkers');
  });

  it('requires lat/lng together for clubs', () => {
    const base = { name: 'Nairobi Walkers', slug: 'nairobi-walkers', category: 'WALKING', visibility: 'PUBLIC' } as const;
    expect(createClubSchema.safeParse({ ...base, latitude: -1.28 }).success).toBe(false);
    expect(createClubSchema.safeParse({ ...base, latitude: -1.28, longitude: 36.82 }).success).toBe(true);
  });

  it('requires accepting terms on registration and rejects unknown fields', () => {
    const ok = { email: 'a@b.co', password: 'walk2gether-x', username: 'abc', displayName: 'A', acceptTerms: true };
    expect(registerSchema.safeParse(ok).success).toBe(true);
    expect(registerSchema.safeParse({ ...ok, acceptTerms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, isAdmin: true }).success).toBe(false);
  });
});
