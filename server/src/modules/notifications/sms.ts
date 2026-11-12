import { env } from '../../config/env';
import { logger } from '../../shared/logger';

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

export const devSmsOutbox: SmsMessage[] = [];

class ConsoleSmsProvider implements SmsProvider {
  async send(message: SmsMessage) {
    devSmsOutbox.push(message);
    if (devSmsOutbox.length > 200) devSmsOutbox.shift();
    logger.info({ to: message.to.slice(0, 6) + '****' }, 'sms (console provider)');
    // eslint-disable-next-line no-console -- development-only console provider; refused in staging/production
    if (env.NODE_ENV === 'development') console.log(`\n--- SMS to ${message.to}: ${message.body}\n`);
  }
}

/**
 * Africa's Talking SMS (widely used in Kenya). Requires AFRICASTALKING_USERNAME,
 * AFRICASTALKING_API_KEY and optionally a registered AFRICASTALKING_SENDER_ID.
 */
class AfricasTalkingSmsProvider implements SmsProvider {
  async send(message: SmsMessage) {
    const sandbox = env.AFRICASTALKING_USERNAME === 'sandbox';
    const url = sandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
    const body = new URLSearchParams({ username: env.AFRICASTALKING_USERNAME!, to: message.to, message: message.body });
    if (env.AFRICASTALKING_SENDER_ID) body.set('from', env.AFRICASTALKING_SENDER_ID);
    const res = await fetch(url, {
      method: 'POST',
      headers: { apiKey: env.AFRICASTALKING_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Africa's Talking SMS failed with HTTP ${res.status}`);
  }
}

export const smsProvider: SmsProvider = env.SMS_PROVIDER === 'africastalking' ? new AfricasTalkingSmsProvider() : new ConsoleSmsProvider();
