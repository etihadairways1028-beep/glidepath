/**
 * Tracks of other aircraft on VATSIM, IVAO and SayIntentions, kept by the Bridge while it runs,
 * so the app can draw an aircraft's whole track even if the app was closed for most of it.
 * The networks share only where each aircraft is now; this remembers those positions.
 *
 * Light by design: a point is kept only when the aircraft has moved about a mile or changed
 * altitude, each track keeps at most MAX_POINTS (thinned evenly when full), and aircraft that
 * have been gone for 20 minutes are forgotten.
 */
import type { NetworkPilot } from "./external.js";

export type TrackPoint = [lon: number, lat: number, altFt: number, t: number];
const MAX_POINTS = 400;
const GONE_MS = 20 * 60_000;

export class TrafficTracks {
  private tracks = new Map<string, { pts: TrackPoint[]; seen: number }>();
  /** Networks an app has asked for, and when: the Bridge keeps recording these in the background. */
  readonly wanted = new Map<string, number>();

  static key(network: string, callsign: string): string { return `${network}:${callsign.toUpperCase()}`; }

  record(network: string, pilots: NetworkPilot[], now = Date.now()): void {
    for (const p of pilots) {
      const k = TrafficTracks.key(network, p.callsign);
      let e = this.tracks.get(k);
      if (!e) { e = { pts: [], seen: now }; this.tracks.set(k, e); }
      e.seen = now;
      const last = e.pts.at(-1);
      const moved = last ? Math.abs(last[0] - p.lon) + Math.abs(last[1] - p.lat) : Infinity;
      // The same callsign far away is a new flight: start its track again.
      if (last && moved > 8) e.pts = [];
      if (!last || moved > 8 || moved > 0.015 || Math.abs(last[2] - p.altFt) > 400) {
        e.pts.push([Math.round(p.lon * 1e4) / 1e4, Math.round(p.lat * 1e4) / 1e4, Math.round(p.altFt), now]);
        if (e.pts.length > MAX_POINTS) e.pts = e.pts.filter((_, i) => i % 2 === 0 || i === e!.pts.length - 1);
      }
    }
    for (const [k, e] of this.tracks) if (now - e.seen > GONE_MS) this.tracks.delete(k);
  }

  track(network: string, callsign: string): TrackPoint[] {
    return this.tracks.get(TrafficTracks.key(network, callsign))?.pts ?? [];
  }

  get size(): number { return this.tracks.size; }
}
