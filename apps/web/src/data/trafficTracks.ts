/**
 * Tracks of other aircraft on VATSIM, IVAO and SayIntentions. The networks only
 * share where each aircraft is now, so Glidepath remembers each position it
 * sees while the app is open and draws that as the aircraft's track.
 */
import type { NetworkPilot } from "./external";

type Pt = [lon: number, lat: number, alt: number, t: number];
const tracks = new Map<string, { pts: Pt[]; seen: number }>();
export const trackKey = (p: Pick<NetworkPilot, "network" | "callsign">) => `${p.network}:${p.callsign}`;

export function recordTraffic(pilots: NetworkPilot[], now = Date.now()): void {
  for (const p of pilots) {
    const k = trackKey(p);
    let e = tracks.get(k);
    if (!e) { e = { pts: [], seen: now }; tracks.set(k, e); }
    e.seen = now;
    const last = e.pts.at(-1);
    // A new position, or the same aircraft jumping far (a new flight with the same callsign): start again.
    if (last && Math.abs(last[0] - p.lon) + Math.abs(last[1] - p.lat) > 8) e.pts = [];
    if (!last || Math.abs(last[0] - p.lon) + Math.abs(last[1] - p.lat) > 0.004) e.pts.push([p.lon, p.lat, p.altFt, now]);
    if (e.pts.length > 600) e.pts.splice(0, e.pts.length - 600);
  }
  for (const [k, e] of tracks) if (now - e.seen > 15 * 60_000) tracks.delete(k);
}

export function trackOf(p: NetworkPilot): { pts: Pt[]; sinceMs: number | null } {
  const e = tracks.get(trackKey(p));
  return { pts: e?.pts ?? [], sinceMs: e?.pts[0] ? Date.now() - e.pts[0][3] : null };
}

const R = Math.PI / 180;
export function nm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(((b.lat - a.lat) * R) / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lon - a.lon) * R) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(h));
}

/** Great-circle points between two places, as [lon, lat], without jumping across the date line. */
export function arc(a: { lat: number; lon: number }, b: { lat: number; lon: number }, n = 48): number[][] {
  const [la1, lo1, la2, lo2] = [a.lat * R, a.lon * R, b.lat * R, b.lon * R];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!d) return [[a.lon, a.lat], [b.lon, b.lat]];
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lon = Math.atan2(y, x) / R;
    const prev = out.at(-1);
    if (prev) { while (lon - prev[0]! > 180) lon -= 360; while (prev[0]! - lon > 180) lon += 360; }
    out.push([lon, Math.atan2(z, Math.hypot(x, y)) / R]);
  }
  return out;
}
