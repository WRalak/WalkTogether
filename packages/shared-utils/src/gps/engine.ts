import { checkPoint, type ActivityKind, type RawPoint } from './filter';
import { haversine } from './geo';
import { rollingPace, SPEED_REANCHOR_STREAK } from './stats';

export type EngineStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface EngineSnapshot {
  status: EngineStatus;
  kind: ActivityKind;
  startedAt: number | null;
  distanceM: number;
  movingMs: number;
  elapsedMs: number;
  currentPaceSecPerKm: number | null;
  lastPoint: RawPoint | null;
  /** current segment index; pauses start a new segment */
  segment: number;
  acceptedCount: number;
  rejectedCount: number;
}

export interface AcceptedPoint extends RawPoint {
  segment: number;
  seq: number;
}

/**
 * Live tracking state machine (pure, deterministic, unit-tested). The mobile app feeds it
 * location updates and persists every accepted point; the server recomputes authoritative stats.
 */
export class TrackingEngine {
  private s: EngineSnapshot;
  private window: RawPoint[] = [];
  private activeSince: number | null = null;
  private accumulatedMs = 0;
  private seq = 0;
  private prev: RawPoint | undefined;
  private speedStreak = 0;

  constructor(kind: ActivityKind, restore?: { snapshot: EngineSnapshot; seq: number; lastPoint?: RawPoint }) {
    this.s = restore?.snapshot ?? {
      status: 'idle',
      kind,
      startedAt: null,
      distanceM: 0,
      movingMs: 0,
      elapsedMs: 0,
      currentPaceSecPerKm: null,
      lastPoint: null,
      segment: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    };
    if (restore) {
      this.seq = restore.seq;
      this.prev = restore.lastPoint;
      this.accumulatedMs = restore.snapshot.elapsedMs;
      if (this.s.status === 'recording') this.activeSince = Date.now();
    }
  }

  get snapshot(): EngineSnapshot {
    const elapsedMs = this.accumulatedMs + (this.activeSince ? Date.now() - this.activeSince : 0);
    return { ...this.s, elapsedMs };
  }

  start(now = Date.now()) {
    if (this.s.status !== 'idle') throw new Error(`cannot start from ${this.s.status}`);
    this.s = { ...this.s, status: 'recording', startedAt: now };
    this.activeSince = now;
  }

  pause(now = Date.now()) {
    if (this.s.status !== 'recording') return;
    this.accumulatedMs += now - (this.activeSince ?? now);
    this.activeSince = null;
    this.window = [];
    this.s = { ...this.s, status: 'paused', currentPaceSecPerKm: null, elapsedMs: this.accumulatedMs };
  }

  resume(now = Date.now()) {
    if (this.s.status !== 'paused') return;
    this.activeSince = now;
    // New segment: the gap while paused never counts as distance.
    this.prev = undefined;
    this.s = { ...this.s, status: 'recording', segment: this.s.segment + 1 };
  }

  finish(now = Date.now()) {
    if (this.s.status === 'recording') this.pause(now);
    this.s = { ...this.s, status: 'finished' };
  }

  /** Returns the accepted point (to persist) or null if rejected/ignored. */
  addPoint(p: RawPoint, now = Date.now()): AcceptedPoint | null {
    if (this.s.status !== 'recording') return null;
    const reason = checkPoint(p, this.prev, this.s.kind, now);
    if (reason) {
      this.speedStreak = reason === 'speed' ? this.speedStreak + 1 : this.speedStreak;
      this.s = { ...this.s, rejectedCount: this.s.rejectedCount + 1 };
      if (this.speedStreak < SPEED_REANCHOR_STREAK) return null;
      // Sustained jump: re-anchor in a new segment (matches server-side filterSegments).
      this.speedStreak = 0;
      this.prev = undefined;
      this.s = { ...this.s, segment: this.s.segment + 1 };
      return this.addPoint(p, now);
    }
    this.speedStreak = 0;
    if (this.prev) {
      const d = haversine(this.prev, p);
      const jitter = Math.max(3, Math.min(this.prev.accuracy ?? 5, p.accuracy ?? 5));
      if (d >= jitter) {
        this.s = { ...this.s, distanceM: this.s.distanceM + d, movingMs: this.s.movingMs + (p.t - this.prev.t) };
        this.prev = p;
      }
      // else: drift while (nearly) stationary — keep the anchor, count nothing
    } else {
      this.prev = p;
    }
    this.window.push(p);
    while (this.window.length > 2 && (p.t - this.window[0]!.t) / 1000 > 60) this.window.shift();
    const accepted: AcceptedPoint = { ...p, segment: this.s.segment, seq: this.seq++ };
    this.s = { ...this.s, lastPoint: p, acceptedCount: this.s.acceptedCount + 1, currentPaceSecPerKm: rollingPace(this.window) };
    return accepted;
  }

  get nextSeq() {
    return this.seq;
  }
}
