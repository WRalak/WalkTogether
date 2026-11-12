import * as SQLite from 'expo-sqlite';
import type { LocalActivity, TrackingRepository } from './types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db() {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('walktogether-tracking.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS local_activities (
        local_id TEXT PRIMARY KEY NOT NULL, server_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, title TEXT, visibility TEXT, club_ids TEXT NOT NULL DEFAULT '[]',
        engine TEXT, next_seq INTEGER NOT NULL DEFAULT 0, synced_seq INTEGER NOT NULL DEFAULT -1,
        attempts INTEGER NOT NULL DEFAULT 0, sync_error TEXT, mock_location INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS local_points (
        local_id TEXT NOT NULL, seq INTEGER NOT NULL, segment INTEGER NOT NULL, t INTEGER NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL, altitude REAL, altitude_accuracy REAL, speed REAL,
        PRIMARY KEY (local_id, seq)
      );
    `);
    return d;
  })();
  return dbPromise;
}

type Row = Record<string, string | number | null>;
const toActivity = (r: Row): LocalActivity => ({
  localId: r.local_id as string,
  serverId: (r.server_id as string) ?? null,
  type: r.type as LocalActivity['type'],
  status: r.status as LocalActivity['status'],
  startedAt: r.started_at as number,
  endedAt: (r.ended_at as number) ?? null,
  title: (r.title as string) ?? null,
  visibility: (r.visibility as LocalActivity['visibility']) ?? null,
  clubIds: JSON.parse((r.club_ids as string) || '[]'),
  engine: r.engine ? JSON.parse(r.engine as string) : null,
  nextSeq: r.next_seq as number,
  syncedSeq: r.synced_seq as number,
  attempts: r.attempts as number,
  syncError: (r.sync_error as string) ?? null,
  mockLocation: !!r.mock_location,
});
const COLS: Record<keyof LocalActivity, string> = {
  localId: 'local_id',
  serverId: 'server_id',
  type: 'type',
  status: 'status',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  title: 'title',
  visibility: 'visibility',
  clubIds: 'club_ids',
  engine: 'engine',
  nextSeq: 'next_seq',
  syncedSeq: 'synced_seq',
  attempts: 'attempts',
  syncError: 'sync_error',
  mockLocation: 'mock_location',
};
const encode = (k: keyof LocalActivity, v: unknown) => (k === 'clubIds' || k === 'engine' ? JSON.stringify(v) : k === 'mockLocation' ? (v ? 1 : 0) : (v as SQLite.SQLiteBindValue));

export const sqliteRepository: TrackingRepository = {
  async insertActivity(a) {
    const d = await db();
    const keys = Object.keys(COLS) as (keyof LocalActivity)[];
    await d.runAsync(
      `INSERT INTO local_activities (${keys.map((k) => COLS[k]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((k) => encode(k, a[k])) as SQLite.SQLiteBindValue[],
    );
  },
  async updateActivity(localId, patch) {
    const keys = Object.keys(patch) as (keyof LocalActivity)[];
    if (!keys.length) return;
    const d = await db();
    await d.runAsync(`UPDATE local_activities SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE local_id = ?`, [
      ...keys.map((k) => encode(k, patch[k])),
      localId,
    ] as SQLite.SQLiteBindValue[]);
  },
  async getActivity(localId) {
    const r = await (await db()).getFirstAsync<Row>('SELECT * FROM local_activities WHERE local_id = ?', [localId]);
    return r ? toActivity(r) : null;
  },
  async findUnfinished() {
    const r = await (await db()).getFirstAsync<Row>("SELECT * FROM local_activities WHERE status IN ('recording','paused') ORDER BY started_at DESC LIMIT 1");
    return r ? toActivity(r) : null;
  },
  async listPendingSync() {
    const rows = await (await db()).getAllAsync<Row>("SELECT * FROM local_activities WHERE status = 'finished' ORDER BY started_at ASC");
    return rows.map(toActivity);
  },
  async listLocal() {
    const rows = await (await db()).getAllAsync<Row>("SELECT * FROM local_activities WHERE status != 'synced' AND status != 'discarded' ORDER BY started_at DESC");
    return rows.map(toActivity);
  },
  async appendPoints(localId, points) {
    if (!points.length) return;
    const d = await db();
    await d.withTransactionAsync(async () => {
      for (const p of points) {
        await d.runAsync('INSERT OR IGNORE INTO local_points (local_id, seq, segment, t, lat, lng, accuracy, altitude, altitude_accuracy, speed) VALUES (?,?,?,?,?,?,?,?,?,?)', [
          localId,
          p.seq,
          p.segment,
          p.t,
          p.lat,
          p.lng,
          p.accuracy,
          p.altitude,
          p.altitudeAccuracy,
          p.speed,
        ]);
      }
    });
  },
  async pointsAfter(localId, afterSeq, limit) {
    const rows = await (await db()).getAllAsync<Row>('SELECT * FROM local_points WHERE local_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [localId, afterSeq, limit]);
    return rows.map((r) => ({
      seq: r.seq as number,
      segment: r.segment as number,
      t: r.t as number,
      lat: r.lat as number,
      lng: r.lng as number,
      accuracy: r.accuracy as number | null,
      altitude: r.altitude as number | null,
      altitudeAccuracy: r.altitude_accuracy as number | null,
      speed: r.speed as number | null,
    }));
  },
  async allPoints(localId) {
    return this.pointsAfter(localId, -1, 100_000);
  },
  async deleteActivity(localId) {
    const d = await db();
    await d.withTransactionAsync(async () => {
      await d.runAsync('DELETE FROM local_points WHERE local_id = ?', [localId]);
      await d.runAsync('DELETE FROM local_activities WHERE local_id = ?', [localId]);
    });
  },
};
