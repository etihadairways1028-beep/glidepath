/**
 * Navigation maths on a spherical Earth (mean radius). Accurate to well under
 * 0.5% for flight-tracking distances, which is all a companion app needs.
 * All distances in nautical miles, angles in degrees.
 */
export const EARTH_RADIUS_NM = 3440.065;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export const normalise360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Smallest signed difference a - b in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normalise360(a) - normalise360(b);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Great-circle distance (haversine). */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial true bearing from a to b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const Δλ = (b.lon - a.lon) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalise360(Math.atan2(y, x) * R2D);
}

/** Point reached from `start` travelling `distNm` on initial bearing `brgDeg`. */
export function destinationPoint(start: LatLon, brgDeg: number, distNm: number): LatLon {
  const δ = distNm / EARTH_RADIUS_NM;
  const θ = brgDeg * D2R;
  const φ1 = start.lat * D2R;
  const λ1 = start.lon * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * R2D, lon: ((λ2 * R2D + 540) % 360) - 180 };
}

/** Signed cross-track distance of p from the great circle a→b (positive = right of track). */
export function crossTrackNm(a: LatLon, b: LatLon, p: LatLon): number {
  const δ13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const θ13 = bearingDeg(a, p) * D2R;
  const θ12 = bearingDeg(a, b) * D2R;
  return Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * EARTH_RADIUS_NM;
}

/** Distance along the great circle a→b to the point abeam p. */
export function alongTrackNm(a: LatLon, b: LatLon, p: LatLon): number {
  const δ13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const δxt = crossTrackNm(a, b, p) / EARTH_RADIUS_NM;
  const cos = Math.cos(δ13) / Math.cos(δxt);
  const along = Math.acos(Math.max(-1, Math.min(1, cos))) * EARTH_RADIUS_NM;
  // Negative if p is behind a.
  const behind = Math.abs(angleDiff(bearingDeg(a, p), bearingDeg(a, b))) > 90;
  return behind ? -along : along;
}

/** Total length of a polyline route. */
export function routeLengthNm(route: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += distanceNm(route[i - 1]!, route[i]!);
  return total;
}

export interface RouteProgress {
  /** Index of the leg (from waypoint i to i+1) the aircraft is on. */
  legIndex: number;
  distanceFlownNm: number;
  distanceRemainingNm: number;
  crossTrackNm: number;
}

/**
 * Where the aircraft is along a planned route. Picks the leg with the smallest
 * cross-track error whose along-track position falls within the leg, which
 * handles doglegs better than "nearest waypoint".
 */
export function routeProgress(route: LatLon[], p: LatLon): RouteProgress | null {
  if (route.length < 2) return null;
  const legLens: number[] = [];
  for (let i = 1; i < route.length; i++) legLens.push(distanceNm(route[i - 1]!, route[i]!));
  const total = legLens.reduce((s, v) => s + v, 0);

  let best: { i: number; along: number; xt: number; cost: number } | null = null;
  let cumulative = 0;
  for (let i = 0; i < legLens.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    const len = legLens[i]!;
    const along = alongTrackNm(a, b, p);
    const xt = crossTrackNm(a, b, p);
    const clamped = Math.max(0, Math.min(len, along));
    // Cost = distance to the closest point on this leg segment.
    const outside = along < 0 ? -along : along > len ? along - len : 0;
    const cost = Math.hypot(xt, outside);
    if (!best || cost < best.cost) best = { i, along: cumulative + clamped, xt, cost };
    cumulative += len;
  }
  if (!best) return null;
  return {
    legIndex: best.i,
    distanceFlownNm: best.along,
    distanceRemainingNm: Math.max(0, total - best.along),
    crossTrackNm: best.xt,
  };
}

/** Head/cross wind components for a given heading. Positive headwind = on the nose; positive crosswind = from the right. */
export function windComponents(windFromDeg: number, windKt: number, headingDeg: number): { headwindKt: number; crosswindKt: number } {
  const rel = angleDiff(windFromDeg, headingDeg) * D2R;
  return { headwindKt: windKt * Math.cos(rel), crosswindKt: windKt * Math.sin(rel) };
}
