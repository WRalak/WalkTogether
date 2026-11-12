import express, { Router } from 'express';
import { z } from 'zod';
import { passwordSchema } from '@walktogether/validation';
import { env } from '../../config/env';
import { authLimiter } from '../../middleware/rate-limit';
import { auditCtx } from '../../middleware/request-context';
import { AppError } from '../../shared/errors';
import * as auth from '../auth/auth.service';
import { previewInvitation } from '../memberships/memberships.service';
import { privacyHtml, termsHtml } from './legal';
import { appLink, esc, page } from './page';

/**
 * Pages opened from outside the app: email links, Stripe returns, invitation links and the legal
 * pages app stores require. Mounted at the API root (`/links/...`, `/legal/...`).
 */
export const linksRouter = Router();
const form = express.urlencoded({ extended: false, limit: '4kb' });
const token = z.string().min(20).max(256);

function send(res: express.Response, html: string, status = 200) {
  res.status(status).set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').type('html').send(html);
}
const failMessage = (err: unknown, fallback: string) => (err instanceof AppError && err.status < 500 ? err.message : fallback);

linksRouter.get('/links/verify-email', authLimiter, async (req, res) => {
  const parsed = token.safeParse(req.query.token);
  if (!parsed.success) return send(res, page('Link invalid', '<h1>This link is invalid</h1><p>Request a new verification email from the app.</p>', { status: 'error' }), 400);
  try {
    await auth.verifyEmail(parsed.data, auditCtx(req));
    send(res, page('Email verified', `<h1>Email verified</h1><p>Thanks — your email address is confirmed. You can return to the app.</p><a class="btn" href="${appLink('/')}">Open WalkTogether</a>`));
  } catch (err) {
    send(res, page('Link expired', `<h1>We couldn’t verify your email</h1><p>${esc(failMessage(err, 'Something went wrong.'))}</p><p>Request a new link from the app.</p>`, { status: 'error' }), 400);
  }
});

const resetForm = (t: string, error?: string) =>
  page(
    'Reset password',
    `<h1>Choose a new password</h1>
     ${error ? `<p role="alert" style="color:#b42318">${esc(error)}</p>` : '<p>Use at least 10 characters. You’ll be signed out on all other devices.</p>'}
     <form method="post" autocomplete="off">
       <input type="hidden" name="token" value="${esc(t)}">
       <label for="password">New password</label>
       <input id="password" name="password" type="password" minlength="10" maxlength="128" required autocomplete="new-password">
       <label for="confirm">Confirm new password</label>
       <input id="confirm" name="confirm" type="password" minlength="10" maxlength="128" required autocomplete="new-password">
       <button class="btn" type="submit">Set new password</button>
     </form>`,
  );

linksRouter.get('/links/reset-password', (req, res) => {
  const parsed = token.safeParse(req.query.token);
  if (!parsed.success) return send(res, page('Link invalid', '<h1>This reset link is invalid</h1><p>Request a new one from the app.</p>', { status: 'error' }), 400);
  send(res, resetForm(parsed.data));
});

linksRouter.post('/links/reset-password', authLimiter, form, async (req, res) => {
  const body = z.object({ token, password: z.string(), confirm: z.string() }).safeParse(req.body);
  if (!body.success) return send(res, page('Link invalid', '<h1>This reset link is invalid</h1><p>Request a new one from the app.</p>', { status: 'error' }), 400);
  const { token: t, password, confirm } = body.data;
  // eslint-disable-next-line security/detect-possible-timing-attacks -- both values are the user's own input, not a secret
  if (password !== confirm) return send(res, resetForm(t, 'The passwords don’t match.'), 400);
  const strength = passwordSchema.safeParse(password);
  if (!strength.success) return send(res, resetForm(t, strength.error.issues[0]?.message ?? 'Choose a stronger password.'), 400);
  try {
    await auth.resetPassword(t, password, auditCtx(req));
    send(res, page('Password changed', `<h1>Password changed</h1><p>Sign in to the app with your new password.</p><a class="btn" href="${appLink('/login')}">Open WalkTogether</a>`));
  } catch (err) {
    send(res, page('Link expired', `<h1>We couldn’t reset your password</h1><p>${esc(failMessage(err, 'Something went wrong.'))}</p>`, { status: 'error' }), 400);
  }
});

/** Stripe Checkout returns here. The payment's status is decided only by the verified webhook, never by this page. */
linksRouter.get('/links/payment', (req, res) => {
  const result = req.query.result === 'success' ? 'success' : 'cancelled';
  const body =
    result === 'success'
      ? `<h1>Payment submitted</h1><p>We’ll confirm it as soon as the payment provider does — usually within a minute. Return to the app to see your plan.</p>`
      : `<h1>Payment cancelled</h1><p>No money was taken. You can try again from the app.</p>`;
  send(res, page(result === 'success' ? 'Payment submitted' : 'Payment cancelled', `${body}<a class="btn" href="${appLink('/settings/subscription')}">Back to WalkTogether</a>`));
});

linksRouter.get('/links/invite/:code', async (req, res) => {
  const code = z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/).safeParse(req.params.code);
  if (!code.success) return send(res, page('Invitation invalid', '<h1>This invitation is invalid</h1>', { status: 'error' }), 404);
  try {
    const inv = await previewInvitation(code.data);
    send(
      res,
      page(
        `Join ${inv.club.name}`,
        `<h1>You’re invited to join ${esc(inv.club.name)}</h1>
         <p>Open the WalkTogether app to accept. If the button doesn’t work, open the club in the app and enter this code:</p>
         <p><code>${esc(code.data)}</code></p>
         <a class="btn" href="${appLink(`/clubs/${encodeURIComponent(inv.club.slug)}?invite=${encodeURIComponent(code.data)}`)}">Open in WalkTogether</a>`,
      ),
    );
  } catch {
    send(res, page('Invitation expired', '<h1>This invitation has expired</h1><p>Ask the club for a new one.</p>', { status: 'error' }), 404);
  }
});

linksRouter.get('/legal/privacy', (_req, res) => send(res, page('Privacy policy', privacyHtml(esc(env.SUPPORT_EMAIL)))));
linksRouter.get('/legal/terms', (_req, res) => send(res, page('Terms of service', termsHtml())));
