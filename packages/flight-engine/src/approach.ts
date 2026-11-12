/**
 * Approach coach: how the last 10 nm of a flight compared with a stable,
 * 3-degree approach, from the recorded frames, plus the same "stable at
 * 1000 ft / 500 ft" check used live during the approach.
 */
import type { LandingReport, TelemetryFrame } from "@glidepath/protocol";

export interface ApproachPoint { distNm: number; aglFt: number; iasKt: number | null; vsFpm: number | null; bankDeg: number | null; gearDown: boolean | null; flapsPct: number | null; t: number }
export interface Gate { heightFt: 1000 | 500; stable: boolean; reasons: string[]; iasKt: number | null; vsFpm: number | null; pathDevFt: number | null }
export interface ApproachReview { points: ApproachPoint[]; gates: Gate[]; notes: Array<{ good: boolean; text: string }>; refSpeedKt: number | null; maxDevFt: number | null }

const FT_PER_NM_3DEG = 318.4;
const R = Math.PI / 180;
function nm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(((b.lat - a.lat) * R) / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(((b.lon - a.lon) * R) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(h));
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Is the aircraft stable at this moment? Generic airline-style criteria. */
export function stableCheck(p: { aglFt: number; iasKt: number | null; vsFpm: number | null; bankDeg: number | null; gearDown: boolean | null }, refSpeedKt: number | null): string[] {
  const why: string[] = [];
  if (p.gearDown === false) why.push("gear up");
  if (p.vsFpm !== null && p.vsFpm < -1000) why.push(`sinking ${fmt(-p.vsFpm)} fpm`);
  if (p.vsFpm !== null && p.vsFpm > 200) why.push("climbing");
  if (p.bankDeg !== null && Math.abs(p.bankDeg) > 15) why.push(`banked ${Math.round(Math.abs(p.bankDeg))}°`);
  if (refSpeedKt !== null && p.iasKt !== null) {
    if (p.iasKt > refSpeedKt + 20) why.push(`${Math.round(p.iasKt - refSpeedKt)} kt fast`);
    else if (p.iasKt < refSpeedKt - 5) why.push(`${Math.round(refSpeedKt - p.iasKt)} kt slow`);
  }
  return why;
}

export function reviewApproach(frames: TelemetryFrame[], landing: LandingReport | null | undefined): ApproachReview | null {
  if (!landing || frames.length < 20) return null;
  const tdT = landing.t;
  const td = { lat: landing.lat, lon: landing.lon };
  // The airborne frames in the 15 minutes before touchdown, within 10 nm of it.
  const pts: ApproachPoint[] = [];
  for (const f of frames) {
    if (f.t > tdT || f.t < tdT - 15 * 60_000 || f.position.onGround) continue;
    const d = nm(f.position, td);
    if (d > 10.5) continue;
    const agl = f.position.altAglFt;
    if (agl === null || agl === undefined || agl > 4500) continue;
    pts.push({ distNm: d, aglFt: agl, iasKt: f.speed.iasKt ?? null, vsFpm: f.speed.vsFpm ?? null, bankDeg: f.attitude.bankDeg ?? null, gearDown: f.controls.gearDown ?? null, flapsPct: f.controls.flapsPct ?? null, t: f.t });
  }
  // Keep only the final, continuous run into the runway (drop an earlier pass or a hold).
  let start = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i]!.t - pts[i - 1]!.t > 60_000 || pts[i]!.distNm > pts[i - 1]!.distNm + 0.6) start = i;
  const run = pts.slice(start);
  if (run.length < 8) return null;

  // Reference speed: what the pilot flew over the last 300–100 ft (close to Vapp).
  const ref = median(run.filter((p) => p.aglFt <= 300 && p.aglFt >= 100 && p.iasKt !== null).map((p) => p.iasKt!));
  const dev = (p: ApproachPoint) => p.aglFt - p.distNm * FT_PER_NM_3DEG;

  const gates: Gate[] = [];
  for (const h of [1000, 500] as const) {
    // the first frame at or below the gate height
    const p = run.find((x) => x.aglFt <= h);
    if (!p) continue;
    const reasons = stableCheck(p, ref);
    gates.push({ heightFt: h, stable: reasons.length === 0, reasons, iasKt: p.iasKt, vsFpm: p.vsFpm, pathDevFt: p.distNm > 0.3 ? Math.round(dev(p)) : null });
  }

  const notes: ApproachReview["notes"] = [];
  const within = run.filter((p) => p.distNm >= 0.6 && p.distNm <= 6);
  let maxDev: ApproachPoint | null = null;
  for (const p of within) if (!maxDev || Math.abs(dev(p)) > Math.abs(dev(maxDev))) maxDev = p;
  const maxDevFt = maxDev ? Math.round(dev(maxDev)) : null;
  if (maxDev && maxDevFt !== null) {
    if (Math.abs(maxDevFt) <= 150) notes.push({ good: true, text: "Stayed close to a 3° path all the way down." });
    else notes.push({ good: false, text: `${maxDevFt > 0 ? "High" : "Low"} on the approach: ${fmt(Math.abs(maxDevFt))} ft ${maxDevFt > 0 ? "above" : "below"} a 3° path at ${maxDev.distNm.toFixed(1)} nm.${maxDevFt > 0 ? " Start down earlier or slow down sooner." : " Hold altitude a little longer before descending."}` });
  }
  for (const g of gates) {
    if (g.stable) notes.push({ good: true, text: `Stable at ${g.heightFt} ft.` });
    else notes.push({ good: false, text: `Not stable at ${g.heightFt} ft: ${g.reasons.join(", ")}.${g.heightFt === 500 ? " Real airlines would go around here." : ""}` });
  }
  const gearAt = (() => { let prev: boolean | null = null; for (const p of run) { if (p.gearDown && prev === false) return p.aglFt; prev = p.gearDown; } return null; })();
  if (gearAt !== null && gearAt < 1500) notes.push({ good: false, text: `Gear came down late, at ${fmt(gearAt)} ft. Aim for gear down by about 2,000 ft.` });
  const lowSink = run.filter((p) => p.aglFt < 1000 && p.vsFpm !== null).map((p) => -p.vsFpm!);
  if (lowSink.length && Math.max(...lowSink) > 1200) notes.push({ good: false, text: `Sink rate peaked at ${fmt(Math.max(...lowSink))} fpm below 1,000 ft. Around 700–800 fpm is typical.` });
  const lowBank = run.filter((p) => p.aglFt < 200 && p.bankDeg !== null).map((p) => Math.abs(p.bankDeg!));
  if (lowBank.length && Math.max(...lowBank) > 7) notes.push({ good: false, text: `${Math.round(Math.max(...lowBank))}° of bank below 200 ft. Keep the wings level for the flare.` });
  const rw = landing.runway;
  if (rw) {
    if (rw.distanceFromThresholdFt !== null && rw.distanceFromThresholdFt > 3000) notes.push({ good: false, text: `Touched down ${fmt(rw.distanceFromThresholdFt)} ft past the threshold. The touchdown zone is about 1,000–2,000 ft in; a long float eats runway.` });
    else if (rw.distanceFromThresholdFt !== null && rw.distanceFromThresholdFt >= 700 && rw.distanceFromThresholdFt <= 2500) notes.push({ good: true, text: `Touched down in the touchdown zone, ${fmt(rw.distanceFromThresholdFt)} ft in.` });
    if (rw.centrelineOffsetFt !== null && Math.abs(rw.centrelineOffsetFt) > 20) notes.push({ good: false, text: `${fmt(Math.abs(rw.centrelineOffsetFt))} ft ${rw.centrelineOffsetFt > 0 ? "right" : "left"} of the centreline at touchdown.` });
    else if (rw.centrelineOffsetFt !== null) notes.push({ good: true, text: "Right on the centreline." });
  }
  return { points: run, gates, notes, refSpeedKt: ref === null ? null : Math.round(ref), maxDevFt };
}

/** Live: which stable-approach gate (if any) the aircraft just passed, given the previous and current height above ground. */
export function gateCrossed(prevAglFt: number | null, aglFt: number | null): 1000 | 500 | null {
  if (prevAglFt === null || aglFt === null) return null;
  for (const g of [1000, 500] as const) if (prevAglFt > g && aglFt <= g) return g;
  return null;
}
