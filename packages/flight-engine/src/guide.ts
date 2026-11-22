/**
 * Approach guidance: how far the aircraft is above or below a glidepath to a
 * runway, and left or right of its extended centreline. It works for any
 * runway (RNAV, visual, or an ILS that is out of service) because it is
 * computed from the runway's own geometry, like a synthetic ILS.
 *
 * Scales follow an ILS: one vertical dot is 0.35° (full scale 0.7°), one
 * lateral dot is 1.25° measured from the far end of the runway, where a
 * localiser would sit.
 */
import type { LatLon } from "./geo.js";

export interface ApproachRunway {
  /** The runway's physical start, as the airport database gives it. */
  threshold: LatLon;
  headingTrueDeg: number;
  lengthFt: number;
  /** A displaced threshold moves the landing point down the runway. */
  displacedFt?: number;
  elevationFt: number;
}

export interface ApproachInput {
  pos: LatLon;
  altMslFt: number;
  gsKt: number | null;
  vsFpm: number | null;
  trackDeg: number | null;
  runway: ApproachRunway;
  /** Glidepath angle, degrees. Most approaches are 3.0. */
  gpaDeg?: number;
  /** Threshold crossing height, feet. */
  tchFt?: number;
}

export type ApproachState = "far" | "behind" | "intercept" | "established" | "landed";

export interface ApproachGuide {
  state: ApproachState;
  /** Distance to the landing threshold along the centreline, nm. Negative once past it. */
  distNm: number;
  /** Height above the threshold. */
  hatFt: number;
  /** Where the glidepath is at this distance. */
  targetAltFt: number;
  /** Positive = above the glidepath. */
  vertFt: number;
  /** Positive = right of the centreline. */
  latFt: number;
  /** Deviations in dots, clamped to ±2.5 for drawing. Positive = above / right. */
  vDots: number;
  hDots: number;
  /** The rate of descent that holds the glidepath at this groundspeed. */
  requiredVsFpm: number | null;
  /** A rate that brings you back to the glidepath in about 30 seconds. */
  correctVsFpm: number | null;
  /** A track that rejoins the centreline in about a mile. */
  correctTrackDeg: number;
  /** Track minus runway heading, -180…180. */
  trackErrDeg: number | null;
  /** Guidance in plain words. */
  vText: string;
  hText: string;
  /** "good", "caution" or "warning". */
  vTone: Tone;
  hTone: Tone;
  /** Stabilised approach check below 1,000 ft above the threshold. */
  unstable: string | null;
}
export type Tone = "good" | "caution" | "warning";

const FT_PER_NM = 6076.12;
const R_FT = 20_925_646; // earth radius in feet
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Position relative to a point, in feet: x = along the heading, y = to the right of it. */
function local(origin: LatLon, hdgDeg: number, p: LatLon): { along: number; right: number } {
  const north = rad(p.lat - origin.lat) * R_FT;
  const east = rad(p.lon - origin.lon) * R_FT * Math.cos(rad((p.lat + origin.lat) / 2));
  const h = rad(hdgDeg);
  return { along: north * Math.cos(h) + east * Math.sin(h), right: -north * Math.sin(h) + east * Math.cos(h) };
}

export function approachGuide(i: ApproachInput): ApproachGuide {
  const gpa = i.gpaDeg ?? 3;
  const tch = i.tchFt ?? 50;
  const rw = i.runway;
  const l = local(rw.threshold, rw.headingTrueDeg, i.pos);
  // Landing threshold is displaced down the runway; distance to it is measured back along the centreline.
  const toThrFt = (rw.displacedFt ?? 0) - l.along;
  const distNm = toThrFt / FT_PER_NM;
  const latFt = l.right;
  const hatFt = i.altMslFt - rw.elevationFt;
  const tanG = Math.tan(rad(gpa));
  const targetAltFt = rw.elevationFt + tch + tanG * Math.max(0, toThrFt);
  const vertFt = i.altMslFt - targetAltFt;
  // Angles: vertical from the glidepath's ground point, lateral from the far end of the runway.
  const gpipFt = Math.max(200, toThrFt + tch / tanG);
  const vAngle = deg(Math.atan2(hatFt, gpipFt)) - gpa;
  const locFt = Math.max(500, toThrFt + rw.lengthFt - (rw.displacedFt ?? 0));
  const hAngle = deg(Math.atan2(latFt, locFt));
  const vDots = clamp(vAngle / 0.35, -2.5, 2.5);
  const hDots = clamp(hAngle / 1.25, -2.5, 2.5);

  const gs = i.gsKt && i.gsKt > 30 ? i.gsKt : null;
  const fpmPerKt = FT_PER_NM / 60;
  const requiredVsFpm = gs ? -gs * fpmPerKt * tanG : null;
  const correctVsFpm = requiredVsFpm === null ? null : clamp(requiredVsFpm - vertFt * 2, -2500, 500);
  const intercept = clamp(deg(Math.atan2(latFt, FT_PER_NM)), -30, 30);
  const correctTrackDeg = (rw.headingTrueDeg - intercept + 360) % 360;
  const trackErrDeg = i.trackDeg === null ? null : wrap180(i.trackDeg - rw.headingTrueDeg);

  const onGround = hatFt < 15 && distNm < 0.3;
  const aligned = trackErrDeg === null ? Math.abs(hAngle) < 12 : Math.abs(trackErrDeg) < 45;
  const state: ApproachState = onGround ? "landed"
    : distNm < -0.2 ? "behind"
    : distNm > 20 || Math.abs(latFt) > 2.5 * FT_PER_NM || !aligned || vertFt > 3000 ? "far"
    : Math.abs(vDots) < 1 && Math.abs(hDots) < 1 ? "established" : "intercept";

  const vAbs = Math.abs(vertFt);
  const vTone: Tone = Math.abs(vDots) <= 0.5 ? "good" : (vDots < -1 && hatFt < 1500) || Math.abs(vDots) >= 2 ? "warning" : "caution";
  const vsHint = correctVsFpm !== null ? ` to about ${Math.round(Math.abs(correctVsFpm) / 50) * 50} fpm` : "";
  const vText = Math.abs(vDots) <= 0.25 ? "On glidepath"
    : vertFt > 0 ? `${vAbs < 100 ? "Slightly high" : "High"} ${Math.round(vAbs / 10) * 10} ft: increase descent${vsHint}`
    : `${vAbs < 100 ? "Slightly low" : "Low"} ${Math.round(vAbs / 10) * 10} ft: ${vDots < -1.5 && hatFt < 1000 ? "level off now" : `reduce descent${vsHint}`}`;
  const hAbs = Math.abs(latFt);
  const hTone: Tone = Math.abs(hDots) <= 0.5 ? "good" : Math.abs(hDots) >= 2 || (Math.abs(hDots) > 1 && hatFt < 500) ? "warning" : "caution";
  const turn = latFt > 0 ? "left" : "right";
  const hText = Math.abs(hDots) <= 0.2 ? "On centreline"
    : `${latFt > 0 ? "Right" : "Left"} of centreline ${hAbs >= 1000 ? `${(hAbs / FT_PER_NM).toFixed(1)} nm` : `${Math.round(hAbs / 10) * 10} ft`}: correct ${turn}, track ${String(Math.round(correctTrackDeg) % 360).padStart(3, "0")}°T`;

  let unstable: string | null = null;
  if (state !== "far" && state !== "landed" && state !== "behind" && hatFt < 1000 && hatFt > 50) {
    if (Math.abs(vDots) > 1) unstable = "More than a dot off the glidepath";
    else if (Math.abs(hDots) > 1) unstable = "More than a dot off the centreline";
    else if (i.vsFpm !== null && i.vsFpm < -1000 - (requiredVsFpm !== null && requiredVsFpm < -900 ? -requiredVsFpm - 900 : 0)) unstable = "Sinking faster than 1,000 fpm";
    else if (trackErrDeg !== null && Math.abs(trackErrDeg) > 15) unstable = "Not lined up with the runway";
  }

  return {
    state, distNm, hatFt, targetAltFt, vertFt, latFt, vDots, hDots, requiredVsFpm, correctVsFpm, correctTrackDeg, trackErrDeg,
    vText, hText, vTone, hTone, unstable,
  };
}

/** The runway end you look lined up for: in front of you, within 20 nm, closest to your track. */
export function likelyRunway<T extends { threshold: LatLon; headingTrueDeg: number }>(ends: T[], pos: LatLon, trackDeg: number | null): T | null {
  let best: { e: T; score: number } | null = null;
  for (const e of ends) {
    const l = local(e.threshold, e.headingTrueDeg, pos);
    const dist = -l.along / FT_PER_NM;
    if (dist < 0.2 || dist > 20) continue;
    const off = deg(Math.atan2(Math.abs(l.right), -l.along));
    const trk = trackDeg === null ? 0 : Math.abs(wrap180(trackDeg - e.headingTrueDeg));
    if (off > 25 || trk > 60) continue;
    const score = off * 2 + trk + dist * 0.3;
    if (!best || score < best.score) best = { e, score };
  }
  return best?.e ?? null;
}
