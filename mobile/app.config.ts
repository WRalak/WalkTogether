import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration. Background location requires a development/production build
 * (expo run:android or EAS); Expo Go does not support background location tasks.
 */
// Release builds (preview/production) must talk to the API over HTTPS only (OWASP MASVS-NETWORK).
// Development builds may use http:// to reach a local API.
const isDevelopmentBuild = process.env.APP_VARIANT === 'development' || !process.env.EAS_BUILD_PROFILE || process.env.EAS_BUILD_PROFILE === 'development';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';
if (!isDevelopmentBuild && !apiUrl.startsWith('https://')) {
  throw new Error(`Release builds require an https:// EXPO_PUBLIC_API_URL (got ${apiUrl})`);
}

const config: ExpoConfig = {
  name: 'WalkTogether',
  slug: 'walktogether',
  scheme: 'walktogether',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: { backgroundColor: '#127a50' },
  ios: {
    bundleIdentifier: 'app.walktogether.mobile',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'WalkTogether uses your location to record the route, distance and pace of your walks and runs.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow location access in the background so WalkTogether can keep recording your walk or run when your screen is off.',
      UIBackgroundModes: ['location'],
    },
  },
  android: {
    package: 'app.walktogether.mobile',
    adaptiveIcon: { backgroundColor: '#127a50' },
    // Google Maps SDK key (restrict to the app's package + SHA-1 in Google Cloud Console).
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } },
    edgeToEdgeEnabled: true,
    // Keep tokens, the offline activity store and cached data out of cloud/adb backups (MASVS-STORAGE).
    allowBackup: false,
    // Permissions pulled in by libraries that WalkTogether never uses.
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_CONTACTS'],
    permissions: ['android.permission.health.READ_STEPS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS'],
  },
  plugins: [
    '@react-native-community/datetimepicker',
    'expo-router',
    // Health Connect requires Android minSdk 26; HealthKit entitlement for steps (read-only).
    ['expo-build-properties', { android: { minSdkVersion: 26, usesCleartextTraffic: isDevelopmentBuild } }],
    'expo-health-connect',
    ['@kingstinct/react-native-healthkit', { NSHealthShareUsageDescription: 'WalkTogether reads your daily step count to show it alongside your activities.', NSHealthUpdateUsageDescription: false, background: false }],
    'expo-sqlite',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: 'Allow WalkTogether to keep recording your walk or run when the screen is off.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ['expo-notifications', { color: '#127a50' }],
    ['expo-image-picker', { photosPermission: 'Choose photos to share with your clubs and followers.', cameraPermission: false }],
    ['expo-camera', { cameraPermission: 'WalkTogether uses the camera only to scan event check-in QR codes.', recordAudioAndroid: false }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl,
    mapProvider: process.env.EXPO_PUBLIC_MAP_PROVIDER ?? 'google',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
