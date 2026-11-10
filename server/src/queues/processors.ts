import type { JobMap, JobName } from './jobs';
import { emailProvider } from '../modules/notifications/email';
import { smsProvider } from '../modules/notifications/sms';
import { purgeDueAccounts } from '../modules/users/account-deletion';
import { cleanupExpiredSessions } from '../modules/auth/session-maintenance';
import { deliverPush } from '../modules/notifications/notifications.service';
import { fanOutAnnouncement } from '../modules/announcements/announcements.service';
import { finalizeEndedChallenges, onActivityChanged } from '../modules/challenges/challenges.service';
import { computeLeaderboards } from '../modules/challenges/leaderboards.service';
import { evaluateAchievements } from '../modules/challenges/achievements.service';
import { prisma } from '../database/prisma';
import { activateCampaign, endFinishedCampaigns } from '../modules/sponsorships/sponsorships.service';
import { reconcilePendingPayments } from '../modules/payments/payments.service';
import { processMedia } from '../modules/media/media.service';
import { upsertActivityPost } from '../modules/social/posts.service';
import { cleanupStaleMedia } from '../modules/media/maintenance';
import { sendEventReminders } from '../modules/events/events.service';
import { runSubscriptionLifecycle } from '../modules/subscriptions/subscriptions.service';

export const processors: { [K in JobName]: (data: JobMap[K]) => Promise<unknown> } = {
  'email.send': (msg) => emailProvider.send(msg),
  'sms.send': (msg) => smsProvider.send(msg),
  'account.purge-due': () => purgeDueAccounts(),
  'sessions.cleanup': () => cleanupExpiredSessions(),
  'push.send': (d) => deliverPush(d),
  'announcement.fanout': (d) => fanOutAnnouncement(d.announcementId),
  'subscriptions.lifecycle': () => runSubscriptionLifecycle(),
  'activity.completed': async (d) => {
    await upsertActivityPost(d.activityId);
    const a = await prisma.activity.findUnique({ where: { id: d.activityId }, select: { userId: true, startedAt: true } });
    if (!a) return;
    await onActivityChanged(a.userId, a.startedAt);
    await evaluateAchievements(a.userId);
  },
  'activity.deleted': async (d) => {
    await onActivityChanged(d.userId);
  },
  'events.reminders': () => sendEventReminders(),
  'media.process': (d) => processMedia(d.mediaId),
  'media.cleanup': () => cleanupStaleMedia(),
  'challenges.finalize': () => finalizeEndedChallenges(),
  'leaderboards.compute': () => computeLeaderboards(),
  'achievements.evaluate': (d) => evaluateAchievements(d.userId),
  'campaigns.activate': (d) => activateCampaign(d.campaignId),
  'campaigns.end': () => endFinishedCampaigns(),
  'payments.reconcile': () => reconcilePendingPayments(),
};
