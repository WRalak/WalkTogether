import { Router, type CookieOptions, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  oauthLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  phoneRegistrationSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@walktogether/validation';
import { z } from 'zod';
import { cookieSecure, env } from '../../config/env';
import { authUserId, optionalAuth, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { authLimiter, otpLimiter } from '../../middleware/rate-limit';
import { parse } from '../../middleware/validate';
import { unauthorized } from '../../shared/errors';
import * as auth from './auth.service';
import * as phone from './phone.service';
import { loginWithOAuth } from './oauth.service';

export const REFRESH_COOKIE = 'wt_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Web clients send `X-WT-Client: web`; they receive the refresh token only as an httpOnly,
 * SameSite=Strict cookie so it is never readable by JavaScript. Mobile clients receive it in the
 * body and store it in the device keystore (Expo SecureStore).
 */
const isWebClient = (req: Request) => req.header('x-wt-client') === 'web';

function cookieOptions(expires?: Date): CookieOptions {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: REFRESH_COOKIE_PATH, domain: env.COOKIE_DOMAIN, expires };
}

function sendTokens(req: Request, res: Response, tokens: auth.IssuedTokens, status = 200, extra: Record<string, unknown> = {}) {
  if (isWebClient(req)) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(new Date(tokens.refreshTokenExpiresAt)));
    const { refreshToken: _omit, ...rest } = tokens;
    res.status(status).json({ data: { ...rest, ...extra } });
    return;
  }
  res.status(status).json({ data: { ...tokens, ...extra } });
}

const clientCtx = (req: Request, device?: auth.DeviceInfo): auth.ClientContext => ({ ...auditCtx(req), device });

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const result = await auth.register(input, clientCtx(req, input.device));
  sendTokens(req, res, result.tokens, 201, { userId: result.userId });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  sendTokens(req, res, await auth.login(input, clientCtx(req, input.device)));
});

authRouter.post('/refresh', authLimiter, async (req, res) => {
  const body = parse(refreshSchema, req.body);
  let token = body.refreshToken;
  if (!token && isWebClient(req)) token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('Refresh token required', 'INVALID_REFRESH_TOKEN');
  sendTokens(req, res, await auth.refreshSession(token, auditCtx(req)));
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await auth.revokeOwnSession(req.auth!.userId, req.auth!.sessionId, auditCtx(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  const revoked = await auth.logoutAll(authUserId(req), auditCtx(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.json({ data: { revokedSessions: revoked } });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  res.json({ data: await auth.listSessions(req.auth!.userId, req.auth!.sessionId) });
});

authRouter.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
  const { sessionId } = parse(z.object({ sessionId: z.string().uuid() }), req.params);
  await auth.revokeOwnSession(authUserId(req), sessionId, auditCtx(req));
  res.status(204).end();
});

authRouter.get('/login-history', requireAuth, async (req, res) => {
  res.json({ data: await auth.loginHistory(authUserId(req)) });
});

authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = parse(verifyEmailSchema, req.body);
  await auth.verifyEmail(token, auditCtx(req));
  res.json({ data: { verified: true } });
});

authRouter.post('/verify-email/resend', requireAuth, authLimiter, async (req, res) => {
  await auth.resendEmailVerification(authUserId(req));
  res.status(202).json({ data: { sent: true } });
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  await auth.forgotPassword(email, auditCtx(req));
  // Identical response regardless of whether the account exists.
  res.status(202).json({ data: { message: 'If an account exists for that email, a reset link has been sent.' } });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  await auth.resetPassword(token, password, auditCtx(req));
  res.json({ data: { reset: true } });
});

authRouter.post('/change-password', requireAuth, authLimiter, async (req, res) => {
  const input = parse(changePasswordSchema, req.body);
  await auth.changePassword(req.auth!.userId, req.auth!.sessionId, input.currentPassword, input.newPassword, auditCtx(req));
  res.json({ data: { changed: true } });
});

// Phone OTP ------------------------------------------------------------------

authRouter.post('/phone/request-otp', otpLimiter, optionalAuth, async (req, res) => {
  const input = parse(phoneOtpRequestSchema, req.body);
  // VERIFY binds the code to the signed-in account.
  if (input.purpose === 'VERIFY' && !req.auth) throw unauthorized();
  await phone.requestOtp(input.phone, input.purpose, req.auth?.userId);
  res.status(202).json({ data: { sent: true } });
});

authRouter.post('/phone/verify-otp', authLimiter, optionalAuth, async (req, res) => {
  const input = parse(phoneOtpVerifySchema, req.body);
  if (input.purpose === 'VERIFY') {
    if (!req.auth) throw unauthorized();
    await phone.verifyPhoneForUser(req.auth!.userId, input.phone, input.code, auditCtx(req));
    res.json({ data: { verified: true } });
    return;
  }
  const result = await phone.loginWithPhone(input.phone, input.code, clientCtx(req, input.device));
  if (result.status === 'authenticated') {
    sendTokens(req, res, result.tokens, 200, { status: result.status });
    return;
  }
  res.json({ data: result });
});

authRouter.post('/phone/register', authLimiter, async (req, res) => {
  const input = parse(phoneRegistrationSchema, req.body);
  sendTokens(req, res, await phone.completePhoneRegistration(input, clientCtx(req, input.device)), 201);
});

// OAuth (Google / Apple ID tokens from native SDKs or web) -------------------------

authRouter.post('/oauth', authLimiter, async (req, res) => {
  const input = parse(oauthLoginSchema, req.body);
  const result = await loginWithOAuth(input.provider, input.idToken, input.displayName, clientCtx(req, input.device));
  sendTokens(req, res, result.tokens, result.created ? 201 : 200, { created: result.created });
});
