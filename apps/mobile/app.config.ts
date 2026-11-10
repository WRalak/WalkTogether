import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration. Background location requires a development/production build
 * (expo run:android or EAS); Expo Go does not support background location tasks.
 */
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
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS'],
  },
  plugins: [
    'expo-router',
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
    ['expo-camera', { cameraPermission: 'WalkTogether uses the camera only to scan event check-in QR codes.', recordAudioAndroid: false }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000',
    mapProvider: process.env.EXPO_PUBLIC_MAP_PROVIDER ?? 'google',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
