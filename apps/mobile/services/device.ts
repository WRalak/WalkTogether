import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { config } from './config';
import { getDeviceId } from './secure-storage';

export async function deviceInfo() {
  return {
    deviceId: await getDeviceId(),
    deviceName: (Device.modelName ?? Device.deviceName ?? 'Mobile device').slice(0, 100),
    platform: (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android',
    appVersion: config.appVersion,
  };
}
