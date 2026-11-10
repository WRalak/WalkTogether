import type { z } from 'zod';
import type { AuthTokens, ClubDetail, ClubSummary, MeUser } from '@walktogether/shared-types';
import type * as v from '@walktogether/validation';
import { HttpClient, type HttpClientOptions } from './http';

type In<S extends z.ZodTypeAny> = z.input<S>;

export interface MyClub {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  status: string;
  visibility: string;
  memberCount: number;
  membershipStatus: 'ACTIVE' | 'PENDING';
  role: string;
  roleKey: string | null;
  permissions: string[];
}

export interface ClubMember {
  membershipId: string;
  status: string;
  joinedAt: string | null;
  requestedAt: string;
  requestMessage?: string | null;
  statusReason: string | null;
  role: { id: string; name: string; systemKey: string | null };
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
}

export interface ClubRoleInfo {
  id: string;
  name: string;
  systemKey: string | null;
  isOwner: boolean;
  description: string | null;
  permissions: string[];
  memberCount: number;
}

export interface SessionInfo {
  id: string;
  current: boolean;
  deviceName: string | null;
  platform: string | null;
  authMethod: string;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface ActivityDto {
  id: string;
  userId: string;
  type: 'WALK' | 'RUN' | 'HIKE';
  status?: string;
  title: string | null;
  notes: string | null;
  visibility: string;
  startedAt: string;
  endedAt: string | null;
  distanceM: number;
  movingSeconds: number;
  elapsedSeconds: number;
  avgPaceSecPerKm: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  elevationGainM: number | null;
  caloriesEstimate?: number | null;
  routePolyline: string | null;
  flagged?: boolean;
  clubIds?: string[];
}

export interface TotalsDto {
  activities: number;
  distanceM: number;
  movingSeconds: number;
  byType: Record<string, { activities: number; distanceM: number; movingSeconds: number }>;
}

export interface GoalDto {
  id: string;
  metric: 'DISTANCE_M' | 'ACTIVITIES' | 'MOVING_SECONDS';
  period: 'WEEK' | 'MONTH' | 'YEAR';
  activityType: string | null;
  target: number;
  value?: number;
  progress?: number;
}

export interface ActivityStatsDto {
  allTime: TotalsDto;
  thisWeek: TotalsDto;
  thisMonth: TotalsDto;
  avgPaceSecPerKm: number | null;
  weekly: { start: string; activities: number; distanceM: number; movingSeconds: number; avgPaceSecPerKm: number | null }[];
  monthly: { start: string; activities: number; distanceM: number; movingSeconds: number; avgPaceSecPerKm: number | null }[];
  personalRecords: Record<string, Record<string, ActivityDto | null>>;
  goals: GoalDto[];
  steps: null;
}

export interface EventDto {
  id: string;
  clubId: string;
  seriesId: string | null;
  title: string;
  description: string | null;
  type: string;
  status: 'SCHEDULED' | 'CANCELLED';
  visibility: 'PUBLIC' | 'MEMBERS';
  startsAt: string;
  endsAt: string;
  timezone: string;
  meetingPoint: string;
  meetingLat: number | null;
  meetingLng: number | null;
  routeDescription: string | null;
  distanceM: number | null;
  difficulty: string;
  maxParticipants: number | null;
  goingCount: number;
  cancelReason: string | null;
  coverUrl: string | null;
  club: { id: string; slug: string; name: string; logoUrl: string | null };
  sponsor?: { label: 'Sponsored'; name: string; logoUrl: string | null; websiteUrl: string | null } | null;
  viewer?: { registration: string | null; checkedInAt: string | null; canManage: boolean; canManageAttendance: boolean };
}

export interface ParticipantsDto {
  eventId: string;
  going: number;
  waitlisted: number;
  attended: number;
  rows: { user: { id: string; username: string; displayName: string }; registration: string | null; attendance: { method: string; checkedInAt: string; distanceFromMeetingM: number | null } | null }[];
}

export interface ClubOverviewDto {
  members: { active: number; pending: number; new30d: number; engaged30d: number; engagementRate: number };
  events: { upcoming30d: number; held30d: number; attendance30d: number; attendanceRate: number | null };
  activities: { shared30d: number };
  challenges: { participants30d: number };
  plan: { name: string | null; status: string };
}

export interface ClubGrowthDto {
  newMembers: { month: string; value: number }[];
  attendance: { month: string; value: number }[];
  topAttendees: { userId: string; username?: string; displayName?: string; events: number }[];
}

export interface PostDto {
  id: string;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null };
  club: { id: string; slug: string; name: string } | null;
  activity: { id: string; type: string; title: string | null; distanceM: number; movingSeconds: number; avgPaceSecPerKm: number | null; startedAt: string } | null;
  body: string | null;
  visibility: string;
  media: { id: string; kind: string; width: number | null; height: number | null; urls: Record<string, string> }[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  bookmarkedByMe: boolean;
  hidden: boolean;
  createdAt: string;
}

export interface CommentDto {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  likeCount: number;
  createdAt: string;
  author: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null };
}

export interface MediaDto {
  id: string;
  kind: string;
  purpose: string;
  status: 'PENDING_UPLOAD' | 'PROCESSING' | 'READY' | 'REJECTED';
  urls: Record<string, string>;
  rejectReason: string | null;
}

export interface MessageDto {
  id: string;
  conversationId?: string;
  senderId: string;
  body: string;
  createdAt: string;
  clientId: string | null;
}

export interface ConversationDto {
  id: string;
  kind: 'DIRECT' | 'CLUB' | 'EVENT';
  title: string | null;
  clubId: string | null;
  members: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null; lastReadAt: string | null }[];
  unread: number;
}

export interface ConversationSummaryDto {
  id: string;
  kind: 'DIRECT' | 'CLUB' | 'EVENT';
  title: string | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  members: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null }[];
  unread: boolean;
}

export interface ReportDto {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  preview: string | null;
  createdAt: string;
  reporter: { id: string; username: string };
}

export interface ChallengeDto {
  id: string;
  scope: 'PLATFORM' | 'CLUB' | 'CLUB_VS_CLUB' | 'SPONSORED';
  clubId: string | null;
  title: string;
  description: string | null;
  metric: 'DISTANCE_M' | 'ACTIVITIES' | 'MOVING_SECONDS' | 'ACTIVE_DAYS';
  activityTypes: string[];
  target: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  isPremium: boolean;
  isSponsored: boolean;
  sponsorName: string | null;
  rules: string | null;
  rewardDescription: string | null;
  maxDailyDistanceM: number;
  club?: { id: string; name: string; slug: string } | null;
  teams?: { clubId: string; club: { id: string; name: string } }[];
  participants?: number;
  _count?: { participants: number };
  me?: { progressValue: number; completedAt: string | null; teamClubId: string | null; hideFromLeaderboard: boolean; progress: number | null } | null;
}

export interface ChallengeLeaderboardDto {
  challenge: { id: string; title: string; metric: string; target: number | null; status: string };
  entries: { rank: number; value: number; completed: boolean; teamClubId: string | null; isMe: boolean; user: { id: string; username: string; displayName: string; avatarUrl: string | null } | null }[];
  teams: { clubId: string; name: string; participants: number; total: number; average: number; rank: number }[];
}

export interface LeaderboardDto {
  period: 'WEEK' | 'MONTH';
  periodStart: string;
  computedAt?: string | null;
  entries: { rank: number; valueM: number; isMe: boolean; user: { id: string; username: string; displayName: string; avatarUrl: string | null } | null }[];
}

export interface AchievementDto {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string | null;
}

export interface CheckoutResultDto {
  paymentId: string | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  amountMinor: number;
  currency: string;
  provider?: string;
  failureReason?: string | null;
  discountMinor?: number;
  clientAction?: { type: 'stk_push'; message: string } | { type: 'redirect'; url: string } | null;
}

export interface PaymentRowDto {
  id: string;
  purpose: string;
  status: string;
  amountMinor: number;
  currency: string;
  provider: string;
  createdAt: string;
  confirmedAt: string | null;
  invoice: { id: string; number: string; total: number; currency: string; issuedAt: string } | null;
}

export interface SponsorDto {
  id: string;
  name: string;
  slug: string;
  status: 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED';
  contactEmail: string;
}

export interface CampaignDto {
  id: string;
  name: string;
  type: 'CHALLENGE' | 'EVENT';
  status: string;
  budgetMinor: number;
  currency: string;
  startsAt: string;
  endsAt: string;
  paidAt: string | null;
  reviewNote: string | null;
  challengeId: string | null;
}

export interface SponsoredContentDto {
  id: string;
  label: 'Sponsored';
  name: string;
  type: 'CHALLENGE' | 'EVENT';
  sponsor: { name: string; logoUrl: string | null; websiteUrl: string | null };
  prizeDescription: string | null;
  terms: string;
  startsAt: string;
  endsAt: string;
  challenge: { id: string; title: string; endsAt: string } | null;
  events: { id: string; title: string; startsAt: string; meetingPoint: string }[];
}

export interface Announcement {
  id: string;
  clubId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  author: { id: string; username: string; profile: { displayName: string } | null };
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: string;
  audience: 'CLUB' | 'INDIVIDUAL';
  name: string;
  description: string | null;
  currency: string;
  amountMinor: number;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
  isDefault: boolean;
  entitlements: { key: string; intLimit: number | null; boolValue: boolean | null }[];
}

export interface BillingInfo {
  subscription: { id: string; status: string; currentPeriodEnd: string; graceUntil: string | null; cancelAtPeriodEnd: boolean; plan: Plan } | null;
  entitlements: { planCode: string | null; planName: string | null; status: string; values: Record<string, number | boolean> };
}

export type ClubWithCoords = ClubDetail & { latitude: number | null; longitude: number | null };

/** Typed client for the member-facing API (mobile app, public web, club admin dashboard). */
export function createMemberApi(options: Omit<HttpClientOptions, 'refreshPath'>) {
  const http = new HttpClient({ ...options, refreshPath: '/api/v1/auth/refresh' });
  const storeTokens = async (t: Partial<AuthTokens> & { accessToken: string }) => {
    await options.tokens.setTokens({ accessToken: t.accessToken, refreshToken: t.refreshToken });
    return t;
  };

  return {
    http,
    auth: {
      register: async (body: In<typeof v.registerSchema>) => storeTokens(await http.request<AuthTokens & { userId: string }>('/api/v1/auth/register', { method: 'POST', body, auth: false })),
      login: async (body: In<typeof v.loginSchema>) => storeTokens(await http.request<AuthTokens>('/api/v1/auth/login', { method: 'POST', body, auth: false })),
      logout: async () => {
        try {
          await http.request<void>('/api/v1/auth/logout', { method: 'POST' });
        } finally {
          await options.tokens.clear();
        }
      },
      logoutAll: async () => {
        try {
          return await http.request<{ revokedSessions: number }>('/api/v1/auth/logout-all', { method: 'POST' });
        } finally {
          await options.tokens.clear();
        }
      },
      sessions: () => http.request<SessionInfo[]>('/api/v1/auth/sessions'),
      revokeSession: (id: string) => http.request<void>(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' }),
      forgotPassword: (email: string) => http.request<{ message: string }>('/api/v1/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
      resetPassword: (token: string, password: string) => http.request<{ reset: true }>('/api/v1/auth/reset-password', { method: 'POST', body: { token, password }, auth: false }),
      verifyEmail: (token: string) => http.request<{ verified: true }>('/api/v1/auth/verify-email', { method: 'POST', body: { token }, auth: false }),
      resendVerification: () => http.request<{ sent: true }>('/api/v1/auth/verify-email/resend', { method: 'POST' }),
      changePassword: (body: In<typeof v.changePasswordSchema>) => http.request<{ changed: true }>('/api/v1/auth/change-password', { method: 'POST', body }),
      requestPhoneOtp: (body: In<typeof v.phoneOtpRequestSchema>) => http.request<{ sent: true }>('/api/v1/auth/phone/request-otp', { method: 'POST', body }),
      verifyPhoneOtp: async (body: In<typeof v.phoneOtpVerifySchema>) => {
        const res = await http.request<(AuthTokens & { status: 'authenticated' }) | { status: 'registration_required'; registrationToken: string } | { verified: true }>(
          '/api/v1/auth/phone/verify-otp',
          { method: 'POST', body },
        );
        if ('status' in res && res.status === 'authenticated') await storeTokens(res);
        return res;
      },
      completePhoneRegistration: async (body: In<typeof v.phoneRegistrationSchema>) =>
        storeTokens(await http.request<AuthTokens>('/api/v1/auth/phone/register', { method: 'POST', body, auth: false })),
      oauth: async (body: In<typeof v.oauthLoginSchema>) => storeTokens(await http.request<AuthTokens & { created: boolean }>('/api/v1/auth/oauth', { method: 'POST', body, auth: false })),
    },
    activities: {
      create: (body: In<typeof v.createActivitySchema>) => http.request<ActivityDto>('/api/v1/activities', { method: 'POST', body }),
      addPoints: (id: string, points: In<typeof v.gpsPointSchema>[]) => http.request<{ accepted: number; ignored: number }>(`/api/v1/activities/${id}/gps-points`, { method: 'POST', body: { points } }),
      complete: (id: string, body: In<typeof v.completeActivitySchema>) => http.request<ActivityDto>(`/api/v1/activities/${id}/complete`, { method: 'POST', body }),
      discard: (id: string) => http.request<void>(`/api/v1/activities/${id}/discard`, { method: 'POST', body: {} }),
      list: (query: Partial<In<typeof v.listActivitiesQuerySchema>> = {}) => http.page<ActivityDto>('/api/v1/activities', { query: query as Record<string, string> }),
      get: (id: string) => http.request<ActivityDto>(`/api/v1/activities/${id}`),
      update: (id: string, body: In<typeof v.updateActivitySchema>) => http.request<ActivityDto>(`/api/v1/activities/${id}`, { method: 'PATCH', body }),
      remove: (id: string) => http.request<void>(`/api/v1/activities/${id}`, { method: 'DELETE' }),
      stats: (query: { type?: string } = {}) => http.request<ActivityStatsDto>('/api/v1/activities/stats', { query }),
      trends: () => http.request<Record<string, unknown>>('/api/v1/activities/stats/trends'),
      goals: () => http.request<GoalDto[]>('/api/v1/activities/goals'),
      createGoal: (body: In<typeof v.goalSchema>) => http.request<GoalDto>('/api/v1/activities/goals', { method: 'POST', body }),
      deleteGoal: (id: string) => http.request<void>(`/api/v1/activities/goals/${id}`, { method: 'DELETE' }),
      ofUser: (userId: string, query: { cursor?: string } = {}) => http.page<ActivityDto>(`/api/v1/users/${userId}/activities`, { query }),
    },
    events: {
      discover: (query: { near?: string; radiusKm?: number; type?: string; cursor?: string; limit?: number } = {}) => http.page<EventDto>('/api/v1/events', { query, auth: false }),
      ofClub: (clubId: string, query: { from?: string; to?: string; includeCancelled?: boolean; cursor?: string; limit?: number } = {}) => http.page<EventDto>(`/api/v1/clubs/${clubId}/events`, { query }),
      create: (clubId: string, body: In<typeof v.createEventSchema>) => http.request<EventDto>(`/api/v1/clubs/${clubId}/events`, { method: 'POST', body }),
      get: (id: string) => http.request<EventDto>(`/api/v1/events/${id}`),
      update: (id: string, body: Record<string, unknown>) => http.request<EventDto>(`/api/v1/events/${id}`, { method: 'PATCH', body }),
      cancel: (id: string, reason: string, applyToSeries = false) => http.request<void>(`/api/v1/events/${id}/cancel`, { method: 'POST', body: { reason, applyToSeries } }),
      rsvp: (id: string, going: boolean) => http.request<{ status: string }>(`/api/v1/events/${id}/rsvp`, { method: 'POST', body: { going } }),
      participants: (id: string) => http.request<ParticipantsDto>(`/api/v1/events/${id}/participants`),
      checkInCode: (id: string) => http.request<{ code: string; expiresAt: string; deepLink: string }>(`/api/v1/events/${id}/check-in-code`),
      checkIn: (id: string, body: In<typeof v.checkInSchema>) => http.request<{ checkedInAt: string; method: string; distanceFromMeetingM: number | null }>(`/api/v1/events/${id}/check-in`, { method: 'POST', body }),
      markAttendance: (id: string, userId: string, present: boolean) => http.request<void>(`/api/v1/events/${id}/attendance`, { method: 'POST', body: { userId, present } }),
      attendanceCsv: (id: string) => http.text(`/api/v1/events/${id}/attendance.csv`),
    },
    reports: {
      overview: (clubId: string) => http.request<ClubOverviewDto>(`/api/v1/clubs/${clubId}/analytics`),
      growth: (clubId: string) => http.request<ClubGrowthDto>(`/api/v1/clubs/${clubId}/analytics/growth`),
      attendance: (clubId: string) => http.request<{ id: string; title: string; startsAt: string; status: string; going: number; capacity: number | null; attended: number; rate: number | null }[]>(`/api/v1/clubs/${clubId}/reports/attendance`),
      membersCsv: (clubId: string) => http.text(`/api/v1/clubs/${clubId}/reports/members.csv`),
    },
    social: {
      feed: (query: { cursor?: string; limit?: number; clubId?: string } = {}) => http.page<PostDto>('/api/v1/feed', { query }),
      createPost: (body: In<typeof v.createPostSchema>) => http.request<PostDto>('/api/v1/posts', { method: 'POST', body }),
      post: (id: string) => http.request<PostDto>(`/api/v1/posts/${id}`),
      deletePost: (id: string) => http.request<void>(`/api/v1/posts/${id}`, { method: 'DELETE' }),
      like: (id: string, on: boolean) => http.request<{ liked: boolean }>(`/api/v1/posts/${id}/like`, { method: on ? 'POST' : 'DELETE' }),
      bookmark: (id: string, on: boolean) => http.request<{ bookmarked: boolean }>(`/api/v1/posts/${id}/bookmark`, { method: on ? 'POST' : 'DELETE' }),
      bookmarks: (query: { cursor?: string } = {}) => http.page<PostDto>('/api/v1/posts/bookmarks', { query }),
      comments: (postId: string, query: { cursor?: string } = {}) => http.page<CommentDto>(`/api/v1/posts/${postId}/comments`, { query }),
      comment: (postId: string, body: string, parentId?: string) => http.request<CommentDto>(`/api/v1/posts/${postId}/comments`, { method: 'POST', body: { body, parentId } }),
      deleteComment: (id: string) => http.request<void>(`/api/v1/comments/${id}`, { method: 'DELETE' }),
      follow: (userId: string) => http.request<{ status: string }>(`/api/v1/users/${userId}/follow`, { method: 'POST' }),
      unfollow: (userId: string) => http.request<void>(`/api/v1/users/${userId}/follow`, { method: 'DELETE' }),
      followRequests: () => http.request<{ id: string; username: string; profile: { displayName: string } | null; requestedAt: string }[]>('/api/v1/users/me/follow-requests'),
      respond: (userId: string, accept: boolean) => http.request<void>(`/api/v1/users/me/follow-requests/${userId}`, { method: 'POST', body: { accept } }),
      userPosts: (userId: string, query: { cursor?: string } = {}) => http.page<PostDto>(`/api/v1/users/${userId}/posts`, { query }),
      report: (body: In<typeof v.reportSchema>) => http.request<{ id: string }>('/api/v1/reports', { method: 'POST', body }),
    },
    media: {
      request: (body: { purpose: 'AVATAR' | 'CLUB_LOGO' | 'CLUB_COVER' | 'POST' | 'EVENT_COVER'; mimeType: string; sizeBytes: number }) =>
        http.request<{ mediaId: string; upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string } }>('/api/v1/media', { method: 'POST', body }),
      complete: (id: string) => http.request<MediaDto>(`/api/v1/media/${id}/complete`, { method: 'POST' }),
      get: (id: string) => http.request<MediaDto>(`/api/v1/media/${id}`),
      setAvatar: (mediaId: string) => http.request<MeUser>('/api/v1/users/me/avatar', { method: 'PUT', body: { mediaId } }),
      setClubBranding: (clubId: string, body: { logoMediaId?: string; coverMediaId?: string }) => http.request<unknown>(`/api/v1/clubs/${clubId}/branding`, { method: 'PUT', body }),
    },
    messaging: {
      list: () => http.request<ConversationSummaryDto[]>('/api/v1/conversations'),
      direct: (userId: string) => http.request<ConversationDto>('/api/v1/conversations/direct', { method: 'POST', body: { userId } }),
      club: (clubId: string) => http.request<ConversationDto>(`/api/v1/conversations/club/${clubId}`, { method: 'POST' }),
      event: (eventId: string) => http.request<ConversationDto>(`/api/v1/conversations/event/${eventId}`, { method: 'POST' }),
      get: (id: string) => http.request<ConversationDto>(`/api/v1/conversations/${id}`),
      messages: (id: string, query: { cursor?: string; limit?: number } = {}) => http.page<MessageDto>(`/api/v1/conversations/${id}/messages`, { query }),
      send: (id: string, body: string, clientId?: string) => http.request<MessageDto>(`/api/v1/conversations/${id}/messages`, { method: 'POST', body: { body, clientId } }),
      read: (id: string) => http.request<unknown>(`/api/v1/conversations/${id}/read`, { method: 'POST' }),
    },
    moderation: {
      clubReports: (clubId: string, status = 'OPEN') => http.page<ReportDto>(`/api/v1/clubs/${clubId}/reports`, { query: { status } }),
      resolveClubReport: (clubId: string, reportId: string, action: 'DISMISS' | 'HIDE', note?: string) => http.request<void>(`/api/v1/clubs/${clubId}/reports/${reportId}/resolve`, { method: 'POST', body: { action, note } }),
    },
    challenges: {
      list: (query: { cursor?: string; mine?: boolean } = {}) => http.page<ChallengeDto>('/api/v1/challenges', { query }),
      get: (id: string) => http.request<ChallengeDto>(`/api/v1/challenges/${id}`),
      join: (id: string, body: { teamClubId?: string; hideFromLeaderboard?: boolean; acceptTerms?: boolean } = {}) => http.request<ChallengeDto>(`/api/v1/challenges/${id}/join`, { method: 'POST', body }),
      leave: (id: string) => http.request<void>(`/api/v1/challenges/${id}/leave`, { method: 'POST' }),
      leaderboard: (id: string) => http.request<ChallengeLeaderboardDto>(`/api/v1/challenges/${id}/leaderboard`),
      createForClub: (clubId: string, body: In<typeof v.createChallengeSchema>) => http.request<ChallengeDto>(`/api/v1/clubs/${clubId}/challenges`, { method: 'POST', body }),
      cancel: (id: string) => http.request<void>(`/api/v1/challenges/${id}/cancel`, { method: 'POST' }),
    },
    leaderboards: {
      get: (query: { scope?: 'GLOBAL' | 'CLUB'; clubId?: string; period?: 'WEEK' | 'MONTH'; activityType?: 'WALK' | 'RUN' } = {}) => http.request<LeaderboardDto>('/api/v1/leaderboards', { query }),
      following: (period: 'WEEK' | 'MONTH' = 'WEEK') => http.request<LeaderboardDto>('/api/v1/leaderboards/following', { query: { period } }),
    },
    achievements: {
      mine: () => http.request<AchievementDto[]>('/api/v1/achievements/me'),
      ofUser: (userId: string) => http.request<AchievementDto[]>(`/api/v1/achievements/users/${userId}`),
    },
    billing: {
      providers: () => http.request<{ id: string; currencies: string[] }[]>('/api/v1/subscriptions/providers', { auth: false }),
      checkout: (body: In<typeof v.checkoutSchema>, idempotencyKey: string) => http.request<CheckoutResultDto>('/api/v1/subscriptions/checkout', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
      payment: (id: string) => http.request<CheckoutResultDto>(`/api/v1/payments/${id}`),
      myPayments: () => http.request<PaymentRowDto[]>('/api/v1/payments/me'),
      clubPayments: (clubId: string) => http.request<PaymentRowDto[]>(`/api/v1/payments/clubs/${clubId}`),
      invoiceHtml: (invoiceId: string) => http.text(`/api/v1/payments/invoices/${invoiceId}/html`),
    },
    sponsorships: {
      active: () => http.request<SponsoredContentDto[]>('/api/v1/sponsored', { auth: false }),
      mine: () => http.request<(SponsorDto & { campaigns: CampaignDto[] })[]>('/api/v1/sponsors/mine'),
      apply: (body: In<typeof v.sponsorSchema>) => http.request<SponsorDto>('/api/v1/sponsors', { method: 'POST', body }),
      createCampaign: (sponsorId: string, body: In<typeof v.campaignSchema>) => http.request<CampaignDto>(`/api/v1/sponsors/${sponsorId}/campaigns`, { method: 'POST', body }),
      submit: (campaignId: string) => http.request<CampaignDto>(`/api/v1/campaigns/${campaignId}/submit`, { method: 'POST' }),
      checkout: (campaignId: string, body: In<typeof v.campaignCheckoutSchema>, idempotencyKey: string) => http.request<CheckoutResultDto>(`/api/v1/payments/campaigns/${campaignId}/checkout`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
      report: (campaignId: string) => http.request<Record<string, unknown>>(`/api/v1/campaigns/${campaignId}/report`),
      clubOffers: (clubId: string) => http.request<{ eventId: string; acceptedAt: string | null; event: { id: string; title: string; startsAt: string }; campaign: { id: string; name: string; terms: string; prizeDescription: string | null; sponsor: { name: string; logoUrl: string | null; websiteUrl: string | null } } }[]>(`/api/v1/clubs/${clubId}/sponsorship-offers`),
      respondOffer: (clubId: string, eventId: string, accept: boolean) => http.request<void>(`/api/v1/clubs/${clubId}/sponsorship-offers/${eventId}`, { method: 'POST', body: { accept } }),
    },
    notifications: {
      list: (query: { cursor?: string; limit?: number } = {}) => http.requestWithMeta<AppNotification[]>('/api/v1/notifications', { query }),
      read: (id: string) => http.request<void>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
      readAll: () => http.request<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST', body: {} }),
    },
    subscriptions: {
      plans: (audience?: 'CLUB' | 'INDIVIDUAL') => http.request<Plan[]>('/api/v1/subscriptions/plans', { query: { audience }, auth: false }),
      me: () => http.request<BillingInfo>('/api/v1/subscriptions/me'),
      cancelMine: () => http.request<unknown>('/api/v1/subscriptions/me/cancel', { method: 'POST', body: {} }),
    },
    users: {
      me: () => http.request<MeUser>('/api/v1/users/me'),
      updateMe: (body: In<typeof v.updateMeSchema>) => http.request<MeUser>('/api/v1/users/me', { method: 'PATCH', body }),
      updatePrivacy: (body: In<typeof v.updatePrivacySchema>) => http.request<unknown>('/api/v1/users/me/privacy', { method: 'PATCH', body }),
      myClubs: () => http.request<MyClub[]>('/api/v1/users/me/clubs'),
      registerDevice: (body: In<typeof v.registerDeviceSchema>) => http.request<unknown>('/api/v1/users/me/devices', { method: 'POST', body }),
      profile: (username: string) => http.request<Record<string, unknown>>(`/api/v1/users/${encodeURIComponent(username)}`),
      deleteAccount: (body: In<typeof v.deleteAccountSchema>) => http.request<{ scheduledAt: string }>('/api/v1/users/me', { method: 'DELETE', body }),
    },
    clubs: {
      list: (query: Partial<In<typeof v.listClubsQuerySchema>> = {}) => http.page<ClubSummary>('/api/v1/clubs', { query: query as Record<string, string | number | undefined>, auth: true }),
      get: (slugOrId: string) => http.request<ClubWithCoords>(`/api/v1/clubs/${encodeURIComponent(slugOrId)}`),
      create: (body: In<typeof v.createClubSchema>) => http.request<ClubWithCoords>('/api/v1/clubs', { method: 'POST', body }),
      update: (clubId: string, body: In<typeof v.updateClubSchema>) => http.request<ClubWithCoords>(`/api/v1/clubs/${clubId}`, { method: 'PATCH', body }),
      join: (clubId: string, body: In<typeof v.joinClubSchema> = {}) => http.request<{ membershipId: string; status: string }>(`/api/v1/clubs/${clubId}/join`, { method: 'POST', body }),
      leave: (clubId: string) => http.request<void>(`/api/v1/clubs/${clubId}/leave`, { method: 'POST' }),
      members: (clubId: string, query: Partial<In<typeof v.listMembersQuerySchema>> = {}) => http.page<ClubMember>(`/api/v1/clubs/${clubId}/members`, { query: query as Record<string, string | number | undefined> }),
      review: (clubId: string, membershipId: string, body: In<typeof v.reviewMembershipSchema>) =>
        http.request<{ status: string }>(`/api/v1/clubs/${clubId}/members/${membershipId}/review`, { method: 'POST', body }),
      assignRole: (clubId: string, membershipId: string, roleId: string) => http.request<unknown>(`/api/v1/clubs/${clubId}/members/${membershipId}/role`, { method: 'PUT', body: { roleId } }),
      moderate: (clubId: string, membershipId: string, body: In<typeof v.memberModerationSchema>) =>
        http.request<{ status: string }>(`/api/v1/clubs/${clubId}/members/${membershipId}/moderation`, { method: 'POST', body }),
      roles: (clubId: string) => http.request<ClubRoleInfo[]>(`/api/v1/clubs/${clubId}/roles`),
      createInvitation: (clubId: string, body: In<typeof v.createInvitationSchema>) =>
        http.request<{ id: string; code: string; expiresAt: string; maxUses: number }>(`/api/v1/clubs/${clubId}/invitations`, { method: 'POST', body }),
      invitations: (clubId: string) =>
        http.request<{ id: string; codeHint: string; email: string | null; phone: string | null; maxUses: number; useCount: number; expiresAt: string; revokedAt: string | null; createdAt: string }[]>(
          `/api/v1/clubs/${clubId}/invitations`,
        ),
      revokeInvitation: (clubId: string, invitationId: string) => http.request<void>(`/api/v1/clubs/${clubId}/invitations/${invitationId}`, { method: 'DELETE' }),
      createRole: (clubId: string, body: In<typeof v.roleInputSchema>) => http.request<ClubRoleInfo>(`/api/v1/clubs/${clubId}/roles`, { method: 'POST', body }),
      updateRole: (clubId: string, roleId: string, body: In<typeof v.updateRoleSchema>) => http.request<unknown>(`/api/v1/clubs/${clubId}/roles/${roleId}`, { method: 'PATCH', body }),
      deleteRole: (clubId: string, roleId: string) => http.request<void>(`/api/v1/clubs/${clubId}/roles/${roleId}`, { method: 'DELETE' }),
      transferOwnership: (clubId: string, membershipId: string, password?: string) => http.request<{ ownerId: string }>(`/api/v1/clubs/${clubId}/transfer-ownership`, { method: 'POST', body: { membershipId, password } }),
      announcements: (clubId: string, query: { cursor?: string; limit?: number } = {}) => http.page<Announcement>(`/api/v1/clubs/${clubId}/announcements`, { query }),
      createAnnouncement: (clubId: string, body: In<typeof v.announcementSchema>) => http.request<Announcement>(`/api/v1/clubs/${clubId}/announcements`, { method: 'POST', body }),
      updateAnnouncement: (clubId: string, id: string, body: In<typeof v.updateAnnouncementSchema>) => http.request<Announcement>(`/api/v1/clubs/${clubId}/announcements/${id}`, { method: 'PATCH', body }),
      deleteAnnouncement: (clubId: string, id: string) => http.request<void>(`/api/v1/clubs/${clubId}/announcements/${id}`, { method: 'DELETE' }),
      billing: (clubId: string) => http.request<BillingInfo>(`/api/v1/subscriptions/clubs/${clubId}`),
      cancelSubscription: (clubId: string) => http.request<unknown>(`/api/v1/subscriptions/clubs/${clubId}/cancel`, { method: 'POST', body: {} }),
      previewInvitation: (code: string) => http.request<{ club: { id: string; slug: string; name: string; logoUrl: string | null }; expiresAt: string }>(`/api/v1/clubs/invitations/${encodeURIComponent(code)}`, { auth: false }),
    },
  };
}

export type MemberApi = ReturnType<typeof createMemberApi>;
