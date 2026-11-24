/**
 * Holding patterns: a standard racetrack at a fix, sized from speed (rate-one turns, 3°/s)
 * and leg time, with the entry (direct, teardrop or parallel) from the aircraft's heading.
 * Published holds come from the sim's own navdata through the Bridge (HA/HF/HM legs of the
 * airport's procedures); anywhere else the pilot sets the hold from the chart or ATC.
 */
import { model, type GeomagnetismModel } from "geomagnetism";

let wmm: GeomagnetismModel | null = null;
/** Magnetic variation (declination) here, degrees east positive, from the World Magnetic Model. */
export function declination(lat: number, lon: number): number {
  try { wmm ??= model(new Date(), { allowOutOfBoundsModel: true }); const d = wmm.point([lat, lon]).decl; return Number.isFinite(d) ? d : 0; } catch { return 0; }
}
export const magToTrue = (mag: number, lat: number, lon: number) => (((mag + declination(lat, lon)) % 360) + 360) % 360;
export const trueToMag = (tru: number, lat: number, lon: number) => (((tru - declination(lat, lon)) % 360) + 360) % 360;
export const deg3 = (d: number) => String(Math.round(d) % 360 || 360).padStart(3, "0");

export interface Hold {
  ident: string;
  lat: number;
  lon: number;
  /** Inbound course to the fix, degrees true. */
  inboundDeg: number;
  right: boolean;
  /** Leg time, minutes (1 at or below FL140, 1.5 above). */
  legMin: number;
  /** Speed used for the size, knots. */
  kt: number;
  /** Planned altitude at the fix, feet, if known. */
  altFt?: number | null;
  /** Leg length in nm (published DME/RNAV holds); when set it replaces the leg time. */
  legNm?: number | null;
  /** Where it came from: the sim's published hold, or set by you. */
  source?: "published" | "you";
  /** Published limits, when known. */
  speedKt?: number | null;
  maxAltFt?: number | null;
  minAltFt?: number | null;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Racetrack outline as [lon, lat] points (closed). */
export function holdShape(h: Hold): number[][] {
  const r = h.kt / (60 * Math.PI); // turn radius, nm, at 3°/s
  const L = h.legNm && h.legNm > 0 ? h.legNm : (h.kt * h.legMin) / 60; // straight leg, nm
  const c = rad(h.inboundDeg);
  const u = [Math.sin(c), Math.cos(c)]; // along the inbound course (east, north)
  const s = h.right ? 1 : -1;
  const v = [s * Math.cos(c), -s * Math.sin(c)]; // towards the holding side
  const pts: number[][] = [];
  const add = (x: number, y: number) => pts.push([h.lon + x / (60 * Math.cos(rad(h.lat))), h.lat + y / 60]);
  const N = 24;
  // Turn at the fix onto the outbound leg.
  for (let i = 0; i <= N; i++) { const t = (Math.PI * i) / N; add(r * v[0]! + r * (-v[0]! * Math.cos(t) + u[0]! * Math.sin(t)), r * v[1]! + r * (-v[1]! * Math.cos(t) + u[1]! * Math.sin(t))); }
  // Outbound leg, then the turn back onto the inbound course.
  const cx = -L * u[0]! + r * v[0]!, cy = -L * u[1]! + r * v[1]!;
  for (let i = 0; i <= N; i++) { const t = (Math.PI * i) / N; add(cx + r * (v[0]! * Math.cos(t) - u[0]! * Math.sin(t)), cy + r * (v[1]! * Math.cos(t) - u[1]! * Math.sin(t))); }
  pts.push(pts[0]!);
  return pts;
}

/** Entry for an aircraft heading `hdg` towards the fix (standard sectors, ±5° flexibility not applied). */
export function holdEntry(h: Hold, hdg: number): "Direct" | "Teardrop" | "Parallel" {
  let rel = (((hdg - h.inboundDeg) % 360) + 360) % 360;
  if (!h.right) rel = (360 - rel) % 360; // mirror for left-hand holds
  if (rel <= 110 || rel >= 290) return "Direct";
  return rel <= 180 ? "Teardrop" : "Parallel";
}

/** Course from a to b, degrees true. */
export function courseDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
