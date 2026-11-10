export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_008.8; // mean Earth radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

/** Perpendicular distance (m) from p to segment ab using a local equirectangular projection. */
function segmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const x = (q: LatLng) => rad(q.lng) * Math.cos(rad((a.lat + b.lat) / 2)) * R;
  const y = (q: LatLng) => rad(q.lat) * R;
  const [px, py, ax, ay, bx, by] = [x(p), y(p), x(a), y(a), x(b), y(b)];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker simplification for display (tolerance in metres). Iterative to avoid deep recursion. */
export function simplify<T extends LatLng>(points: T[], toleranceM = 5): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistance(points[i]!, points[s]!, points[e]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google encoded polyline (precision 5) — compact display format; raw points stay as DB rows. */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const pts: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

/**
 * Privacy trimming: removes the parts of a route within `radiusM` of its start and end
 * (and any extra private zones). Applied server-side before routes are shown to anyone but the owner.
 */
export function trimPrivacy<T extends LatLng>(points: T[], radiusM: number, zones: { center: LatLng; radiusM: number }[] = []): T[] {
  if (!points.length) return [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const allZones = radiusM > 0 ? [{ center: first, radiusM }, { center: last, radiusM }, ...zones] : zones;
  return points.filter((p) => allZones.every((z) => haversine(p, z.center) > z.radiusM));
}

/** Inserts interpolated points so no segment is longer than `stepM` (used before privacy trimming). */
export function densify(points: LatLng[], stepM = 10): LatLng[] {
  if (points.length < 2) return points.slice();
  const out: LatLng[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.floor(haversine(a, b) / stepM);
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / (n + 1), lng: a.lng + ((b.lng - a.lng) * k) / (n + 1) });
    out.push(b);
  }
  return out;
}

/** Privacy-safe display route: densify → trim zones → re-simplify. */
export function privateDisplayRoute(points: LatLng[], radiusM: number, zones: { center: LatLng; radiusM: number }[] = []): LatLng[] {
  if (radiusM <= 0 && !zones.length) return points;
  return simplify(trimPrivacy(densify(points, 10), radiusM, zones), 4);
}
