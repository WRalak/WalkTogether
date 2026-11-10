import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { getDeviceId } from './secure-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/**
 * Registers this device for push notifications (Expo push service → FCM/APNs).
 * Requires a physical device and an EAS project id; otherwise in-app notifications still work.
 */
export async function registerForPush() {
  if (!Device.isDevice) return { registered: false, reason: 'simulator' as const };
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) return { registered: false, reason: 'no_project_id' as const };
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'WalkTogether', importance: Notifications.AndroidImportance.DEFAULT });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { registered: false, reason: 'denied' as const };
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.users.registerDevice({ pushToken: token, platform: Platform.OS === 'ios' ? 'ios' : 'android', deviceId: await getDeviceId() });
  return { registered: true as const };
}
