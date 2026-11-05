/**
 * Flight phase detection.
 *
 * A deterministic state machine driven only by telemetry frames. Every
 * transition needs its condition to hold for a minimum time ("hold"), so
 * single noisy samples never flip the phase. Time comes from frame.t, which
 * makes the detector replayable and unit-testable.
 *
 * Handled edge cases: paused sim, slew/teleport (position discontinuity),
 * Bridge connecting mid-flight, rejected takeoff, go-around, bounces,
 * touch-and-go, and step climbs.
 */
import type { FlightEvent, FlightEventType, FlightPhase, TelemetryFrame } from "@glidepath/protocol";
import { angleDiff, bearingDeg, distanceNm, type LatLon } from "./geo.js";

export interface PhaseDetectorOptions {
  /** Planned cruise altitude (from SimBrief), improves top-of-climb detection. */
  plannedCruiseFt?: number | null;
  /** Destination position, improves approach detection. */
  destination?: LatLon | null;
}

export interface Thresholds {
  movingKt: number;
  taxiKt: number;
  takeoffRollKt: number;
  rejectKt: number;
  runwayExitKt: number;
  levelFpm: number;
  descentFpm: number;
  goAroundFpm: number;
  airborneDebounceS: number;
  groundDebounceS: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  movingKt: 1.5,
  taxiKt: 3,
  takeoffRollKt: 40,
  rejectKt: 30,
  runwayExitKt: 35,
  levelFpm: 300,
  descentFpm: -500,
  goAroundFpm: 500,
  airborneDebounceS: 1,
  groundDebounceS: 0.5,
};

type HoldKey =
  | "pushback" | "taxi" | "roll" | "reject" | "level" | "descent" | "approach" | "goAround"
  | "slow" | "stopped" | "touchAndGo";

export class PhaseDetector {
  phase: FlightPhase = "PREFLIGHT";
  readonly events: FlightEvent[] = [];

  private readonly th: Thresholds;
  private opts: PhaseDetectorOptions;
  private prev: TelemetryFrame | null = null;
  private holds = new Map<HoldKey, number>();
  private airborne = false;
  private rawAirSince: number | null = null;
  private rawGroundSince: number | null = null;
  private candidateAir: TelemetryFrame | null = null;
  private candidateGround: TelemetryFrame | null = null;
  private firstAirFrame: TelemetryFrame | null = null;
  private firstGroundFrame: TelemetryFrame | null = null;
  private airborneAt: number | null = null;
  private firstContact: TelemetryFrame | null = null;
  private hasFlown = false;
  private offBlock = false;
  private cruiseAltFt: number | null = null;
  private maxAltFt: number | null = null;
  private descentStart: TelemetryFrame | null = null;
  private approachMinAglFt: number | null = null;
  private paused = false;
  private enginesWereRunning = false;
  private initialised = false;

  constructor(opts: PhaseDetectorOptions = {}, thresholds: Partial<Thresholds> = {}) {
    this.opts = opts;
    this.th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  setOptions(opts: PhaseDetectorOptions): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Whether the debounced state is airborne. */
  get isAirborne(): boolean {
    return this.airborne;
  }

  /** Feed one frame; returns the events it produced (also appended to this.events). */
  update(f: TelemetryFrame): FlightEvent[] {
    const out: FlightEvent[] = [];

    // --- Pause handling: frames while paused never advance the state machine.
    if (f.sim.paused) {
      if (!this.paused) out.push(this.emit("SIM_PAUSED", f, this.phase));
      this.paused = true;
      return this.commit(out);
    }
    if (this.paused) {
      this.paused = false;
      out.push(this.emit("SIM_RESUMED", f, this.phase));
      // Timers restart after a pause so a 2-hour pause is not "level flight for 2 hours".
      this.holds.clear();
      this.prev = f;
      return this.commit(out);
    }

    // --- Slew or teleport: reset timers and do not treat the jump as flight.
    if (f.sim.slew) {
      this.holds.clear();
      this.prev = f;
      return this.commit(out);
    }
    if (this.prev && this.isDiscontinuity(this.prev, f)) {
      out.push(this.emit("POSITION_DISCONTINUITY", f, this.phase, {
        jumpNm: round(distanceNm(this.prev.position, f.position), 1),
      }));
      this.holds.clear();
    }

    if (!this.initialised) {
      this.initialiseFrom(f, out);
      this.initialised = true;
    }

    this.updateAirGround(f);
    const gs = f.speed.gsKt ?? 0;
    const vs = f.speed.vsFpm ?? 0;
    const alt = f.position.altMslFt;
    const agl = f.position.altAglFt;
    if (alt !== null && this.airborne) this.maxAltFt = Math.max(this.maxAltFt ?? alt, alt);

    const enginesRunning = f.engines.some((e) => e.running === true);
    if (this.enginesWereRunning && !enginesRunning && f.engines.length > 0 && f.engines.every((e) => e.running === false)) {
      if (this.hasFlown) out.push(this.emit("ENGINES_OFF", f, this.phase));
    }
    this.enginesWereRunning = enginesRunning;

    switch (this.phase) {
      case "PREFLIGHT":
      case "PUSHBACK": {
        const backwards = this.isMovingBackwards(f);
        if (this.hold("pushback", f.controls.pushbackActive === true || (gs > this.th.movingKt && backwards), f.t, 2)) {
          if (this.phase === "PREFLIGHT") {
            this.markOffBlock(f, out);
            out.push(this.transition("PUSHBACK_START", f, "PUSHBACK"));
          }
        }
        if (this.hold("taxi", gs > this.th.taxiKt && !backwards && f.controls.pushbackActive !== true, f.t, 3)) {
          this.markOffBlock(f, out);
          out.push(this.transition("TAXI_START", f, "TAXI_OUT"));
        }
        if (gs > this.th.takeoffRollKt && !this.airborne) {
          this.markOffBlock(f, out);
          out.push(this.transition("TAKEOFF_ROLL", f, "TAKEOFF"));
        }
        break;
      }
      case "TAXI_OUT": {
        if (this.hold("roll", !this.airborne && gs > this.th.takeoffRollKt, f.t, 1)) {
          out.push(this.transition("TAKEOFF_ROLL", f, "TAKEOFF"));
        }
        break;
      }
      case "TAKEOFF": {
        if (!this.hasFlown && !this.airborne && this.hold("reject", gs < this.th.rejectKt, f.t, 3)) {
          out.push(this.transition(null, f, "TAXI_OUT", { rejectedTakeoff: true }));
          break;
        }
        if (this.airborne && !this.hasFlown) {
          this.hasFlown = true;
          const wu = this.firstAirFrame ?? f;
          out.push(this.emit("WHEELS_UP", wu, "TAKEOFF"));
        }
        const airborneFor = this.airborneAt === null ? 0 : (f.t - this.airborneAt) / 1000;
        if (this.airborne && ((agl ?? 0) > 1500 || airborneFor > 90)) {
          out.push(this.transition(null, f, "CLIMB"));
        }
        break;
      }
      case "CLIMB": {
        const planned = this.opts.plannedCruiseFt ?? null;
        const nearPlanned = planned !== null && alt !== null && alt >= planned - 1000;
        const levelHold = planned !== null ? 30 : 90;
        const highEnough = (agl ?? alt ?? 0) > 3000;
        if (this.hold("level", Math.abs(vs) < this.th.levelFpm && highEnough && (planned === null || nearPlanned), f.t, levelHold)) {
          this.cruiseAltFt = alt;
          out.push(this.transition("TOP_OF_CLIMB", f, "CRUISE", { altitudeFt: round(alt, 0) }));
          break;
        }
        // Short flights may start descending without ever levelling off.
        if (this.checkDescent(f, this.maxAltFt, out)) break;
        this.checkApproach(f, out);
        break;
      }
      case "CRUISE": {
        // Step climbs: re-level at a new cruise altitude.
        if (this.hold("level", Math.abs(vs) < this.th.levelFpm, f.t, 60) && alt !== null) this.cruiseAltFt = alt;
        this.checkDescent(f, this.cruiseAltFt, out);
        break;
      }
      case "DESCENT": {
        this.checkApproach(f, out);
        break;
      }
      case "APPROACH": {
        if (agl !== null) this.approachMinAglFt = Math.min(this.approachMinAglFt ?? agl, agl);
        const climbingAway = vs > this.th.goAroundFpm && agl !== null && this.approachMinAglFt !== null && agl > this.approachMinAglFt + 300;
        if (this.airborne && this.hold("goAround", climbingAway, f.t, 5)) {
          out.push(this.transition("GO_AROUND", f, "CLIMB", { minimumAglFt: round(this.approachMinAglFt, 0) }));
          this.approachMinAglFt = null;
        }
        break;
      }
      case "LANDING": {
        // A bounce is brief; only a sustained climb-out is a touch-and-go.
        if (this.hold("touchAndGo", this.airborne && (agl ?? 0) > 200 && vs > 300, f.t, 5)) {
          out.push(this.transition("TOUCH_AND_GO", f, "CLIMB"));
          break;
        }
        if (!this.airborne && this.hold("slow", gs < this.th.runwayExitKt, f.t, 3)) {
          out.push(this.transition("RUNWAY_EXIT", f, "TAXI_IN", { method: "taxi-speed" }));
        }
        break;
      }
      case "TAXI_IN": {
        const engineOff = f.engines.length > 0 && f.engines.every((e) => e.running === false);
        const parked = gs < this.th.movingKt && (f.controls.parkingBrake === true || engineOff);
        if (this.hold("stopped", parked, f.t, 20)) {
          out.push(this.transition("ON_BLOCK", f, "COMPLETED"));
        }
        if (gs > this.th.takeoffRollKt) out.push(this.transition("TAKEOFF_ROLL", f, "TAKEOFF"));
        break;
      }
      case "COMPLETED":
        break;
    }

    // Touchdown from any airborne phase (except LANDING itself).
    if (this.hasFlown && !this.airborne && this.firstGroundFrame && isAirbornePhase(this.phase)) {
      const td = this.firstGroundFrame;
      this.firstGroundFrame = null;
      out.push(this.transitionAt("TOUCHDOWN", td, "LANDING"));
      this.approachMinAglFt = null;
    }

    this.prev = f;
    return this.commit(out);
  }

  /* ---------------- internals ---------------- */

  private initialiseFrom(f: TelemetryFrame, out: FlightEvent[]): void {
    if (f.position.onGround) return; // normal start: PREFLIGHT
    // The Bridge connected while the aircraft is already flying.
    this.airborne = true;
    this.hasFlown = true;
    this.offBlock = true;
    const vs = f.speed.vsFpm ?? 0;
    const alt = f.position.altMslFt ?? 0;
    const agl = f.position.altAglFt ?? alt;
    const next: FlightPhase = agl < 2500 && vs <= 0 ? "APPROACH" : vs > this.th.levelFpm ? "CLIMB" : vs < this.th.descentFpm ? "DESCENT" : alt > 10000 ? "CRUISE" : "CLIMB";
    if (next === "CRUISE") this.cruiseAltFt = alt;
    out.push(this.transition(null, f, next, { joinedInFlight: true }));
  }

  /**
   * Debounces the simulator's on-ground flag. The *first* frame of a new
   * state is remembered so events are time-stamped when they really happened
   * (wheels up / touchdown), not when the debounce completed.
   */
  private updateAirGround(f: TelemetryFrame): void {
    if (f.position.onGround) {
      this.rawAirSince = null;
      if (this.rawGroundSince === null) {
        this.rawGroundSince = f.t;
        this.candidateGround = f;
      }
      // The first wheel contact after flight is the touchdown, even if the aircraft bounces after it.
      if (this.airborne && this.firstContact === null) this.firstContact = f;
      if (this.airborne && f.t - this.rawGroundSince >= this.th.groundDebounceS * 1000) {
        this.airborne = false;
        this.firstGroundFrame = this.firstContact ?? this.candidateGround; // pending touchdown, consumed below
        this.firstContact = null;
      }
    } else {
      this.rawGroundSince = null;
      if (this.rawAirSince === null) {
        this.rawAirSince = f.t;
        this.candidateAir = f;
      }
      if (!this.airborne && f.t - this.rawAirSince >= this.th.airborneDebounceS * 1000) {
        this.airborne = true;
        this.firstAirFrame = this.candidateAir;
        this.airborneAt = this.candidateAir?.t ?? f.t;
      }
    }
  }

  private checkDescent(f: TelemetryFrame, referenceAltFt: number | null, out: FlightEvent[]): boolean {
    const vs = f.speed.vsFpm ?? 0;
    const alt = f.position.altMslFt;
    if (vs < this.th.descentFpm) {
      if (!this.descentStart) this.descentStart = f;
    } else if (vs > -100) {
      this.descentStart = null;
    }
    const below = referenceAltFt !== null && alt !== null && alt < referenceAltFt - 1000;
    if (this.hold("descent", vs < this.th.descentFpm && below, f.t, 30)) {
      const at = this.descentStart ?? f;
      this.descentStart = null;
      out.push(this.transitionAt("TOP_OF_DESCENT", at, "DESCENT", { fromAltitudeFt: round(referenceAltFt, 0) }));
      return true;
    }
    return false;
  }

  private checkApproach(f: TelemetryFrame, out: FlightEvent[]): void {
    const agl = f.position.altAglFt;
    if (agl === null) return;
    const vs = f.speed.vsFpm ?? 0;
    const configured = f.controls.gearDown === true || (f.controls.flapsIndex ?? 0) > 0;
    const dest = this.opts.destination;
    const nearDest = dest ? distanceNm(f.position, dest) < 15 : false;
    const cond = vs <= 100 && ((agl < 3000 && configured) || agl < 2000 || (nearDest && agl < 4000));
    if (this.hold("approach", cond, f.t, 5)) {
      out.push(this.transition("APPROACH_START", f, "APPROACH"));
      this.approachMinAglFt = agl;
    }
  }

  private isMovingBackwards(f: TelemetryFrame): boolean {
    if (!this.prev || f.attitude.headingTrueDeg === null) return false;
    const moved = distanceNm(this.prev.position, f.position);
    if (moved < 0.0015) return false; // < ~3 m: track is noise
    const track = bearingDeg(this.prev.position, f.position);
    return Math.abs(angleDiff(track, f.attitude.headingTrueDeg)) > 120;
  }

  private isDiscontinuity(a: TelemetryFrame, b: TelemetryFrame): boolean {
    const dtH = Math.max(0, b.t - a.t) / 3_600_000;
    const rate = Math.max(1, a.sim.simRate ?? 1, b.sim.simRate ?? 1);
    const maxGs = Math.max(a.speed.gsKt ?? 0, b.speed.gsKt ?? 0, 30);
    const possible = maxGs * 1.5 * rate * dtH + 0.5;
    return distanceNm(a.position, b.position) > possible;
  }

  private markOffBlock(f: TelemetryFrame, out: FlightEvent[]): void {
    if (this.offBlock) return;
    this.offBlock = true;
    out.push(this.emit("OFF_BLOCK", f, this.phase));
  }

  /** True once `cond` has held continuously for `seconds`. Resets when cond is false. */
  private hold(key: HoldKey, cond: boolean, t: number, seconds: number): boolean {
    if (!cond) {
      this.holds.delete(key);
      return false;
    }
    const since = this.holds.get(key);
    if (since === undefined) {
      this.holds.set(key, t);
      return seconds <= 0;
    }
    return t - since >= seconds * 1000;
  }

  private transition(type: FlightEventType | null, f: TelemetryFrame, to: FlightPhase, detail: Record<string, string | number | boolean | null> = {}): FlightEvent {
    return this.transitionAt(type, f, to, detail);
  }

  private transitionAt(type: FlightEventType | null, f: TelemetryFrame, to: FlightPhase, detail: Record<string, string | number | boolean | null> = {}): FlightEvent {
    const before = this.phase;
    this.phase = to;
    for (const k of ["pushback", "taxi", "roll", "reject", "level", "descent", "approach", "goAround", "slow", "stopped", "touchAndGo"] as HoldKey[]) {
      this.holds.delete(k);
    }
    const ev = this.emit(type ?? "SIM_RESUMED", f, before, detail);
    ev.phaseAfter = to;
    if (type === null) (ev as FlightEvent & { internal?: boolean }).internal = true;
    return ev;
  }

  private emit(type: FlightEventType, f: TelemetryFrame, before: FlightPhase, detail: Record<string, string | number | boolean | null> = {}): FlightEvent {
    return {
      type,
      t: f.t,
      seq: f.seq,
      lat: f.position.lat,
      lon: f.position.lon,
      altMslFt: f.position.altMslFt,
      phaseBefore: before,
      phaseAfter: this.phase,
      detail,
    };
  }

  private commit(out: FlightEvent[]): FlightEvent[] {
    // Internal transitions (no named event) are not published as events.
    const visible = out.filter((e) => !(e as FlightEvent & { internal?: boolean }).internal);
    this.events.push(...visible);
    return visible;
  }
}

function isAirbornePhase(p: FlightPhase): boolean {
  return p === "TAKEOFF" || p === "CLIMB" || p === "CRUISE" || p === "DESCENT" || p === "APPROACH";
}

function round(v: number | null, dp: number): number | null {
  if (v === null) return null;
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}
