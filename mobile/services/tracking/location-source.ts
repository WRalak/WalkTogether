import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { ActivityKind } from '@walktogether/shared-utils';
import type { LocationFix, LocationSource } from './session';

export const LOCATION_TASK = 'walktogether-location-tracking';

const toFix = (l: Location.LocationObject): LocationFix => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  t: l.timestamp,
  accuracy: l.coords.accuracy ?? null,
  altitude: l.coords.altitude ?? null,
  altitudeAccuracy: l.coords.altitudeAccuracy ?? null,
  speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
  mocked: (l as Location.LocationObject & { mocked?: boolean }).mocked,
});

let sink: ((fixes: LocationFix[]) => unknown) | null = null;
export function setLocationSink(fn: (fixes: LocationFix[]) => unknown) {
  sink = fn;
}

/**
 * Background task: must be defined at module scope so the OS can wake the JS runtime and deliver
 * locations while the screen is off (requires a development/production build, not Expo Go).
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await sink?.(data.locations.map(toFix));
});

const options = (kind: ActivityKind): Location.LocationTaskOptions => ({
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: kind === 'RUN' ? 2000 : 3000,
  distanceInterval: kind === 'RUN' ? 8 : 5,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'WalkTogether is recording',
    notificationBody: 'Your route, distance and pace are being recorded.',
    notificationColor: '#127a50',
    killServiceOnDestroy: false,
  },
});

/**
 * Prefers the background task (screen-off recording). If background permission is refused or the
 * runtime cannot run background tasks (e.g. Expo Go), falls back to a foreground watcher so
 * recording still works while the app is open.
 */
export function createExpoLocationSource(): LocationSource {
  let watcher: Location.LocationSubscription | null = null;
  return {
    async start(kind) {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (!fg.granted) throw new Error('LOCATION_PERMISSION_DENIED');
      let bgGranted = false;
      try {
        bgGranted = (await Location.requestBackgroundPermissionsAsync()).granted;
      } catch {
        bgGranted = false;
      }
      if (bgGranted && (await TaskManager.isAvailableAsync())) {
        try {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, options(kind));
          return { background: true };
        } catch {
          // fall through to foreground
        }
      }
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: kind === 'RUN' ? 2000 : 3000, distanceInterval: kind === 'RUN' ? 8 : 5 },
        (l) => void sink?.([toFix(l)]),
      );
      return { background: false };
    },
    async stop() {
      watcher?.remove();
      watcher = null;
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    },
    async isRunning() {
      return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    },
  };
}
