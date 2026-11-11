import type { ActivityKind, EngineSnapshot } from '@walktogether/shared-utils';

export type LocalStatus = 'recording' | 'paused' | 'finished' | 'synced' | 'discarded';

export interface LocalActivity {
  localId: string;
  serverId: string | null;
  type: ActivityKind;
  status: LocalStatus;
  startedAt: number;
  endedAt: number | null;
  title: string | null;
  visibility: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE' | null;
  clubIds: string[];
  engine: EngineSnapshot | null;
  nextSeq: number;
  syncedSeq: number;
  attempts: number;
  syncError: string | null;
  mockLocation: boolean;
}

export interface LocalPoint {
  seq: number;
  segment: number;
  t: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
}

/** Storage abstraction: SQLite on device, in-memory in tests. Every point is persisted immediately. */
export interface TrackingRepository {
  insertActivity(a: LocalActivity): Promise<void>;
  updateActivity(localId: string, patch: Partial<LocalActivity>): Promise<void>;
  getActivity(localId: string): Promise<LocalActivity | null>;
  findUnfinished(): Promise<LocalActivity | null>;
  listPendingSync(): Promise<LocalActivity[]>;
  listLocal(): Promise<LocalActivity[]>;
  appendPoints(localId: string, points: LocalPoint[]): Promise<void>;
  pointsAfter(localId: string, afterSeq: number, limit: number): Promise<LocalPoint[]>;
  allPoints(localId: string): Promise<LocalPoint[]>;
  deleteActivity(localId: string): Promise<void>;
}
