import { describe, expect, it } from 'vitest';
import { checkPoint, computeStats, decodePolyline, encodePolyline, haversine, simplify, TrackingEngine, trimPrivacy, type RawPoint } from '../gps';

/** Straight walk north from Uhuru Park at a given speed, one point every `stepS` seconds. */
function track(n: number, speedMps: number, stepS = 3, start = { lat: -1.2921, lng: 36.8219 }, t0 = 1_700_000_000_000): RawPoint[] {
  const dLat = (speedMps * stepS) / 111_195;
  return Array.from({ length: n }, (_, i) => ({ lat: start.lat + dLat * i, lng: start.lng, t: t0 + i * stepS * 1000, accuracy: 5 }));
}

describe('geo', () => {
  it('haversine matches a known distance (Nairobi CBD → JKIA ≈ 15.4 km)', () => {
    const d = haversine({ lat: -1.2864, lng: 36.8172 }, { lat: -1.3192, lng: 36.9278 });
    expect(d).toBeGreaterThan(12_500);
    expect(d).toBeLessThan(13_000);
  });

  it('polyline round-trips and simplification keeps endpoints', () => {
    const pts = track(200, 1.4).map(({ lat, lng }) => ({ lat, lng }));
    expect(decodePolyline(encodePolyline(pts))[199]!.lat).toBeCloseTo(pts[199]!.lat, 4);
    const simple = simplify(pts, 3);
    expect(simple.length).toBeLessThan(5);
    expect(simple[0]).toEqual(pts[0]);
    expect(simple.at(-1)).toEqual(pts.at(-1));
  });

  it('privacy trimming hides points near start and end', () => {
    const pts = track(300, 1.4); // ~1.25 km
    const trimmed = trimPrivacy(pts, 200);
    expect(haversine(trimmed[0]!, pts[0]!)).toBeGreaterThan(200);
    expect(haversine(trimmed.at(-1)!, pts.at(-1)!)).toBeGreaterThan(200);
  });
});

describe('filtering', () => {
  const prev: RawPoint = { lat: -1.29, lng: 36.82, t: 1_000_000, accuracy: 5 };
  it('rejects invalid, inaccurate, duplicate, out-of-order and impossible points', () => {
    expect(checkPoint({ lat: 0, lng: 0, t: 1 }, undefined, 'WALK')).toBe('invalid');
    expect(checkPoint({ lat: 91, lng: 0, t: 1 }, undefined, 'WALK')).toBe('invalid');
    expect(checkPoint({ ...prev, accuracy: 80 }, undefined, 'WALK')).toBe('inaccurate');
    expect(checkPoint({ ...prev }, prev, 'WALK')).toBe('duplicate');
    expect(checkPoint({ ...prev, t: prev.t - 1000 }, prev, 'WALK')).toBe('time');
    expect(checkPoint({ ...prev, t: Date.now() + 10 * 60_000 }, undefined, 'WALK', Date.now())).toBe('time');
    // 500 m in 5 s = 100 m/s
    expect(checkPoint({ ...prev, lat: prev.lat + 0.0045, t: prev.t + 5000 }, prev, 'WALK')).toBe('speed');
    expect(checkPoint({ ...prev, lat: prev.lat + 0.00004, t: prev.t + 3000 }, prev, 'WALK')).toBeNull();
  });
});

describe('statistics', () => {
  it('computes distance, pace and calories for a steady walk', () => {
    const pts = track(401, 1.4); // 20 minutes at 1.4 m/s = 1680 m
    const s = computeStats([{ points: pts }], 'WALK', { now: pts.at(-1)!.t });
    expect(s.distanceM).toBeGreaterThan(1650);
    expect(s.distanceM).toBeLessThan(1710);
    expect(s.movingSeconds).toBe(1200);
    expect(s.avgPaceSecPerKm).toBeGreaterThan(700);
    expect(s.avgPaceSecPerKm).toBeLessThan(730);
    expect(s.caloriesEstimate).toBeGreaterThan(0);
    expect(s.elevationGainM).toBeNull(); // no reliable altitude
  });

  it('ignores GPS drift while stationary and teleport spikes', () => {
    const base = { lat: -1.2921, lng: 36.8219 };
    const jitter: RawPoint[] = Array.from({ length: 100 }, (_, i) => ({
      lat: base.lat + (i % 2 ? 0.00002 : -0.00002),
      lng: base.lng,
      t: 1_700_000_000_000 + i * 3000,
      accuracy: 8,
    }));
    expect(computeStats([{ points: jitter }], 'WALK', { now: Infinity as never }).distanceM).toBeLessThan(10);
    const pts = track(100, 1.4);
    pts.splice(50, 0, { lat: -1.0, lng: 36.5, t: pts[49]!.t + 1000, accuracy: 5 });
    const s = computeStats([{ points: pts }], 'WALK', { now: Number.MAX_SAFE_INTEGER });
    expect(s.rejected.speed).toBe(1);
    expect(s.distanceM).toBeLessThan(450);
  });

  it('excludes paused gaps between segments', () => {
    const a = track(101, 1.4);
    const b = track(101, 1.4, 3, { lat: -1.2, lng: 36.9 }, a.at(-1)!.t + 600_000); // resumed 10 min later, far away
    const s = computeStats([{ points: a }, { points: b }], 'WALK', { now: Number.MAX_SAFE_INTEGER });
    expect(s.movingSeconds).toBe(600);
    expect(s.distanceM).toBeLessThan(900);
  });
});

describe('TrackingEngine', () => {
  it('follows the start → pause → resume → finish lifecycle', () => {
    const e = new TrackingEngine('RUN');
    const pts = track(50, 3);
    e.start(pts[0]!.t);
    for (const p of pts.slice(0, 25)) e.addPoint(p, p.t);
    e.pause(pts[24]!.t);
    expect(e.addPoint(pts[25]!, pts[25]!.t)).toBeNull();
    e.resume(pts[30]!.t);
    for (const p of pts.slice(30)) e.addPoint(p, p.t);
    e.finish(pts[49]!.t);
    const s = e.snapshot;
    expect(s.status).toBe('finished');
    expect(s.segment).toBe(1);
    expect(s.distanceM).toBeGreaterThan(24 * 9 + 19 * 9 - 5);
    expect(s.distanceM).toBeLessThan(400);
    expect(() => e.start()).toThrow();
  });
});
