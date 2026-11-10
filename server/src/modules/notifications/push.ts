import { env } from '../../config/env';
import { logger } from '../../shared/logger';

export interface PushMessage {
  to: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export const devPushOutbox: PushMessage[] = [];

/**
 * Expo push service (delivers to FCM/APNs). Tokens look like ExponentPushToken[...].
 * EXPO_ACCESS_TOKEN is optional (required only if "enhanced push security" is enabled in Expo).
 */
async function sendExpo(msg: PushMessage) {
  for (let i = 0; i < msg.to.length; i += 100) {
    const batch = msg.to.slice(i, i + 100).map((to) => ({ to, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: 'default' }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Expo push failed with HTTP ${res.status}`);
  }
}

export async function sendPush(msg: PushMessage) {
  if (!msg.to.length) return;
  if (env.PUSH_PROVIDER === 'expo') return sendExpo(msg);
  devPushOutbox.push(msg);
  if (devPushOutbox.length > 200) devPushOutbox.shift();
  logger.info({ recipients: msg.to.length, title: msg.title }, 'push (console provider)');
}
