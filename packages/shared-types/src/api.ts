/** Consistent envelope for every successful API response. */
export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  nextCursor: string | null;
  limit: number;
}

/** Consistent envelope for every error response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface MeUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  username: string;
  status: string;
  createdAt: string;
  profile: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    location: string | null;
    countryCode: string | null;
    fitnessInterests: string[];
    preferredActivityTypes: string[];
  } | null;
  privacy: {
    profileVisibility: string;
    activityDefaultVisibility: string;
    showClubs: boolean;
    showStats: boolean;
    allowFollowRequests: boolean;
    hideStartEndPoints: boolean;
  } | null;
}

export interface ClubSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  visibility: string;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  countryCode: string | null;
  memberCount: number;
  distanceKm?: number;
}

export interface ClubDetail extends ClubSummary {
  status: string;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  contactEmail: string | null;
  contactPhone: string | null;
  requiresApproval: boolean;
  createdAt: string;
  viewer: {
    membershipStatus: string | null;
    role: string | null;
    permissions: string[];
  };
}
