/**
 * Flight review: measures the takeoff and keeps whole-flight handling
 * stats (speed below 10,000 ft, bank, taxi speed, approach gates) so the
 * debrief can say what went well and what to work on.
 *
 * Everything here comes from telemetry frames. Nothing is invented: a value
 * the simulator doesn't report stays null and the debrief skips it.
 */
import type { ApproachGate, FlightEvent, FlightPhase, FlightStats, ReviewNote, TakeoffReport, TelemetryFrame } from "@glidepath/protocol";
import { gradeFor } from "./landing.js";

export interface TakeoffBands {
  /** Rotation rate band considered normal (deg/s). */
  rotate: [number, number];
  /** Initial climb pitch band (deg). */
  climbPitch: [number, number];
  /** Pitch that is clearly too high after lift-off. */
  excessivePitch: number;
  /** Pitch at lift-off where the tail meets the runway (approx., gear extended). */
  tailDeg: number;
  /** Bank limits for the whole flight: [comfortable, excessive]. */
  bank: [number, number];
  /** Whether the type normally has retractable gear. */
  retractableGear: boolean;
}

export const TAKEOFF_BANDS: Record<string, TakeoffBands> = {
  "narrowbody-jet": { rotate: [2, 3.5], climbPitch: [12, 18], excessivePitch: 21, tailDeg: 11.5, bank: [30, 35], retractableGear: true },
  "widebody-jet": { rotate: [1.5, 3], climbPitch: [11, 17], excessivePitch: 20, tailDeg: 10, bank: [30, 35], retractableGear: true },
  turboprop: { rotate: [2, 4], climbPitch: [8, 14], excessivePitch: 17, tailDeg: 9, bank: [30, 35], retractableGear: true },
  "light-aircraft": { rotate: [1, 5], climbPitch: [5, 12], excessivePitch: 15, tailDeg: 14, bank: [45, 60], retractableGear: false },
  generic: { rotate: [1.5, 4], climbPitch: [8, 18], excessivePitch: 21, tailDeg: 11, bank: [30, 35], retractableGear: true },
};

export function takeoffBandsFor(profileId: string): TakeoffBands {
  return TAKEOFF_BANDS[profileId] ?? TAKEOFF_BANDS.generic!;
}

export function emptyStats(): FlightStats {
  return {
    overspeedBelow10kS: 0, maxIasBelow10kKt: null, maxBankDeg: null, steepBankS: 0, maxG: null, minG: null,
    maxTaxiKt: null, fastTaxiS: 0, climbAvgFpm: null, descentAvgFpm: null, maxDescentFpm: null,
    gate1000: null, gate500: null, maxSinkBelow1000Fpm: null, iasSpreadBelow1000Kt: null, maxBankBelow500Deg: null,
    goArounds: 0, pausedS: 0,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const max = (a: number | null, b: number | null) => (b === null ? a : a === null ? b : Math.max(a, b));
const min = (a: number | null, b: number | null) => (b === null ? a : a === null ? b : Math.min(a, b));

interface Liftoff { t: number; ias: number | null; pitch: number | null; mslFt: number | null }

export class FlightReviewer {
  stats: FlightStats = emptyStats();
  takeoff: TakeoffReport | null = null;
  private profileId: string;
  private prev: TelemetryFrame | null = null;

  // Takeoff measurement
  private rollStartT: number | null = null;
  private rollFt = 0;
  private basePitch: number | null = null;
  private rotate: { t: number; pitch: number; ias: number | null } | null = null;
  private liftoff: Liftoff | null = null;
  private climbPitchSum = 0;
  private climbPitchN = 0;
  private maxPitch: number | null = null;
  private lowBank: number | null = null;
  private at35: { t: number; alt: number } | null = null;
  private at1000: { t: number; alt: number } | null = null;
  private gearUpS: number | null = null;
  private peakG: number | null = null;

  // Climb / descent
  private todT: number | null = null;
  private todAlt: number | null = null;
  private iasLo: number | null = null;
  private iasHi: number | null = null;
  private fastTaxi: { kt: number; s: number } | null = null;

  constructor(profileId = "generic") {
    this.profileId = profileId;
  }

  setProfile(profileId: string): void {
    this.profileId = profileId;
  }

  /** Feed every frame with the phase after the detector ran and the events it raised. */
  push(f: TelemetryFrame, phase: FlightPhase, events: FlightEvent[] = []): void {
    const p = this.prev;
    this.prev = f;
    const dt = p ? Math.max(0, Math.min(5, (f.t - p.t) / 1000)) : 0;
    if (f.sim.paused) { this.stats.pausedS += dt; return; }
    const s = this.stats;
    const agl = f.position.altAglFt;
    const ias = f.speed.iasKt;
    const vs = f.speed.vsFpm;

    for (const e of events) {
      if (e.type === "TOP_OF_CLIMB" && this.liftoff?.mslFt != null && e.altMslFt !== null) {
        const mins = (e.t - this.liftoff.t) / 60000;
        if (mins > 0.5) s.climbAvgFpm = Math.round((e.altMslFt - this.liftoff.mslFt) / mins);
      }
      if (e.type === "TOP_OF_DESCENT") { this.todT = e.t; this.todAlt = e.altMslFt; }
      if (e.type === "GO_AROUND") {
        s.goArounds++;
        s.gate1000 = null; s.gate500 = null; s.maxSinkBelow1000Fpm = null; s.iasSpreadBelow1000Kt = null; s.maxBankBelow500Deg = null;
        this.iasLo = null; this.iasHi = null;
      }
    }

    if (!this.takeoff) this.measureTakeoff(f, p, dt);

    const airborne = !f.position.onGround;
    const bank = f.attitude.bankDeg === null ? null : Math.abs(f.attitude.bankDeg);
    if (airborne) {
      const alt = f.position.altMslFt;
      if (alt !== null && alt < 10_000 && ias !== null && (agl === null || agl > 50)) {
        s.maxIasBelow10kKt = max(s.maxIasBelow10kKt, Math.round(ias));
        if (ias > 255) s.overspeedBelow10kS += dt;
      }
      if (bank !== null) {
        s.maxBankDeg = max(s.maxBankDeg, r1(bank));
        if (bank > 30) s.steepBankS += dt;
      }
      if (f.loads.gForce !== null) { s.maxG = max(s.maxG, r1(f.loads.gForce)); s.minG = min(s.minG, r1(f.loads.gForce)); }
      if ((phase === "DESCENT" || phase === "APPROACH") && vs !== null && vs < 0) s.maxDescentFpm = max(s.maxDescentFpm, Math.round(-vs));

      // Approach gates: crossing 1,000 and 500 ft above the ground on the way down.
      const pa = p?.position.altAglFt ?? null;
      if (agl !== null && pa !== null && vs !== null && vs < 0 && (phase === "DESCENT" || phase === "APPROACH" || phase === "LANDING")) {
        if (pa >= 1000 && agl < 1000) {
          s.gate1000 = gate(f, 1000);
          if (this.todT !== null && this.todAlt !== null && f.position.altMslFt !== null) {
            const mins = (f.t - this.todT) / 60000;
            if (mins > 1) s.descentAvgFpm = Math.round((this.todAlt - f.position.altMslFt) / mins);
          }
        }
        if (pa >= 500 && agl < 500) s.gate500 = gate(f, 500);
      }
      if (s.gate1000 && agl !== null && agl < 1000) {
        if (vs !== null && vs < 0) s.maxSinkBelow1000Fpm = max(s.maxSinkBelow1000Fpm, Math.round(-vs));
        if (ias !== null && agl > 100) {
          this.iasLo = min(this.iasLo, ias); this.iasHi = max(this.iasHi, ias);
          s.iasSpreadBelow1000Kt = Math.round(this.iasHi! - this.iasLo!);
        }
        if (bank !== null && agl < 500) s.maxBankBelow500Deg = max(s.maxBankBelow500Deg, r1(bank));
      }
    } else if ((phase === "TAXI_OUT" || phase === "TAXI_IN" || phase === "PUSHBACK") && !(this.rollStartT !== null && !this.liftoff)) {
      const gs = f.speed.gsKt;
      if (gs !== null) {
        if (gs > 20) {
          // Could be the start of the takeoff roll: hold it until speed comes back down.
          this.fastTaxi = { kt: Math.max(this.fastTaxi?.kt ?? 0, Math.round(gs)), s: (this.fastTaxi?.s ?? 0) + (gs > 30 ? dt : 0) };
        } else {
          s.maxTaxiKt = max(s.maxTaxiKt, Math.round(gs));
          if (this.fastTaxi && gs < 15) {
            s.maxTaxiKt = max(s.maxTaxiKt, this.fastTaxi.kt);
            s.fastTaxiS += this.fastTaxi.s;
            this.fastTaxi = null;
          }
        }
      }
    }
    if (f.position.onGround && (f.speed.gsKt ?? 0) > 60) this.fastTaxi = null;
  }

  private measureTakeoff(f: TelemetryFrame, p: TelemetryFrame | null, dt: number): void {
    const gs = f.speed.gsKt ?? 0;
    const pitch = f.attitude.pitchDeg;
    const agl = f.position.altAglFt;

    if (!this.liftoff) {
      if (!f.position.onGround) {
        if (p?.position.onGround && this.rollStartT !== null) {
          this.liftoff = { t: f.t, ias: f.speed.iasKt, pitch, mslFt: f.position.altMslFt !== null ? f.position.altMslFt - (agl ?? 0) : null };
        }
        return;
      }
      if (gs > 40) {
        this.rollStartT ??= f.t;
        this.rollFt += gs * 1.68781 * dt;
        if (pitch !== null && !this.rotate) {
          if (gs < 70 || this.basePitch === null) this.basePitch = pitch;
          else if (pitch - this.basePitch > 1) this.rotate = { t: p?.t ?? f.t, pitch: this.basePitch, ias: p?.speed.iasKt ?? f.speed.iasKt };
        }
      } else if (gs < 30) {
        // Back to taxi speed (or a rejected takeoff): start over.
        this.rollStartT = null; this.rollFt = 0; this.basePitch = null; this.rotate = null;
      }
      return;
    }

    // Airborne after lift-off, up to 1,500 ft above the runway.
    const lo = this.liftoff;
    const height = agl ?? (f.position.altMslFt !== null && lo.mslFt !== null ? f.position.altMslFt - lo.mslFt : null);
    if (pitch !== null) this.maxPitch = max(this.maxPitch, r1(pitch));
    if (pitch !== null && height !== null && height >= 35) { this.climbPitchSum += pitch; this.climbPitchN++; }
    if (height !== null && height >= 35 && !this.at35 && f.position.altMslFt !== null) this.at35 = { t: f.t, alt: f.position.altMslFt };
    if (height !== null && height >= 1000 && !this.at1000 && f.position.altMslFt !== null) this.at1000 = { t: f.t, alt: f.position.altMslFt };
    if (height !== null && height < 1000 && f.attitude.bankDeg !== null) this.lowBank = max(this.lowBank, r1(Math.abs(f.attitude.bankDeg)));
    if (this.gearUpS === null && f.controls.gearDown === false) this.gearUpS = r1((f.t - lo.t) / 1000);
    if (f.t - lo.t < 10_000 && f.loads.gForce !== null) this.peakG = max(this.peakG, r1(f.loads.gForce));

    if ((height !== null && height > 1500) || f.t - lo.t > 120_000 || f.position.onGround) this.takeoff = this.buildTakeoff();
  }

  private buildTakeoff(): TakeoffReport {
    const b = takeoffBandsFor(this.profileId);
    const lo = this.liftoff!;
    const rot = this.rotate;
    const rate = rot && lo.pitch !== null && lo.t - rot.t >= 300 ? r1((lo.pitch - rot.pitch) / ((lo.t - rot.t) / 1000)) : null;
    const climbFpm = this.at35 && this.at1000 && this.at1000.t > this.at35.t ? Math.round((this.at1000.alt - this.at35.alt) / ((this.at1000.t - this.at35.t) / 60000)) : null;
    const avgPitch = this.climbPitchN ? r1(this.climbPitchSum / this.climbPitchN) : null;
    const notes = takeoffNotes({ rate, liftoffPitch: lo.pitch, maxPitch: this.maxPitch, lowBank: this.lowBank, gearUpS: this.gearUpS }, b);
    const improve = notes.filter((n) => n.level === "improve").length;
    const ok = notes.filter((n) => n.level === "ok").length;
    const score = Math.max(30, 100 - improve * 16 - ok * 6);
    return {
      t: lo.t,
      profileId: this.profileId,
      rotateIasKt: rot?.ias != null ? Math.round(rot.ias) : null,
      liftoffIasKt: lo.ias !== null ? Math.round(lo.ias) : null,
      liftoffPitchDeg: lo.pitch !== null ? r1(lo.pitch) : null,
      rotationRateDegS: rate,
      maxPitchDeg: this.maxPitch,
      avgClimbPitchDeg: avgPitch,
      initialClimbFpm: climbFpm,
      maxBankDeg: this.lowBank,
      groundRollFt: this.rollFt > 0 ? Math.round(this.rollFt / 50) * 50 : null,
      gearUpS: b.retractableGear ? this.gearUpS : null,
      peakG: this.peakG,
      tailStrikePitchDeg: b.tailDeg,
      score,
      grade: gradeFor(score),
      verdict: takeoffVerdict(notes),
      notes: notes.map(({ level, text }) => ({ level, text })),
    };
  }
}

function gate(f: TelemetryFrame, heightFt: number): ApproachGate {
  return {
    heightFt,
    iasKt: f.speed.iasKt !== null ? Math.round(f.speed.iasKt) : null,
    vsFpm: f.speed.vsFpm !== null ? Math.round(f.speed.vsFpm) : null,
    gearDown: f.controls.gearDown,
    flapsPct: f.controls.flapsPct,
    bankDeg: f.attitude.bankDeg !== null ? r1(f.attitude.bankDeg) : null,
  };
}

type Tagged = ReviewNote & { tag: string };

export interface TakeoffMeasures { rate: number | null; liftoffPitch: number | null; maxPitch: number | null; lowBank: number | null; gearUpS: number | null }

export function takeoffNotes(m: TakeoffMeasures, b: TakeoffBands): Tagged[] {
  const out: Tagged[] = [];
  const [rl, rh] = b.rotate;
  const band = `${rl}–${rh}° a second`;
  if (m.rate !== null) {
    const r = m.rate;
    if (r < rl * 0.7) out.push({ level: "improve", tag: "slow", text: `Slow rotation, ${r}° a second. Bring the nose up more positively, about ${band}, or the ground roll runs long.` });
    else if (r < rl) out.push({ level: "ok", tag: "gentle", text: `Gentle rotation at ${r}° a second, a little under the ${band} most operators teach.` });
    else if (r <= rh) out.push({ level: "good", tag: "rotate", text: `Smooth rotation at ${r}° a second, right where it should be.` });
    else if (r <= rh * 1.4) out.push({ level: "ok", tag: "brisk", text: `Brisk rotation at ${r}° a second. Ease it up closer to ${rh}° a second.` });
    else out.push({ level: "improve", tag: "snatched", text: `You snatched the rotation at ${r}° a second. That's how tail strikes happen; pull steadily, about ${band}.` });
  }
  if (m.liftoffPitch !== null) {
    const p = r1(m.liftoffPitch);
    if (p >= b.tailDeg) out.push({ level: "improve", tag: "tail", text: `Lifted off at ${p}° nose up, past the roughly ${b.tailDeg}° where the tail touches on this type. Rotate slower and let it fly off.` });
    else if (p >= b.tailDeg - 1) out.push({ level: "ok", tag: "tail-close", text: `Lifted off at ${p}°, within a degree of tail-strike attitude (about ${b.tailDeg}°).` });
    else out.push({ level: "good", tag: "tail-ok", text: `Plenty of tail clearance: ${p}° at lift-off.` });
  }
  if (m.maxPitch !== null) {
    const x = m.maxPitch;
    const [lo, hi] = b.climbPitch;
    if (x > b.excessivePitch) out.push({ level: "improve", tag: "overpitch", text: `Pitched up too far after lift-off, ${x}° nose up. Follow the flight director, normally ${lo}–${hi}°, or the speed bleeds away.` });
    else if (x > hi) out.push({ level: "ok", tag: "steep", text: `Steep initial climb at ${x}° nose up, a bit above the usual ${lo}–${hi}°.` });
    else if (x < lo - 3) out.push({ level: "improve", tag: "shallow", text: `Shallow climb-out, only ${x}° nose up. Hold ${lo}–${hi}° so the speed doesn't run away and you clear the ground quickly.` });
    else if (x < lo) out.push({ level: "ok", tag: "shallowish", text: `Slightly shallow climb at ${x}°; ${lo}–${hi}° is typical.` });
    else out.push({ level: "good", tag: "pitch", text: `Climb attitude of ${x}°, in the normal ${lo}–${hi}° range.` });
  }
  if (m.lowBank !== null) {
    if (m.lowBank > 15) out.push({ level: "improve", tag: "lowbank", text: `Banked ${m.lowBank}° below 1,000 ft. Keep it within 15° that close to the ground.` });
    else if (m.lowBank > 10) out.push({ level: "ok", tag: "lowbank", text: `Banked ${m.lowBank}° below 1,000 ft. Fine, but keep early turns shallow.` });
  }
  if (b.retractableGear && m.gearUpS !== null && m.gearUpS > 12) {
    out.push({ level: "ok", tag: "gear", text: `Gear came up ${Math.round(m.gearUpS)} s after lift-off. Raise it on positive rate, usually within a few seconds.` });
  }
  return out;
}

function takeoffVerdict(notes: Tagged[]): string {
  const has = (t: string) => notes.some((n) => n.tag === t);
  if (has("tail")) return "Tail-strike risk on rotation";
  if (has("snatched")) return "Rotation was snatched";
  if (has("overpitch")) return "Over-pitched on the climb-out";
  if (has("slow")) return "Sluggish rotation";
  if (has("shallow")) return "Shallow climb-out";
  if (notes.some((n) => n.level === "improve" && n.tag === "lowbank")) return "Turned too steeply close to the ground";
  const ok = notes.filter((n) => n.level === "ok").length;
  if (ok === 0) return "Smooth, by-the-book takeoff";
  if (ok === 1) return "Good takeoff";
  return "Decent takeoff, a little untidy";
}

/** Plain words for a touchdown sink rate (fpm, either sign). */
export function touchdownWords(fpm: number, profileId = "generic"): { word: string; level: ReviewNote["level"]; text: string } {
  const v = Math.round(Math.abs(fpm));
  const flare = profileId === "light-aircraft" ? "around 10–15 ft" : profileId === "widebody-jet" ? "around 30–40 ft" : "around 20–30 ft";
  if (v < 60) return { word: "Very soft", level: "good", text: `${v} fpm, barely felt. Almost too soft: on a wet or short runway you want it on firmly, so make sure you didn't float.` };
  if (v < 150) return { word: "Smooth", level: "good", text: `Smooth touchdown at ${v} fpm. Exactly what you want.` };
  if (v < 240) return { word: "Normal", level: "good", text: `A normal, positive touchdown at ${v} fpm. That's what line pilots aim for.` };
  if (v < 360) return { word: "Firm", level: "ok", text: `Firm at ${v} fpm. You'd feel it in the cabin, but it's well inside limits.` };
  if (v < 600) return { word: "Heavy", level: "improve", text: `Heavy at ${v} fpm. Start the flare a touch earlier, ${flare}, and keep the power on until it's settled.` };
  return { word: "Hard", level: "improve", text: `Hard landing at ${v} fpm. Beyond about 600 fpm (10 ft/s) most airliners need a hard-landing inspection.` };
}

