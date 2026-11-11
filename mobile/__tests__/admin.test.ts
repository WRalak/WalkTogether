import { createClubSchema } from '@walktogether/validation';
import { canAdminister } from '@/features/admin/use-admin-club';
import { PERMISSION_LABELS } from '@/features/admin/permissions';
import { CLUB_PERMISSIONS, DEFAULT_CLUB_ROLE_PERMISSIONS } from '@walktogether/shared-types';

jest.mock('@/services/api', () => ({ api: {} }));

describe('club admin access in the app', () => {
  it('shows club administration only to roles with an administrative permission', () => {
    expect(canAdminister(DEFAULT_CLUB_ROLE_PERMISSIONS.MEMBER)).toBe(false);
    expect(canAdminister(DEFAULT_CLUB_ROLE_PERMISSIONS.EVENT_ORGANIZER)).toBe(true);
    expect(canAdminister(DEFAULT_CLUB_ROLE_PERMISSIONS.MODERATOR)).toBe(true);
    expect(canAdminister(DEFAULT_CLUB_ROLE_PERMISSIONS.ADMIN)).toBe(true);
    expect(canAdminister([])).toBe(false);
  });

  it('has a human-readable label for every club permission', () => {
    for (const p of CLUB_PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
  });

  it('validates new clubs with the same schema as the server', () => {
    expect(createClubSchema.safeParse({ name: 'Nairobi Sunrise Walkers', slug: 'nairobi-sunrise', category: 'WALKING', visibility: 'PUBLIC' }).success).toBe(true);
    expect(createClubSchema.safeParse({ name: 'NS', slug: 'Bad Slug!', category: 'WALKING', visibility: 'PUBLIC' }).success).toBe(false);
  });
});
