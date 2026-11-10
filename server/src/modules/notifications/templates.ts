import { env } from '../../config/env';
import type { EmailMessage } from './email';

const footer = '\n\n— The WalkTogether team\nIf you did not request this, you can ignore this email.';

export const templates = {
  verifyEmail(to: string, name: string, token: string): EmailMessage {
    const link = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
    return {
      to,
      subject: 'Verify your WalkTogether email',
      text: `Hi ${name},\n\nConfirm your email address by opening this link (valid for 24 hours):\n${link}${footer}`,
    };
  },
  passwordReset(to: string, token: string): EmailMessage {
    const link = `${env.PUBLIC_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
    return {
      to,
      subject: 'Reset your WalkTogether password',
      text: `We received a request to reset your password. This link is valid for 30 minutes:\n${link}${footer}`,
    };
  },
  passwordChanged(to: string): EmailMessage {
    return {
      to,
      subject: 'Your WalkTogether password was changed',
      text: `Your password was just changed and all other devices were signed out. If this wasn't you, reset your password immediately and contact support.${footer}`,
    };
  },
  suspiciousLogin(to: string, details: { ip?: string | null; device?: string | null; at: Date }): EmailMessage {
    return {
      to,
      subject: 'New sign-in to your WalkTogether account',
      text: `We noticed a sign-in from a new device or location.\n\nTime: ${details.at.toISOString()}\nDevice: ${details.device ?? 'unknown'}\nIP: ${details.ip ?? 'unknown'}\n\nIf this was you, no action is needed. Otherwise, change your password and sign out of all devices from Settings → Security.${footer}`,
    };
  },
  accountDeletionScheduled(to: string, at: Date): EmailMessage {
    return {
      to,
      subject: 'Your WalkTogether account is scheduled for deletion',
      text: `Your account will be permanently deleted on ${at.toDateString()}. Sign in before then to cancel.${footer}`,
    };
  },
};
