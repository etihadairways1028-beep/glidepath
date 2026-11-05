/**
 * Flight session: turns the adapter's frame stream into flights.
 *
 *  - Assigns monotonic sequence numbers (continuing across Bridge restarts).
 *  - Runs the phase detector and landing analyser on every frame.
 *  - Records adaptively: up to 4 Hz on the ground and near it, 1 Hz in climb
 *    and descent, one frame per 5 s in stable cruise, plus every event frame.
 *  - Saves the flight summary every 10 s, so a crash loses at most 10 s.
 *  - Resumes the same flight if the sim reconnects within 30 minutes near
 *    the last position; otherwise marks it incomplete.
 *  - Discards "flights" that never left the gate.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AircraftInfo, FlightEvent, FlightPhase, FlightSummary, LandingReport, SimulatorInfo, TelemetryFrame } from "@glidepath/protocol";
import { distanceNm, LandingAnalyzer, landingProfileFor, PhaseDetector } from "@glidepath/flight-engine";
import type { RawFrame } from "./adapters/types.js";
import type { Logger } from "./log.js";
import { applyProfile, profileForTitle } from "./profiles.js";
import type { Recorder } from "./recorder.js";

const RESUME_WINDOW_MS = 30 * 60_000;
const RESUME_RADIUS_NM = 10;
const LIVE_BUFFER_MS = 10 * 60_000;

export interface SessionEvents {
  frame: (frame: TelemetryFrame, phase: FlightPhase) => void;
  event: (event: FlightEvent) => void;
  landing: (report: LandingReport) => void;
  flight: (summary: FlightSummary) => void;
}

export class FlightSession extends EventEmitter {
  private seq: number;
  private flight: FlightSummary | null = null;
  private detector = new PhaseDetector();
  private analyzer = new LandingAnalyzer({ profile: landingProfileFor(null) });
  private simulator: SimulatorInfo | null = null;
  private aircraft: AircraftInfo | null = null;
  private lastFrame: TelemetryFrame | null = null;
  private lastRecordedT = 0;
  private lastSavedT = 0;
  private live: TelemetryFrame[] = [];
  private readonly log: Logger;

  constructor(private readonly recorder: Recorder, log: Logger) {
    super();
    this.log = log.child("session");
    this.seq = recorder.maxSeq();
    const active = recorder.lastActiveFlight();
    if (active) {
      // Bridge restarted mid-flight: keep it resumable; it is closed on the first frame if not.
      this.flight = active;
      this.log.info(`Found unfinished flight ${active.id} (phase ${active.phase}); will resume if the aircraft is still nearby`);
    }
  }

  get activeFlight(): FlightSummary | null {
    return this.flight;
  }
  get currentSeq(): number {
    return this.seq;
  }
  get phase(): FlightPhase {
    return this.detector.phase;
  }

  setSimulator(info: SimulatorInfo): void {
    this.simulator = info;
  }

  setAircraft(info: AircraftInfo): void {
    this.aircraft = info;
    this.analyzer.setProfile(landingProfileFor(info.icaoType, info.title));
    if (this.flight && this.flight.phase === "PREFLIGHT") {
      this.flight.aircraft = info;
      this.flight.callsign = info.registration;
    }
  }

  /** Frames still in memory after `seq` (for quick back-fill), else from disk. */
  framesAfter(seq: number, limit = 2000): TelemetryFrame[] {
    const first = this.live[0];
    if (first && first.seq <= seq + 1) return this.live.filter((f) => f.seq > seq).slice(0, limit);
    if (!this.flight) return [];
    return this.recorder.framesSince(this.flight.id, seq, limit);
  }

  ingest(raw: RawFrame): void {
    const frame = this.aircraft ? applyProfile(raw as TelemetryFrame, profileForTitle(this.aircraft.title)) : (raw as TelemetryFrame);
    frame.seq = ++this.seq;

    if (!this.flight) this.startFlight(frame);
    else if (this.lastFrame === null) this.maybeResume(frame);
    const flight = this.flight!;

    const prev = this.lastFrame;
    const events = this.detector.update(frame);
    let discontinuity = false;
    for (const e of events) {
      if (e.type === "POSITION_DISCONTINUITY") discontinuity = true;
      this.applyEvent(flight, e, frame);
    }

    // Distance and maxima, skipping paused, slewed or teleported frames.
    if (prev && !discontinuity && !frame.sim.paused && !frame.sim.slew && this.detector.phase !== "PREFLIGHT") {
      flight.distanceNm += distanceNm(prev.position, frame.position);
    }
    if (this.detector.isAirborne && frame.position.altMslFt !== null) flight.maxAltitudeFt = Math.max(flight.maxAltitudeFt ?? 0, Math.round(frame.position.altMslFt));
    if (frame.speed.gsKt !== null) flight.maxGsKt = Math.max(flight.maxGsKt ?? 0, Math.round(frame.speed.gsKt));
    if (flight.fuelStartKg === null && frame.fuel.totalKg !== null) flight.fuelStartKg = Math.round(frame.fuel.totalKg);
    if (frame.fuel.totalKg !== null) flight.fuelEndKg = Math.round(frame.fuel.totalKg);
    flight.phase = this.detector.phase;
    flight.lastSeq = frame.seq;

    const report = this.analyzer.push(frame);
    if (report) this.onLanding(flight, report);

    if (events.length || this.shouldRecord(frame)) {
      this.recorder.saveFrame(flight.id, frame);
      this.lastRecordedT = frame.t;
    }
    this.live.push(frame);
    while (this.live.length && this.live[0]!.t < frame.t - LIVE_BUFFER_MS) this.live.shift();

    this.lastFrame = frame;
    this.emit("frame", frame, this.detector.phase);

    if (this.detector.phase === "COMPLETED") {
      this.finish("completed");
    } else if (events.length || frame.t - this.lastSavedT > 10_000) {
      // Persist and publish the summary on every event and at least every 10 s,
      // so clients always show current times, distance and phase.
      this.recorder.saveFlight(flight);
      this.lastSavedT = frame.t;
      this.emit("flight", flight);
    }
  }

  /** The simulator closed or returned to the menu. */
  endSession(): void {
    const landing = this.analyzer.flush();
    if (landing && this.flight) this.onLanding(this.flight, landing);
    if (!this.flight) return;
    if (!this.flight.offBlockAt && !this.flight.wheelsUpAt) {
      this.log.info(`Discarding flight ${this.flight.id}: the aircraft never left the gate`);
      this.recorder.deleteFlight(this.flight.id);
      this.flight = null;
    } else {
      this.recorder.saveFlight(this.flight);
      this.log.info(`Sim session ended during ${this.flight.phase}; flight ${this.flight.id} kept resumable for 30 min`);
    }
    this.lastFrame = null;
  }

  shutdown(): void {
    if (this.flight) this.recorder.saveFlight(this.flight);
    this.recorder.flush();
  }

  /* ---------------- internals ---------------- */

  private startFlight(frame: TelemetryFrame): void {
    const sim = this.simulator ?? { id: "unknown" as const, name: "Unknown simulator", version: null, source: "live" as const };
    this.flight = {
      id: randomUUID(),
      status: "active",
      simulator: sim,
      aircraft: this.aircraft,
      callsign: this.aircraft?.registration ?? null,
      departureIcao: null,
      arrivalIcao: null,
      phase: "PREFLIGHT",
      startedAt: frame.t,
      offBlockAt: null, wheelsUpAt: null, wheelsDownAt: null, onBlockAt: null, endedAt: null,
      distanceNm: 0, maxAltitudeFt: null, maxGsKt: null, fuelStartKg: null, fuelEndKg: null,
      landings: [],
      lastSeq: frame.seq,
    };
    this.detector = new PhaseDetector();
    this.analyzer = new LandingAnalyzer({ profile: landingProfileFor(this.aircraft?.icaoType ?? null, this.aircraft?.title ?? "") });
    this.recorder.saveFlight(this.flight);
    this.lastSavedT = frame.t;
    this.log.info(`New flight ${this.flight.id} (${sim.name}${sim.source === "replay" ? ", REPLAY" : ""})`);
    this.emit("flight", this.flight);
  }

  private maybeResume(frame: TelemetryFrame): void {
    const f = this.flight!;
    const last = this.recorder.lastFrame(f.id);
    const recent = frame.t - (last?.t ?? 0) < RESUME_WINDOW_MS;
    const near = last ? distanceNm(last.position, frame.position) < RESUME_RADIUS_NM : false;
    if (recent && near) {
      this.log.info(`Resuming flight ${f.id}`);
      this.detector = new PhaseDetector(); // re-joins mid-flight from the live frame
      return;
    }
    this.log.info(`Not resuming flight ${f.id} (${recent ? "moved too far" : "too long ago"}); marking it incomplete`);
    if (f.offBlockAt || f.wheelsUpAt) {
      f.status = "incomplete";
      f.endedAt = last?.t ?? f.startedAt;
      this.recorder.saveFlight(f);
      this.emit("flight", f);
    } else {
      this.recorder.deleteFlight(f.id);
    }
    this.flight = null;
    this.startFlight(frame);
  }

  private applyEvent(flight: FlightSummary, e: FlightEvent, frame: TelemetryFrame): void {
    this.recorder.saveEvent(flight.id, e);
    this.log.info(`${e.type} (${e.phaseBefore} → ${e.phaseAfter})`);
    switch (e.type) {
      case "OFF_BLOCK": flight.offBlockAt ??= e.t; break;
      case "WHEELS_UP": flight.wheelsUpAt ??= e.t; break;
      case "TOUCHDOWN": {
        flight.wheelsDownAt = e.t;
        const td = this.live.find((f) => f.seq === e.seq) ?? frame;
        this.analyzer.touchdown(td);
        break;
      }
      case "ON_BLOCK": flight.onBlockAt = e.t; break;
    }
    this.emit("event", e);
  }

  private onLanding(flight: FlightSummary, report: LandingReport): void {
    flight.landings.push(report);
    this.recorder.saveLanding(flight.id, report);
    this.log.info(`Landing graded ${report.grade} (${report.score}) — ${report.touchdownVsFpm ?? "?"} fpm, ${report.peakG ?? "?"} g`);
    this.emit("landing", report);
  }

  private finish(status: "completed" | "incomplete"): void {
    const f = this.flight!;
    const landing = this.analyzer.flush();
    if (landing) this.onLanding(f, landing);
    f.status = status;
    f.endedAt = this.lastFrame?.t ?? Date.now();
    this.recorder.saveFlight(f);
    this.recorder.flush();
    this.log.info(`Flight ${f.id} ${status}: ${f.distanceNm.toFixed(0)} nm, max FL${Math.round((f.maxAltitudeFt ?? 0) / 100)}`);
    this.emit("flight", f);
    this.flight = null;
    this.lastFrame = null;
  }

  private shouldRecord(f: TelemetryFrame): boolean {
    const p = this.detector.phase;
    const dt = f.t - this.lastRecordedT;
    const agl = f.position.altAglFt ?? 99999;
    if (p === "TAKEOFF" || p === "LANDING" || p === "APPROACH" || agl < 2500) return dt >= 250;
    if (p === "CRUISE" && Math.abs(f.speed.vsFpm ?? 0) < 300) return dt >= 5000;
    if (p === "PREFLIGHT" || p === "COMPLETED") return dt >= 10_000;
    if (p === "PUSHBACK" || p === "TAXI_OUT" || p === "TAXI_IN") return dt >= 1000;
    return dt >= 1000;
  }
}
