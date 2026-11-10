import type { EmailMessage } from '../modules/notifications/email';
import type { SmsMessage } from '../modules/notifications/sms';

/** Typed catalogue of background jobs. Add new jobs here and register a processor in processors.ts. */
export interface JobMap {
  'email.send': EmailMessage;
  'sms.send': SmsMessage;
  'account.purge-due': Record<string, never>;
  'sessions.cleanup': Record<string, never>;
}

export type JobName = keyof JobMap;

/** Queue each job runs on, so slow maintenance work cannot starve user-facing notifications. */
export const JOB_QUEUES: Record<JobName, 'notifications' | 'maintenance'> = {
  'email.send': 'notifications',
  'sms.send': 'notifications',
  'account.purge-due': 'maintenance',
  'sessions.cleanup': 'maintenance',
};
