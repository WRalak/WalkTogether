import type { EmailMessage } from '../modules/notifications/email';
import type { SmsMessage } from '../modules/notifications/sms';

/** Typed catalogue of background jobs. Add new jobs here and register a processor in processors.ts. */
export interface JobMap {
  'email.send': EmailMessage;
  'sms.send': SmsMessage;
  'account.purge-due': Record<string, never>;
  'sessions.cleanup': Record<string, never>;
  'push.send': { userIds: string[]; title: string; body: string; data?: Record<string, unknown> };
  'announcement.fanout': { announcementId: string };
  'subscriptions.lifecycle': Record<string, never>;
  'activity.completed': { activityId: string };
  'activity.deleted': { userId: string; activityId: string; type: string };
  'events.reminders': Record<string, never>;
  'media.process': { mediaId: string };
  'media.cleanup': Record<string, never>;
  'challenges.finalize': Record<string, never>;
  'leaderboards.compute': Record<string, never>;
  'achievements.evaluate': { userId: string };
  'campaigns.activate': { campaignId: string };
  'campaigns.end': Record<string, never>;
  'payments.reconcile': Record<string, never>;
  'partitions.maintain': Record<string, never>;
}

export type JobName = keyof JobMap;

/** Queue each job runs on, so slow maintenance work cannot starve user-facing notifications. */
export const JOB_QUEUES: Record<JobName, 'notifications' | 'maintenance' | 'activity'> = {
  'email.send': 'notifications',
  'sms.send': 'notifications',
  'account.purge-due': 'maintenance',
  'sessions.cleanup': 'maintenance',
  'push.send': 'notifications',
  'announcement.fanout': 'notifications',
  'subscriptions.lifecycle': 'maintenance',
  'activity.completed': 'activity',
  'activity.deleted': 'activity',
  'events.reminders': 'maintenance',
  'media.process': 'activity',
  'media.cleanup': 'maintenance',
  'challenges.finalize': 'maintenance',
  'leaderboards.compute': 'maintenance',
  'achievements.evaluate': 'activity',
  'campaigns.activate': 'maintenance',
  'campaigns.end': 'maintenance',
  'payments.reconcile': 'maintenance',
  'partitions.maintain': 'maintenance',
};
