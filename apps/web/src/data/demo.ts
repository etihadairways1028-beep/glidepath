/**
 * Demo mode: replays the SYNTHETIC test flight (not real data) through the
 * real flight engine, in the browser. Everything the app shows in demo mode
 * is badged DEMO.
 */
import type { FlightEvent, FlightSummary, TelemetryFrame } from "@glidepath/protocol";
import { distanceNm, FlightReviewer, LandingAnalyzer, landingProfileFor, matchRunway, PhaseDetector } from "@glidepath/flight-engine";
import { loadAirportDb } from "./airports";
import { pushTrail, store } from "./store";

export class DemoClient {
  private frames: TelemetryFrame[] = [];
  private timer: number | null = null;
  private idx = 0;
  private simT = 0;
  private detector = new PhaseDetector();
  private analyzer = new LandingAnalyzer({ profile: landingProfileFor("A320") });
  private reviewer = new FlightReviewer(landingProfileFor("A320").id);
  private flight!: FlightSummary;
  private prev: TelemetryFrame | null = null;
  private wallBase = 0;

  async start(): Promise<void> {
    store.reset("demo");
    store.set({ conn: "connecting" });
    const [data, db] = await Promise.all([fetch("data/demo-flight.json").then((r) => r.json()), loadAirportDb()]);
    this.frames = data.frames;
    this.wallBase = Date.now() - (this.frames[0]!.t - this.frames[0]!.t);
    const dep = db.nearest(this.frames[0]!.position, { maxNm: 5 });
    this.analyzer.setRunways(dep ? db.runwayEnds(dep.code) : []);
    this.flight = {
      id: "00000000-0000-4000-8000-000000000000", status: "active",
      simulator: { id: "replay", name: "Demo: synthetic test flight", version: null, source: "replay" },
      aircraft: { title: data.aircraft.title, icaoType: data.aircraft.icaoType, registration: "G-DEMO", airline: null, engineCount: 2, profileId: "generic" },
      callsign: "GPD1", departureIcao: dep?.code ?? null, arrivalIcao: null, departureName: dep?.name ?? null, arrivalName: null,
      departureRunway: null, arrivalRunway: null, departureStand: null, arrivalStand: null,
      plan: demoPlan(this.frames, db),
      phase: "PREFLIGHT", startedAt: this.frames[0]!.t, offBlockAt: null, wheelsUpAt: null, wheelsDownAt: null, onBlockAt: null, endedAt: null,
      distanceNm: 0, maxAltitudeFt: null, maxGsKt: null, fuelStartKg: null, fuelEndKg: null, landings: [], takeoff: null, stats: null, lastSeq: 0,
    };
    this.flight.arrivalIcao = this.flight.plan!.destination.icao;
    this.flight.arrivalName = this.flight.plan!.destination.name;
    this.detector.setOptions({ plannedCruiseFt: this.flight.plan!.cruiseAltitudeFt, destination: { lat: this.flight.plan!.destination.lat, lon: this.flight.plan!.destination.lon } });
    store.set({
      conn: "live", flight: { ...this.flight },
      status: { bridgeVersion: "demo", protocolVersion: 1, bridgeId: "demo", hostname: "Your browser", simState: "connected", simulator: this.flight.simulator, aircraft: this.flight.aircraft, lastFrameAt: null, framesPerSecond: 0, clients: 1, activeFlightId: this.flight.id, message: "Demo flight" },
    });
    this.simT = this.frames[0]!.t;
    this.tick(db);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Jump to a fraction of the flight (re-runs the engine from the start so every event is correct). */
  seek(fraction: number): void {
    const target = this.frames[0]!.t + fraction * (this.frames.at(-1)!.t - this.frames[0]!.t);
    if (target < this.simT) return; // forward only; restart demo to go back
    this.simT = target;
  }

  private tick(db: Awaited<ReturnType<typeof loadAirportDb>>): void {
    const step = 100;
    const speed = store.get().demoSpeed;
    this.simT += step * speed;
    const newEvents: FlightEvent[] = [];
    let last: TelemetryFrame | null = null;
    while (this.idx < this.frames.length && this.frames[this.idx]!.t <= this.simT) {
      const f = this.frames[this.idx++]!;
      last = f;
      const evs = this.detector.update(f);
      for (const e of evs) {
        newEvents.push(e);
        this.applyEvent(e, f, db);
      }
      this.reviewer.push(f, this.detector.phase, evs);
      this.flight.stats = { ...this.reviewer.stats };
      if (this.reviewer.takeoff) this.flight.takeoff = this.reviewer.takeoff;
      if (this.prev && this.detector.phase !== "PREFLIGHT") this.flight.distanceNm += distanceNm(this.prev.position, f.position);
      if (!f.position.onGround && f.position.altMslFt !== null) this.flight.maxAltitudeFt = Math.max(this.flight.maxAltitudeFt ?? 0, Math.round(f.position.altMslFt));
      this.flight.maxGsKt = Math.max(this.flight.maxGsKt ?? 0, Math.round(f.speed.gsKt ?? 0));
      this.flight.fuelStartKg ??= f.fuel.totalKg === null ? null : Math.round(f.fuel.totalKg);
      if (f.fuel.totalKg !== null) this.flight.fuelEndKg = Math.round(f.fuel.totalKg);
      this.flight.phase = this.detector.phase;
      const r = this.analyzer.push(f);
      if (r) {
        this.flight.landings = [r];
        store.set({ landing: r });
      }
      this.prev = f;
      store.set((s) => ({ trail: pushTrail(s.trail, f) }));
    }
    if (last) {
      const shown = { ...last, t: last.t };
      if (this.detector.phase === "COMPLETED" && this.flight.status !== "completed") {
        const fl = this.analyzer.flush();
        if (fl) { this.flight.landings = [fl]; store.set({ landing: fl }); }
        this.flight.status = "completed";
        this.flight.endedAt = last.t;
      }
      store.set((s) => ({ frame: shown, phase: this.detector.phase, flight: { ...this.flight }, lastFlight: this.flight.status === "completed" ? { ...this.flight } : null, events: newEvents.length ? [...s.events, ...newEvents] : s.events, lastFrameAt: Date.now() }));
    }
    if (this.idx >= this.frames.length) return;
    this.timer = window.setTimeout(() => this.tick(db), step);
  }

  private applyEvent(e: FlightEvent, f: TelemetryFrame, db: Awaited<ReturnType<typeof loadAirportDb>>): void {
    const fl = this.flight;
    if (e.type === "OFF_BLOCK") fl.offBlockAt = e.t;
    if (e.type === "WHEELS_UP") {
      fl.wheelsUpAt = e.t;
      if (fl.departureIcao) fl.departureRunway = matchRunway(db.runwayEnds(fl.departureIcao), f.position, f.attitude.headingTrueDeg)?.ident ?? null;
    }
    if (e.type === "TOUCHDOWN") {
      fl.wheelsDownAt = e.t;
      const apt = db.nearest(f.position, { maxNm: 6 });
      if (apt) {
        fl.arrivalIcao = apt.code;
        fl.arrivalName = apt.name;
        const ends = db.runwayEnds(apt.code);
        this.analyzer.setRunways(ends);
        fl.arrivalRunway = matchRunway(ends, f.position, f.attitude.headingTrueDeg)?.ident ?? null;
      }
      this.analyzer.touchdown(f);
    }
    if (e.type === "ON_BLOCK") fl.onBlockAt = e.t;
  }
}

/** A plan for the demo built from the synthetic flight itself (labelled as such in the UI). */
function demoPlan(frames: TelemetryFrame[], db: Awaited<ReturnType<typeof loadAirportDb>>) {
  const o = db.get("EGLL")!;
  const d = db.get("EGCC")!;
  const start = frames[0]!.t / 1000;
  const airborne = frames.filter((f) => !f.position.onGround);
  const fixes = airborne.filter((_, i) => i % 40 === 0).map((f, i) => ({ ident: `WP${i + 1}`, lat: f.position.lat, lon: f.position.lon, altitudeFt: Math.round((f.position.altMslFt ?? 0) / 100) * 100 }));
  return {
    source: "simbrief" as const, ofpId: null, callsign: "GPD1", flightNumber: "1", airline: null, aircraftIcao: "A320", registration: "G-DEMO",
    origin: { icao: o.code, name: o.name, runway: "27R", lat: o.lat, lon: o.lon, elevationFt: o.elevationFt },
    destination: { icao: d.code, name: d.name, runway: "23R", lat: d.lat, lon: d.lon, elevationFt: d.elevationFt },
    alternate: "EGNM", route: "Demo route (synthetic)", fixes, cruiseAltitudeFt: 24000, distanceNm: 154,
    scheduledOut: Math.round(start + 60), scheduledOff: Math.round(start + 420), scheduledOn: Math.round(start + 2160), scheduledIn: Math.round(start + 2400),
    blockTimeS: 2340, airTimeS: 1740, originUtcOffsetH: 0, destinationUtcOffsetH: 0, fuelUnits: "kg" as const, fuelRampKg: 6200, fuelBurnKg: 950, fuelLandingKg: 5250, fetchedAt: Date.now(),
  };
}

let active: DemoClient | null = null;
export function startDemo(): DemoClient {
  active?.stop();
  active = new DemoClient();
  void active.start();
  return active;
}
export function stopDemo(): void {
  active?.stop();
  active = null;
}
export function activeDemo(): DemoClient | null {
  return active;
}
