/**
 * Direct-to detection. When you fly "DIR TO" a later waypoint from the MCDU,
 * the aircraft stops following the current leg and holds a track straight at
 * that waypoint. This spots it so the waypoints you skipped can be dropped.
 */
import { bearingDeg, crossTrackNm, distanceNm, type LatLon } from "./geo.js";

const diff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

export interface DirectCheck {
  /** Route as flown: origin, every fix, destination. */
  route: LatLon[];
  /** Index into route of the point you're flying to now (1 = first fix). */
  nextIdx: number;
  pos: LatLon;
  trackDeg: number;
  bankDeg?: number | null;
}

/**
 * The route index you look to be flying direct to, or null. Only points after
 * the current one count, and only when you've clearly left the current leg.
 */
export function directCandidate(c: DirectCheck): number | null {
  const { route, nextIdx, pos, trackDeg } = c;
  if (nextIdx < 1 || nextIdx >= route.length - 1) return null;
  if (c.bankDeg != null && Math.abs(c.bankDeg) > 6) return null; // still turning
  const from = route[nextIdx - 1]!, next = route[nextIdx]!;
  const toNext = bearingDeg(pos, next);
  if (diff(trackDeg, toNext) < 8) return null; // still heading for the next point
  const legCourse = bearingDeg(from, next);
  const xt = Math.abs(crossTrackNm(from, next, pos));
  if (diff(trackDeg, legCourse) < 6 && xt < 0.6) return null; // still on the leg
  let best: { j: number; err: number } | null = null;
  for (let j = nextIdx + 1; j < Math.min(route.length, nextIdx + 25); j++) {
    const p = route[j]!;
    if (distanceNm(pos, p) < 2) continue;
    const err = diff(trackDeg, bearingDeg(pos, p));
    if (err < 3.5 && (!best || err < best.err)) best = { j, err };
  }
  return best?.j ?? null;
}

/** Remembers a candidate until it has held for a while, so a turn passing through a bearing doesn't count. */
export class DirectTracker {
  private cand: { j: number; since: number; n: number } | null = null;
  constructor(private holdMs = 12_000, private minChecks = 3) {}
  /** Returns the confirmed route index, once. */
  update(j: number | null, t: number): number | null {
    if (j === null) { this.cand = null; return null; }
    if (!this.cand || this.cand.j !== j) { this.cand = { j, since: t, n: 1 }; return null; }
    this.cand.n++;
    if (t - this.cand.since >= this.holdMs && this.cand.n >= this.minChecks) { this.cand = null; return j; }
    return null;
  }
  reset() { this.cand = null; }
}
