import type { JobMap, JobName } from './jobs';
import { emailProvider } from '../modules/notifications/email';
import { smsProvider } from '../modules/notifications/sms';
import { purgeDueAccounts } from '../modules/users/account-deletion';
import { cleanupExpiredSessions } from '../modules/auth/session-maintenance';
import { deliverPush } from '../modules/notifications/notifications.service';
import { fanOutAnnouncement } from '../modules/announcements/announcements.service';
import { runSubscriptionLifecycle } from '../modules/subscriptions/subscriptions.service';

export const processors: { [K in JobName]: (data: JobMap[K]) => Promise<unknown> } = {
  'email.send': (msg) => emailProvider.send(msg),
  'sms.send': (msg) => smsProvider.send(msg),
  'account.purge-due': () => purgeDueAccounts(),
  'sessions.cleanup': () => cleanupExpiredSessions(),
  'push.send': (d) => deliverPush(d),
  'announcement.fanout': (d) => fanOutAnnouncement(d.announcementId),
  'subscriptions.lifecycle': () => runSubscriptionLifecycle(),
};
