import type { JobMap, JobName } from './jobs';
import { emailProvider } from '../modules/notifications/email';
import { smsProvider } from '../modules/notifications/sms';
import { purgeDueAccounts } from '../modules/users/account-deletion';
import { cleanupExpiredSessions } from '../modules/auth/session-maintenance';

export const processors: { [K in JobName]: (data: JobMap[K]) => Promise<unknown> } = {
  'email.send': (msg) => emailProvider.send(msg),
  'sms.send': (msg) => smsProvider.send(msg),
  'account.purge-due': () => purgeDueAccounts(),
  'sessions.cleanup': () => cleanupExpiredSessions(),
};
