import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';
import * as v from '@walktogether/validation';

extendZodWithOpenApi(z);

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the server validates with,
 * so documentation cannot drift from behaviour. Served at /api/docs (non-production).
 */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const adminBearer = registry.registerComponent('securitySchemes', 'adminBearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

  const error = registry.register(
    'Error',
    z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.any().optional(), requestId: z.string().optional() }) }),
  );
  const ok = { description: 'Success', content: { 'application/json': { schema: z.object({ data: z.any(), meta: z.any().optional() }) } } };
  const errors = {
    400: { description: 'Bad request', content: { 'application/json': { schema: error } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: error } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: error } } },
    404: { description: 'Not found (also returned for resources the caller may not see)', content: { 'application/json': { schema: error } } },
    422: { description: 'Validation error', content: { 'application/json': { schema: error } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: error } } },
  };

  type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
  const route = (method: Method, path: string, tag: string, summary: string, opts: { body?: ZodTypeAny; query?: z.AnyZodObject; auth?: 'member' | 'admin' } = {}) =>
    registry.registerPath({
      method,
      path,
      tags: [tag],
      summary,
      security: opts.auth === 'member' ? [{ [bearer.name]: [] }] : opts.auth === 'admin' ? [{ [adminBearer.name]: [] }] : [],
      request: {
        ...(opts.body ? { body: { content: { 'application/json': { schema: opts.body } } } } : {}),
        ...(opts.query ? { query: opts.query } : {}),
      },
      responses: { 200: ok, ...errors },
    });

  // Auth
  route('post', '/api/v1/auth/register', 'Auth', 'Register with email and password', { body: v.registerSchema });
  route('post', '/api/v1/auth/login', 'Auth', 'Sign in with email and password', { body: v.loginSchema });
  route('post', '/api/v1/auth/refresh', 'Auth', 'Rotate refresh token (body for mobile, httpOnly cookie + X-WT-Client: web for web)', { body: v.refreshSchema });
  route('post', '/api/v1/auth/logout', 'Auth', 'Sign out of the current device', { auth: 'member' });
  route('post', '/api/v1/auth/logout-all', 'Auth', 'Sign out of all devices', { auth: 'member' });
  route('get', '/api/v1/auth/sessions', 'Auth', 'List active device sessions', { auth: 'member' });
  route('delete', '/api/v1/auth/sessions/{sessionId}', 'Auth', 'Revoke one device session', { auth: 'member' });
  route('get', '/api/v1/auth/login-history', 'Auth', 'Recent sign-in history', { auth: 'member' });
  route('post', '/api/v1/auth/verify-email', 'Auth', 'Verify email with emailed token', { body: v.verifyEmailSchema });
  route('post', '/api/v1/auth/verify-email/resend', 'Auth', 'Resend verification email', { auth: 'member' });
  route('post', '/api/v1/auth/forgot-password', 'Auth', 'Request a password reset email', { body: v.forgotPasswordSchema });
  route('post', '/api/v1/auth/reset-password', 'Auth', 'Reset password with emailed token', { body: v.resetPasswordSchema });
  route('post', '/api/v1/auth/change-password', 'Auth', 'Change password (signs out other devices)', { body: v.changePasswordSchema, auth: 'member' });
  route('post', '/api/v1/auth/phone/request-otp', 'Auth', 'Send an SMS one-time code (VERIFY requires auth)', { body: v.phoneOtpRequestSchema });
  route('post', '/api/v1/auth/phone/verify-otp', 'Auth', 'Verify SMS code: sign in, start phone sign-up, or verify phone', { body: v.phoneOtpVerifySchema });
  route('post', '/api/v1/auth/phone/register', 'Auth', 'Complete phone sign-up', { body: v.phoneRegistrationSchema });
  route('post', '/api/v1/auth/oauth', 'Auth', 'Sign in with a Google or Apple ID token', { body: v.oauthLoginSchema });

  // Users
  route('get', '/api/v1/users/me', 'Users', 'Current user', { auth: 'member' });
  route('patch', '/api/v1/users/me', 'Users', 'Update profile', { body: v.updateMeSchema, auth: 'member' });
  route('post', '/api/v1/users/me/email', 'Users', 'Change email (requires re-verification)', { body: z.object({ email: v.emailSchema }), auth: 'member' });
  route('patch', '/api/v1/users/me/privacy', 'Users', 'Update privacy settings', { body: v.updatePrivacySchema, auth: 'member' });
  route('get', '/api/v1/users/me/notification-settings', 'Users', 'Notification preferences', { auth: 'member' });
  route('patch', '/api/v1/users/me/notification-settings', 'Users', 'Update notification preferences', { body: v.updateNotificationSettingsSchema, auth: 'member' });
  route('post', '/api/v1/users/me/devices', 'Users', 'Register push notification device', { body: v.registerDeviceSchema, auth: 'member' });
  route('delete', '/api/v1/users/me/devices/{id}', 'Users', 'Remove push device', { auth: 'member' });
  route('get', '/api/v1/users/me/clubs', 'Users', 'Clubs I belong to, with my role and permissions', { auth: 'member' });
  route('get', '/api/v1/users/me/blocks', 'Users', 'Users I have blocked', { auth: 'member' });
  route('get', '/api/v1/users/me/export', 'Users', 'Download my personal data (JSON)', { auth: 'member' });
  route('delete', '/api/v1/users/me', 'Users', 'Request account deletion (30-day grace period)', { body: v.deleteAccountSchema, auth: 'member' });
  route('post', '/api/v1/users/{id}/block', 'Users', 'Block a user', { auth: 'member' });
  route('delete', '/api/v1/users/{id}/block', 'Users', 'Unblock a user', { auth: 'member' });
  route('get', '/api/v1/users/{username}', 'Users', 'Public profile (privacy-filtered)');

  // Clubs
  route('post', '/api/v1/clubs', 'Clubs', 'Create a club (caller becomes owner)', { body: v.createClubSchema, auth: 'member' });
  route('get', '/api/v1/clubs', 'Clubs', 'Discover clubs (search, category, country, nearby)', { query: v.listClubsQuerySchema });
  route('get', '/api/v1/clubs/{slugOrId}', 'Clubs', 'Club details by slug or id');
  route('patch', '/api/v1/clubs/{clubId}', 'Clubs', 'Update club (club.settings.update)', { body: v.updateClubSchema, auth: 'member' });
  route('post', '/api/v1/clubs/{clubId}/join', 'Memberships', 'Join or request to join', { body: v.joinClubSchema, auth: 'member' });
  route('post', '/api/v1/clubs/{clubId}/leave', 'Memberships', 'Leave a club', { auth: 'member' });
  route('get', '/api/v1/clubs/{clubId}/members', 'Memberships', 'List members (members.view; PENDING needs members.approve)', { query: v.listMembersQuerySchema, auth: 'member' });
  route('post', '/api/v1/clubs/{clubId}/members/{membershipId}/review', 'Memberships', 'Approve/reject a request', { body: v.reviewMembershipSchema, auth: 'member' });
  route('put', '/api/v1/clubs/{clubId}/members/{membershipId}/role', 'Memberships', 'Assign a role', { body: v.assignRoleSchema, auth: 'member' });
  route('post', '/api/v1/clubs/{clubId}/members/{membershipId}/moderation', 'Memberships', 'Suspend, reinstate, remove or ban', { body: v.memberModerationSchema, auth: 'member' });
  route('get', '/api/v1/clubs/{clubId}/roles', 'Memberships', 'List club roles and permissions', { auth: 'member' });
  route('post', '/api/v1/clubs/{clubId}/invitations', 'Memberships', 'Create invitation (code returned once)', { body: v.createInvitationSchema, auth: 'member' });
  route('get', '/api/v1/clubs/{clubId}/invitations', 'Memberships', 'List invitations', { auth: 'member' });
  route('delete', '/api/v1/clubs/{clubId}/invitations/{invitationId}', 'Memberships', 'Revoke invitation', { auth: 'member' });
  route('get', '/api/v1/clubs/invitations/{code}', 'Memberships', 'Preview an invitation code');

  // Platform admin
  route('post', '/api/v1/platform-admin/auth/login', 'Platform admin', 'Admin password step (returns MFA token)', { body: v.adminLoginSchema });
  route('post', '/api/v1/platform-admin/auth/mfa/setup', 'Platform admin', 'Enrol TOTP authenticator (first login)', { body: v.adminMfaSetupSchema });
  route('post', '/api/v1/platform-admin/auth/mfa/verify', 'Platform admin', 'Verify TOTP and start admin session', { body: v.adminMfaVerifySchema });
  route('post', '/api/v1/platform-admin/auth/refresh', 'Platform admin', 'Rotate admin refresh token');
  route('post', '/api/v1/platform-admin/auth/logout', 'Platform admin', 'End admin session', { auth: 'admin' });
  route('get', '/api/v1/platform-admin/me', 'Platform admin', 'Current admin and permissions', { auth: 'admin' });
  route('get', '/api/v1/platform-admin/overview', 'Platform admin', 'Platform KPIs', { auth: 'admin' });
  route('get', '/api/v1/platform-admin/users', 'Platform admin', 'Search users', { query: v.adminListUsersQuerySchema, auth: 'admin' });
  route('get', '/api/v1/platform-admin/users/{id}', 'Platform admin', 'User detail', { auth: 'admin' });
  route('post', '/api/v1/platform-admin/users/{id}/status', 'Platform admin', 'Suspend / reactivate user', { body: v.adminStatusChangeSchema, auth: 'admin' });
  route('get', '/api/v1/platform-admin/clubs', 'Platform admin', 'Search clubs', { query: v.adminListClubsQuerySchema, auth: 'admin' });
  route('get', '/api/v1/platform-admin/clubs/{id}', 'Platform admin', 'Club detail', { auth: 'admin' });
  route('post', '/api/v1/platform-admin/clubs/{id}/status', 'Platform admin', 'Suspend / reactivate club', { body: v.adminStatusChangeSchema, auth: 'admin' });
  route('post', '/api/v1/platform-admin/clubs/{id}/approve', 'Platform admin', 'Approve a pending club', { auth: 'admin' });
  route('get', '/api/v1/platform-admin/audit-logs', 'Platform admin', 'Audit log', { query: v.adminAuditQuerySchema, auth: 'admin' });
  route('get', '/api/v1/platform-admin/settings', 'Platform admin', 'Platform settings', { auth: 'admin' });
  route('put', '/api/v1/platform-admin/settings/{key}', 'Platform admin', 'Update a platform setting', { auth: 'admin' });
  route('get', '/api/v1/platform-admin/feature-flags', 'Platform admin', 'Feature flags', { auth: 'admin' });
  route('put', '/api/v1/platform-admin/feature-flags/{key}', 'Platform admin', 'Update a feature flag', { auth: 'admin' });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'WalkTogether API', version: '1.0.0', description: 'Multi-club fitness social network and SaaS platform. All responses use { data, meta? } or { error }.' },
    servers: [{ url: '/' }],
  });
}
