import Constants from 'expo-constants';

export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://10.0.2.2:4000').replace(/\/$/, ''),
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
};
