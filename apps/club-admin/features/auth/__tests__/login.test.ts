import { describe, expect, it } from 'vitest';
import { loginFormSchema, safeNext } from '../login-form';
import { clubFormSchema, toClubPayload } from '../../clubs/club-form';

describe('club admin forms', () => {
  it('prevents open redirects through ?next=', () => {
    expect(safeNext('/clubs/abc')).toBe('/clubs/abc');
    expect(safeNext('//evil.example')).toBe('/clubs');
    expect(safeNext('https://evil.example')).toBe('/clubs');
    expect(safeNext(null)).toBe('/clubs');
  });

  it('validates login input', () => {
    expect(loginFormSchema.safeParse({ email: 'bad', password: 'x' }).success).toBe(false);
    expect(loginFormSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });

  it('validates club forms and clears blank optional fields', () => {
    const base = { name: 'Nairobi Walkers', slug: 'nairobi-walkers', category: 'WALKING', visibility: 'PUBLIC', requiresApproval: false } as const;
    expect(clubFormSchema.safeParse({ ...base, slug: 'Bad Slug!' }).success).toBe(false);
    expect(clubFormSchema.safeParse({ ...base, websiteUrl: 'javascript:alert(1)' }).success).toBe(false);
    const parsed = clubFormSchema.parse({ ...base, websiteUrl: '', city: '' });
    expect(toClubPayload(parsed)).toMatchObject({ websiteUrl: null, city: null });
  });
});
