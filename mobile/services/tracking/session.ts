import { TrackingEngine, type ActivityKind, type EngineSnapshot } from '@walktogether/shared-utils';
import type { LocalActivity, LocalPoint, TrackingRepository } from './types';

export interface LocationFix {
  lat: number;
  lng: number;
  t: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  mocked?: boolean;
}

export interface LocationSource {
  start(kind: ActivityKind): Promise<{ background: boolean }>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
}

export interface SessionState {
  activity: LocalActivity | null;
  snapshot: EngineSnapshot | null;
  /** Last N accepted points for the live map (full route lives in storage). */
  recent: { lat: number; lng: number }[];
  backgroundCapable: boolean;
}

type Listener = (s: SessionState) => void;
const SNAPSHOT_EVERY = 10;
const RECENT_MAX = 2000;

/**
 * Orchestrates one recording: engine (filters/stats) + persistence + location source.
 * Every accepted point is written to storage before the UI updates, so a crash or OS kill
 * loses at most the in-flight batch; `restore()` recovers interrupted sessions.
 */
export class TrackingSession {
  private engine: TrackingEngine | null = null;
  private activity: LocalActivity | null = null;
  private recent: { lat: number; lng: number }[] = [];
  private listeners = new Set<Listener>();
  private sinceSnapshot = 0;
  private backgroundCapable = false;
  private restored: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private repo: TrackingRepository,
    private location: LocationSource,
    private newId: () => string,
  ) {}

  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.state);
    return () => {
      this.listeners.delete(l);
    };
  }

  get state(): SessionState {
    return { activity: this.activity, snapshot: this.engine?.snapshot ?? null, recent: this.recent, backgroundCapable: this.backgroundCapable };
  }

  private emit() {
    const s = this.state;
    this.listeners.forEach((l) => l(s));
  }

  /** Recover an interrupted session (app killed / phone restarted). */
  restore() {
    this.restored ??= (async () => {
      const a = await this.repo.findUnfinished();
      if (!a || !a.engine) return;
      const points = await this.repo.allPoints(a.localId);
      const last = points[points.length - 1];
      const stillTracking = await this.location.isRunning().catch(() => false);
      const snapshot: EngineSnapshot = { ...a.engine, status: stillTracking && a.status === 'recording' ? 'recording' : 'paused' };
      this.engine = new TrackingEngine(a.type, { snapshot, seq: a.nextSeq, lastPoint: last ? { ...last } : undefined });
      this.activity = { ...a, status: snapshot.status === 'recording' ? 'recording' : 'paused' };
      this.recent = points.slice(-RECENT_MAX).map((p) => ({ lat: p.lat, lng: p.lng }));
      this.emit();
    })();
    return this.restored;
  }

  async start(kind: ActivityKind) {
    await this.restore();
    if (this.activity) throw new Error('A recording is already in progress');
    const now = Date.now();
    this.engine = new TrackingEngine(kind);
    this.engine.start(now);
    this.recent = [];
    this.activity = {
      localId: this.newId(), serverId: null, type: kind, status: 'recording', startedAt: now, endedAt: null, title: null, visibility: null,
      clubIds: [], engine: this.engine.snapshot, nextSeq: 0, syncedSeq: -1, attempts: 0, syncError: null, mockLocation: false,
    };
    await this.repo.insertActivity(this.activity);
    const { background } = await this.location.start(kind);
    this.backgroundCapable = background;
    this.emit();
  }

  /** Called by the location task/watcher. Serialised so points are processed in order. */
  handleLocations(fixes: LocationFix[]) {
    this.queue = this.queue.then(() => this.process(fixes)).catch(() => undefined);
    return this.queue;
  }

  private async process(fixes: LocationFix[]) {
    await this.restore();
    if (!this.engine || !this.activity || this.activity.status !== 'recording') return;
    const accepted: LocalPoint[] = [];
    let mocked = this.activity.mockLocation;
    for (const f of fixes.sort((a, b) => a.t - b.t)) {
      if (f.mocked) mocked = true;
      const p = this.engine.addPoint(f);
      if (p) accepted.push({ seq: p.seq, segment: p.segment, t: p.t, lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, altitude: p.altitude ?? null, altitudeAccuracy: p.altitudeAccuracy ?? null, speed: p.speed ?? null });
    }
    if (accepted.length) {
      await this.repo.appendPoints(this.activity.localId, accepted);
      this.recent.push(...accepted.map((p) => ({ lat: p.lat, lng: p.lng })));
      if (this.recent.length > RECENT_MAX) this.recent = this.recent.slice(-RECENT_MAX);
    }
    this.sinceSnapshot += accepted.length;
    if (this.sinceSnapshot >= SNAPSHOT_EVERY || mocked !== this.activity.mockLocation) {
      this.sinceSnapshot = 0;
      this.activity = { ...this.activity, engine: this.engine.snapshot, nextSeq: this.engine.nextSeq, mockLocation: mocked };
      await this.repo.updateActivity(this.activity.localId, { engine: this.activity.engine, nextSeq: this.activity.nextSeq, mockLocation: mocked });
    } else {
      this.activity = { ...this.activity, nextSeq: this.engine.nextSeq };
      if (accepted.length) await this.repo.updateActivity(this.activity.localId, { nextSeq: this.engine.nextSeq });
    }
    this.emit();
  }

  private async persist(status: LocalActivity['status'], extra: Partial<LocalActivity> = {}) {
    if (!this.activity || !this.engine) return;
    this.activity = { ...this.activity, ...extra, status, engine: this.engine.snapshot, nextSeq: this.engine.nextSeq };
    await this.repo.updateActivity(this.activity.localId, { status, engine: this.activity.engine, nextSeq: this.activity.nextSeq, ...extra });
    this.emit();
  }

  async pause() {
    await this.queue;
    if (this.activity?.status !== 'recording') return;
    this.engine!.pause();
    await this.location.stop();
    await this.persist('paused');
  }

  async resume() {
    if (this.activity?.status !== 'paused') return;
    this.engine!.resume();
    const { background } = await this.location.start(this.activity.type);
    this.backgroundCapable = background;
    await this.persist('recording');
  }

  /** Stops recording; the activity waits on the summary screen until saved or discarded. */
  async stop() {
    await this.queue;
    if (!this.activity) return;
    if (this.activity.status === 'recording') this.engine!.pause();
    await this.location.stop();
    await this.persist('paused', { endedAt: Date.now() });
  }

  /** Marks the activity ready for upload (sync happens separately, online or later). */
  async save(meta: { title?: string | null; visibility: LocalActivity['visibility']; clubIds: string[] }) {
    if (!this.activity) return null;
    this.engine!.finish();
    await this.persist('finished', { title: meta.title ?? null, visibility: meta.visibility, clubIds: meta.clubIds, endedAt: this.activity.endedAt ?? Date.now() });
    const id = this.activity.localId;
    this.reset();
    return id;
  }

  async discard() {
    if (!this.activity) return;
    await this.location.stop().catch(() => undefined);
    await this.repo.deleteActivity(this.activity.localId);
    this.reset();
  }

  private reset() {
    this.engine = null;
    this.activity = null;
    this.recent = [];
    this.emit();
  }
}
