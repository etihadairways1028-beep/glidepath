/**
 * Landing analysis.
 *
 * A landing is graded on up to seven components. Each component is scored
 * 0-100 against limits from the aircraft's landing profile, then combined
 * with published weights. Components without data (e.g. centreline when no
 * runway is known) are left out and the remaining weights renormalised, and
 * the report says so. Nothing is guessed.
 *
 * Every threshold lives in LANDING_PROFILES so the grading is transparent and
 * can be shown to users verbatim.
 */
import type { LandingComponent, LandingReport, TelemetryFrame } from "@glidepath/protocol";
import { alongTrackNm, angleDiff, crossTrackNm, destinationPoint, type LatLon, windComponents } from "./geo.js";

export interface LandingProfile {
  id: string;
  label: string;
  /** Sink rate (fpm, positive down) band considered ideal. */
  idealVsFpm: [number, number];
  firmVsFpm: number;
  hardVsFpm: number;
  gFirm: number;
  gHard: number;
  maxBankDeg: number;
  /** Pitch at which tail strike becomes likely. */
  tailStrikePitchDeg: number;
  /** Ideal touchdown distance from threshold (ft). */
  touchdownZoneFt: [number, number];
}

export const LANDING_PROFILES: Record<string, LandingProfile> = {
  "narrowbody-jet": {
    id: "narrowbody-jet", label: "Narrow-body jet (A320 family, 737, E-Jets)",
    idealVsFpm: [60, 180], firmVsFpm: 360, hardVsFpm: 600, gFirm: 1.3, gHard: 1.7,
    maxBankDeg: 7, tailStrikePitchDeg: 10, touchdownZoneFt: [800, 2000],
  },
  "widebody-jet": {
    id: "widebody-jet", label: "Wide-body jet (777, 787, A330, A350, 747)",
    idealVsFpm: [80, 220], firmVsFpm: 400, hardVsFpm: 600, gFirm: 1.3, gHard: 1.7,
    maxBankDeg: 6, tailStrikePitchDeg: 9, touchdownZoneFt: [1000, 2500],
  },
  "turboprop": {
    id: "turboprop", label: "Regional turboprop (ATR, Dash 8)",
    idealVsFpm: [60, 220], firmVsFpm: 400, hardVsFpm: 650, gFirm: 1.35, gHard: 1.8,
    maxBankDeg: 8, tailStrikePitchDeg: 8, touchdownZoneFt: [500, 1800],
  },
  "light-aircraft": {
    id: "light-aircraft", label: "Light aircraft (C172, SR22, DA40, PA-28)",
    idealVsFpm: [40, 250], firmVsFpm: 450, hardVsFpm: 700, gFirm: 1.4, gHard: 2.0,
    maxBankDeg: 10, tailStrikePitchDeg: 13, touchdownZoneFt: [200, 1200],
  },
  generic: {
    id: "generic", label: "Generic aircraft",
    idealVsFpm: [60, 220], firmVsFpm: 400, hardVsFpm: 650, gFirm: 1.35, gHard: 1.8,
    maxBankDeg: 8, tailStrikePitchDeg: 10, touchdownZoneFt: [500, 2000],
  },
};

const WIDEBODY = /^(B74|B76|B77|B78|A30|A31[0]?$|A33|A34|A35|A38|MD11|IL96)/;
const NARROWBODY = /^(A31[89]|A32|A2[01]N|BCS|A22|B71|B72|B73|B3[789]M|B73|E1[79]|E19|E29|CRJ|MD8|MD9|F100|B46)/;
const TURBOPROP = /^(AT[4-7]|DH8|Q400|JS4|SF34|D328|C208)/;
const LIGHT = /^(C1[5-8]|C17|C182|SR2|DA4|DA6|PA2|PA3|PA4|BE3|BE5|M20|TBM|PC12|DV20|C42|A5|DR40)/;

/** Choose a landing profile from the ICAO type or, failing that, the title. */
export function landingProfileFor(icaoType: string | null, title = ""): LandingProfile {
  const t = (icaoType ?? "").toUpperCase().trim();
  const name = title.toUpperCase();
  if (t) {
    if (WIDEBODY.test(t)) return LANDING_PROFILES["widebody-jet"]!;
    if (NARROWBODY.test(t)) return LANDING_PROFILES["narrowbody-jet"]!;
    if (TURBOPROP.test(t)) return LANDING_PROFILES["turboprop"]!;
    if (LIGHT.test(t)) return LANDING_PROFILES["light-aircraft"]!;
  }
  if (/777|787|A350|A330|A380|747/.test(name)) return LANDING_PROFILES["widebody-jet"]!;
  if (/A3[12][019]|A32N|737|A220|E1[79]5|CRJ/.test(name)) return LANDING_PROFILES["narrowbody-jet"]!;
  if (/ATR|DASH ?8|Q400/.test(name)) return LANDING_PROFILES["turboprop"]!;
  if (/172|152|SR22|DA40|DA62|PA-?28|BONANZA|BARON|TBM|PC-?12/.test(name)) return LANDING_PROFILES["light-aircraft"]!;
  return LANDING_PROFILES.generic!;
}

export interface RunwayEnd {
  ident: string;
  threshold: LatLon;
  headingTrueDeg: number;
  lengthFt: number;
  widthFt: number;
}

const FT_PER_NM = 6076.12;

/** Position relative to a runway: distance past the threshold and offset from centreline. */
export function runwayPosition(rwy: RunwayEnd, p: LatLon): { alongFt: number; offsetFt: number } {
  const far = destinationPoint(rwy.threshold, rwy.headingTrueDeg, rwy.lengthFt / FT_PER_NM);
  return {
    alongFt: alongTrackNm(rwy.threshold, far, p) * FT_PER_NM,
    offsetFt: crossTrackNm(rwy.threshold, far, p) * FT_PER_NM,
  };
}

/** Find the runway a touchdown happened on, if any candidate fits. */
export function matchRunway(runways: RunwayEnd[], p: LatLon, headingTrueDeg: number | null): RunwayEnd | null {
  let best: { r: RunwayEnd; cost: number } | null = null;
  for (const r of runways) {
    if (headingTrueDeg !== null && Math.abs(angleDiff(headingTrueDeg, r.headingTrueDeg)) > 30) continue;
    const pos = runwayPosition(r, p);
    if (pos.alongFt < -300 || pos.alongFt > r.lengthFt + 300) continue;
    if (Math.abs(pos.offsetFt) > r.widthFt * 1.5) continue;
    const cost = Math.abs(pos.offsetFt);
    if (!best || cost < best.cost) best = { r, cost };
  }
  return best?.r ?? null;
}

/* ---------------- scoring helpers ---------------- */

/** Piecewise-linear interpolation through (x, y) points sorted by x. */
function piecewise(x: number, pts: Array<[number, number]>): number {
  if (x <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1]![1];
}

export function scoreSinkRate(vs: number, p: LandingProfile): number {
  const [lo, hi] = p.idealVsFpm;
  return piecewise(vs, [[0, 85], [lo, 100], [hi, 100], [p.firmVsFpm, 70], [p.hardVsFpm, 30], [p.hardVsFpm * 1.5, 0]]);
}
export function scoreG(g: number, p: LandingProfile): number {
  return piecewise(g, [[1.0, 100], [1.15, 100], [p.gFirm, 75], [p.gHard, 30], [p.gHard + 0.5, 0]]);
}
export function scoreBounce(n: number): number {
  return n <= 0 ? 100 : n === 1 ? 60 : n === 2 ? 30 : 0;
}
export function scoreBank(bankAbs: number, p: LandingProfile): number {
  return piecewise(bankAbs, [[0, 100], [2, 100], [5, 70], [p.maxBankDeg, 20], [p.maxBankDeg + 2, 0]]);
}
export function scorePitch(pitch: number, p: LandingProfile): number {
  if (pitch < 0) return 30; // nose-wheel first
  return piecewise(pitch, [[0, 75], [2, 100], [p.tailStrikePitchDeg - 2, 100], [p.tailStrikePitchDeg, 20], [p.tailStrikePitchDeg + 1, 0]]);
}
export function scoreCentreline(offsetAbsFt: number): number {
  return piecewise(offsetAbsFt, [[0, 100], [6, 100], [20, 70], [40, 30], [60, 0]]);
}
export function scoreTouchdownZone(alongFt: number, p: LandingProfile): number {
  const [lo, hi] = p.touchdownZoneFt;
  return piecewise(alongFt, [[0, 0], [lo * 0.5, 60], [lo, 100], [hi, 100], [hi * 1.6, 40], [hi * 2.2, 0]]);
}

export const COMPONENT_WEIGHTS: Record<LandingComponent["id"], number> = {
  sinkRate: 30, gLoad: 20, bounce: 15, bank: 10, pitch: 10, centreline: 7.5, touchdownZone: 7.5,
};

export function gradeFor(score: number): LandingReport["grade"] {
  if (score >= 95) return "A+";
  if (score >= 88) return "A";
  if (score >= 78) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

/* ---------------- the analyser ---------------- */

export interface LandingAnalyzerOptions {
  profile: LandingProfile;
  runways?: RunwayEnd[];
  /** Seconds after touchdown to keep collecting (bounces, peak G). */
  windowS?: number;
}

/**
 * Feed every frame with `push`. Call `touchdown(frame)` when the phase
 * detector reports TOUCHDOWN. When the post-touchdown window has elapsed,
 * `push` returns the finished LandingReport.
 */
export class LandingAnalyzer {
  private buffer: TelemetryFrame[] = [];
  private pending: { td: TelemetryFrame; after: TelemetryFrame[] } | null = null;
  private opts: Required<LandingAnalyzerOptions>;

  constructor(opts: LandingAnalyzerOptions) {
    this.opts = { runways: [], windowS: 12, ...opts };
  }

  setProfile(profile: LandingProfile): void {
    this.opts.profile = profile;
  }
  setRunways(runways: RunwayEnd[]): void {
    this.opts.runways = runways;
  }

  push(f: TelemetryFrame): LandingReport | null {
    this.buffer.push(f);
    const cutoff = f.t - 60_000;
    while (this.buffer.length && this.buffer[0]!.t < cutoff) this.buffer.shift();
    if (!this.pending) return null;
    if (f.t > this.pending.td.t) this.pending.after.push(f);
    if (f.t - this.pending.td.t >= this.opts.windowS * 1000) {
      const report = this.analyse(this.pending.td, this.pending.after);
      this.pending = null;
      return report;
    }
    return null;
  }

  touchdown(td: TelemetryFrame): void {
    // The detector confirms a touchdown slightly after first contact, so frames
    // already buffered since that contact belong to this landing's window.
    this.pending = { td, after: this.buffer.filter((f) => f.t > td.t) };
  }

  /** Force a report now (e.g. the sim closed right after touchdown). */
  flush(): LandingReport | null {
    if (!this.pending) return null;
    const r = this.analyse(this.pending.td, this.pending.after);
    this.pending = null;
    return r;
  }

  private analyse(td: TelemetryFrame, after: TelemetryFrame[]): LandingReport {
    const p = this.opts.profile;
    const before = this.buffer.filter((f) => f.t < td.t && f.t >= td.t - 20_000);

    // Sink rate: simulator's own touchdown value first, else steepest V/S in the last second airborne.
    // MSFS keeps the last touchdown value until the next touchdown; a value equal to the
    // one held before this contact is stale and must not be reused.
    const heldBefore = before.length ? before[before.length - 1]!.loads.touchdownVsFpm : null;
    const simVs = [td, ...after.slice(0, 5)]
      .map((f) => f.loads.touchdownVsFpm)
      .find((v) => v !== null && v !== undefined && Math.abs(v) > 0.01 && v !== heldBefore);
    let vs: number | null = null;
    let vsSource: LandingReport["touchdownVsSource"] = "derived";
    if (simVs !== undefined && simVs !== null) {
      vs = Math.abs(simVs);
      vsSource = "simulator";
    } else {
      const lastSecond = before.filter((f) => f.t >= td.t - 1000 && f.speed.vsFpm !== null);
      const src = lastSecond.length ? lastSecond : [td];
      const minVs = Math.min(...src.map((f) => f.speed.vsFpm ?? 0));
      vs = Number.isFinite(minVs) ? Math.abs(Math.min(0, minVs)) : null;
    }

    const gWindow = [...before.filter((f) => f.t >= td.t - 500), td, ...after.filter((f) => f.t <= td.t + 3000)];
    const gs = gWindow.map((f) => f.loads.gForce).filter((g): g is number => g !== null);
    const peakG = gs.length ? Math.max(...gs) : null;

    // Bounces: ground → air → ground cycles after the first contact.
    let bounces = 0;
    let wasGround = true;
    for (const f of after) {
      if (wasGround && !f.position.onGround && (f.position.altAglFt ?? 0) > 1) wasGround = false;
      else if (!wasGround && f.position.onGround) {
        bounces++;
        wasGround = true;
      }
    }

    // Flare: from the last time the aircraft descended through 30 ft AGL to touchdown.
    let flareSeconds: number | null = null;
    for (let i = before.length - 1; i > 0; i--) {
      const a = before[i - 1]!.position.altAglFt;
      const b = before[i]!.position.altAglFt;
      if (a !== null && b !== null && a >= 30 && b < 30) {
        flareSeconds = (td.t - before[i]!.t) / 1000;
        break;
      }
    }

    const hdg = td.attitude.headingTrueDeg;
    const wind = td.environment.windDirDeg !== null && td.environment.windKt !== null && hdg !== null
      ? windComponents(td.environment.windDirDeg, td.environment.windKt, hdg)
      : null;

    const runway = matchRunway(this.opts.runways, td.position, hdg);
    const rpos = runway ? runwayPosition(runway, td.position) : null;

    const pitch = td.attitude.pitchDeg;
    const bank = td.attitude.bankDeg;
    const comps: LandingComponent[] = [
      comp("sinkRate", "Sink rate at touchdown", vs, "fpm", vs === null ? null : scoreSinkRate(vs, p),
        vs === null ? "Not available" : `Ideal ${p.idealVsFpm[0]}–${p.idealVsFpm[1]} fpm, firm above ${p.firmVsFpm}, hard above ${p.hardVsFpm} (${vsSource === "simulator" ? "simulator touchdown value" : "derived from vertical speed"})`),
      comp("gLoad", "Peak G at touchdown", peakG, "g", peakG === null ? null : scoreG(peakG, p),
        peakG === null ? "Not available" : `Firm above ${p.gFirm} g, hard above ${p.gHard} g`),
      comp("bounce", "Bounces", bounces, "", scoreBounce(bounces), "Each extra ground contact after the first costs points"),
      comp("bank", "Bank at touchdown", bank === null ? null : Math.abs(bank), "°", bank === null ? null : scoreBank(Math.abs(bank), p),
        `Wing-tip margin falls past ${p.maxBankDeg}°`),
      comp("pitch", "Pitch at touchdown", pitch, "°", pitch === null ? null : scorePitch(pitch, p),
        `Tail-strike risk near ${p.tailStrikePitchDeg}°; below 0° is nose-wheel first`),
      comp("centreline", "Centreline offset", rpos ? Math.abs(rpos.offsetFt) : null, "ft", rpos ? scoreCentreline(Math.abs(rpos.offsetFt)) : null,
        rpos ? "Within 6 ft scores full marks" : "No runway data for this touchdown"),
      comp("touchdownZone", "Distance past threshold", rpos ? rpos.alongFt : null, "ft", rpos ? scoreTouchdownZone(rpos.alongFt, p) : null,
        rpos ? `Target zone ${p.touchdownZoneFt[0]}–${p.touchdownZoneFt[1]} ft` : "No runway data for this touchdown"),
    ];

    const scored = comps.filter((c) => c.score !== null);
    const wSum = scored.reduce((s, c) => s + c.weight, 0);
    let score = wSum > 0 ? scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wSum : 0;
    // Hard landings cap the grade: a perfect centreline cannot rescue a 900 fpm arrival.
    if (vs !== null && vs >= p.hardVsFpm) score = Math.min(score, 49);
    if (peakG !== null && peakG >= p.gHard) score = Math.min(score, 49);
    score = Math.round(score * 10) / 10;

    return {
      t: td.t,
      lat: td.position.lat,
      lon: td.position.lon,
      touchdownVsFpm: vs === null ? null : Math.round(vs),
      touchdownVsSource: vsSource,
      peakG: peakG === null ? null : Math.round(peakG * 100) / 100,
      iasKt: td.speed.iasKt,
      gsKt: td.speed.gsKt,
      pitchDeg: pitch,
      bankDeg: bank,
      bounces,
      flareSeconds: flareSeconds === null ? null : Math.round(flareSeconds * 10) / 10,
      crosswindKt: wind ? Math.round(wind.crosswindKt * 10) / 10 : null,
      headwindKt: wind ? Math.round(wind.headwindKt * 10) / 10 : null,
      runway: runway && rpos ? { ident: runway.ident, distanceFromThresholdFt: Math.round(rpos.alongFt), centrelineOffsetFt: Math.round(rpos.offsetFt) } : null,
      profileId: p.id,
      components: comps,
      score,
      grade: gradeFor(score),
      verdict: verdictFor(comps, vs, p),
    };
  }
}

function comp(id: LandingComponent["id"], label: string, value: number | null, unit: string, score: number | null, note: string): LandingComponent {
  return {
    id, label, unit, note,
    value: value === null ? null : Math.round(value * 100) / 100,
    score: score === null ? null : Math.round(score),
    weight: COMPONENT_WEIGHTS[id],
  };
}

function verdictFor(comps: LandingComponent[], vs: number | null, p: LandingProfile): string {
  if (vs !== null && vs >= p.hardVsFpm) return "Hard landing — an inspection would be required in real operations.";
  const worst = comps.filter((c) => c.score !== null).sort((a, b) => (a.score as number) - (b.score as number))[0];
  if (!worst || (worst.score as number) >= 80) return vs !== null && vs < p.idealVsFpm[0] ? "Very smooth — watch for floating long." : "Smooth, well-controlled landing.";
  const tips: Record<LandingComponent["id"], string> = {
    sinkRate: vs !== null && vs < p.idealVsFpm[0] ? "Very soft touchdown; check you are not floating long." : "Firm touchdown; start the flare a little earlier.",
    gLoad: "High touchdown load; aim for a steadier sink rate into the flare.",
    bounce: "The aircraft bounced; hold the flare attitude after first contact.",
    bank: "Wings not level at touchdown; correct drift with rudder earlier.",
    pitch: comps.find((c) => c.id === "pitch")?.value !== null && (comps.find((c) => c.id === "pitch")!.value as number) < 2 ? "Flat touchdown, nearly nose-first; hold a little more flare." : "Nose high at touchdown, close to the tail; fly it onto the runway.",
    centreline: "Touched down off the centreline.",
    touchdownZone: "Touched down outside the target zone.",
  };
  return tips[worst.id];
}
