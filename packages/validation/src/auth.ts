import { z } from 'zod';
import { emailSchema, otpCodeSchema, passwordSchema, phoneSchema, usernameSchema } from './common';

export const deviceInfoSchema = z
  .object({
    deviceId: z.string().trim().min(8).max(128).optional(),
    deviceName: z.string().trim().max(100).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    appVersion: z.string().trim().max(32).optional(),
  })
  .strict();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(60),
    phone: phoneSchema.optional(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms of service' }),
    device: deviceInfoSchema.optional(),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    device: deviceInfoSchema.optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512).optional() }).strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(256), password: passwordSchema })
  .strict();

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(256) }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

export const phoneOtpRequestSchema = z
  .object({ phone: phoneSchema, purpose: z.enum(['LOGIN', 'VERIFY']) })
  .strict();

export const phoneOtpVerifySchema = z
  .object({ phone: phoneSchema, code: otpCodeSchema, purpose: z.enum(['LOGIN', 'VERIFY']), device: deviceInfoSchema.optional() })
  .strict();

export const oauthLoginSchema = z
  .object({
    provider: z.enum(['google', 'apple']),
    idToken: z.string().min(20).max(8192),
    /** Apple only returns the name on first sign-in; client passes it through. */
    displayName: z.string().trim().max(60).optional(),
    device: deviceInfoSchema.optional(),
  })
  .strict();

export const deleteAccountSchema = z
  .object({ password: z.string().max(128).optional(), confirm: z.literal('DELETE') })
  .strict();

export const phoneRegistrationSchema = z
  .object({
    registrationToken: z.string().min(20).max(2048),
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(60),
    acceptTerms: z.literal(true, { error: 'You must accept the terms of service' }),
    device: deviceInfoSchema.optional(),
  })
  .strict();
