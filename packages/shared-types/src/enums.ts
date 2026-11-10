export const CLUB_VISIBILITY = ['PUBLIC', 'PRIVATE', 'INVITE_ONLY'] as const;
export type ClubVisibility = (typeof CLUB_VISIBILITY)[number];

export const CLUB_CATEGORIES = [
  'WALKING',
  'RUNNING',
  'HIKING',
  'MIXED_FITNESS',
  'CORPORATE_WELLNESS',
  'CHARITY',
  'SCHOOL_UNIVERSITY',
  'OTHER',
] as const;
export type ClubCategory = (typeof CLUB_CATEGORIES)[number];

export const MEMBERSHIP_STATUS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'LEFT', 'REMOVED', 'BANNED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];

export const ACTIVITY_TYPES = ['WALK', 'RUN', 'HIKE'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PROFILE_VISIBILITY = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITY)[number];

export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const CLUB_STATUS = ['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'ARCHIVED'] as const;
export type ClubStatus = (typeof CLUB_STATUS)[number];
