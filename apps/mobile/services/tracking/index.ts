import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { api } from '@/services/api';
import { createExpoLocationSource, setLocationSink } from './location-source';
import { TrackingSession } from './session';
import { sqliteRepository } from './sqlite-repository';
import { syncPending, type SyncResult } from './sync';

export const trackingSession = new TrackingSession(sqliteRepository, createExpoLocationSource(), () => Crypto.randomUUID());
setLocationSink((fixes) => trackingSession.handleLocations(fixes));

let syncing: Promise<SyncResult> | null = null;
const syncListeners = new Set<(r: SyncResult) => void>();

/** Single-flight sync of finished activities; triggered on save, reconnect and app foreground. */
export function syncNow() {
  syncing ??= syncPending(sqliteRepository, api)
    .then((r) => {
      syncListeners.forEach((l) => l(r));
      return r;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

export function onSynced(l: (r: SyncResult) => void) {
  syncListeners.add(l);
  return () => {
    syncListeners.delete(l);
  };
}

let started = false;
export function startTrackingServices() {
  if (started) return;
  started = true;
  void trackingSession.restore();
  NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void syncNow().catch(() => undefined);
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void syncNow().catch(() => undefined);
  });
}

export { sqliteRepository };
