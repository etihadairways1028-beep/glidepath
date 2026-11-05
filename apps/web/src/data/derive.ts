/**
 * Values derived from telemetry + the plan. Everything here is either a
 * direct reading or a clearly-labelled estimate (`estimate: true`).
 */
import { useMemo } from "react";
import type { FlightEvent, FlightPhase, FlightPlan, FlightSummary, TelemetryFrame } from "@glidepath/protocol";
import { clockAt, computeTimings, computeTopOfDescent, distanceNm, routeProgress, type FlightTimings, type LatLon, type TodResult } from "@glidepath/flight-engine";
import { useApp } from "./store";

export interface Live {
  frame: TelemetryFrame | null;
  flight: FlightSummary | null;
  phase: FlightPhase;
  plan: FlightPlan | null;
  isDemo: boolean;
  airborne: boolean;
  flownNm: number;
  toGoNm: number | null;
  progress: number; // 0..1
  /** Estimated landing time (ms), from distance to go and current groundspeed. */
  etaLanding: number | null;
  /** Estimated on-block time (ms) = landing + planned taxi-in (or 5 min). */
  etaOnBlock: number | null;
  /** Minutes early (−) or late (+) against the plan's scheduled in-time. */
  scheduleDeltaMin: number | null;
  tod: (TodResult & { targetLabel: string }) | null;
  fuelAtDestinationKg: number | null;
  destination: (LatLon & { icao: string; name: string | null; elevationFt: number | null }) | null;
  completed: boolean;
  /** Every scheduled / estimated / actual time for the flight. */
  timings: FlightTimings | null;
}

export function useLive(): Live {
  const frame = useApp((s) => s.frame);
  const flight = useApp((s) => s.lastFlight ?? s.flight);
  const phase = useApp((s) => s.phase);
  const mode = useApp((s) => s.mode);
  const events = useApp((s) => s.events);
  return useMemo(() => derive(frame, flight, phase, mode === "demo", events), [frame, flight, phase, mode, events]);
}

/** Times of the first event of a type (top of climb / descent are not on the flight summary). */
export function eventTime(events: FlightEvent[], type: FlightEvent["type"]): number | null {
  return events.find((e) => e.type === type)?.t ?? null;
}

/** Timings for any flight, live or finished. `now` is the latest frame time (or end of flight). */
export function timingsFor(flight: FlightSummary, events: FlightEvent[], frame: TelemetryFrame | null, extra: { toGoNm: number | null; minutesToTod: number | null; now: number }): FlightTimings {
  const p = flight.plan;
  return computeTimings({
    now: extra.now,
    airborne: !!frame && !frame.position.onGround && flight.status !== "completed",
    completed: flight.status === "completed",
    groundSpeedKt: frame?.speed.gsKt ?? null,
    altitudeFt: frame?.position.altMslFt ?? null,
    verticalSpeedFpm: frame?.speed.vsFpm ?? null,
    toGoNm: extra.toGoNm,
    minutesToTod: extra.minutesToTod,
    cruiseAltitudeFt: p?.cruiseAltitudeFt ?? null,
    actual: {
      offBlock: flight.offBlockAt, wheelsUp: flight.wheelsUpAt, topOfClimb: eventTime(events, "TOP_OF_CLIMB"),
      topOfDescent: eventTime(events, "TOP_OF_DESCENT"), wheelsDown: flight.wheelsDownAt, onBlock: flight.onBlockAt,
    },
    plan: p ? { out: p.scheduledOut, off: p.scheduledOff, on: p.scheduledOn, in: p.scheduledIn, airTimeS: p.airTimeS } : null,
  });
}

/** Local clock time at the departure or arrival airport, when the plan gives its UTC offset. */
export function localAt(ms: number | null, plan: FlightPlan | null, side: "origin" | "destination"): string | null {
  if (!ms || !plan) return null;
  return clockAt(ms, side === "origin" ? plan.originUtcOffsetH : plan.destinationUtcOffsetH);
}

export function derive(frame: TelemetryFrame | null, flight: FlightSummary | null, phase: FlightPhase, isDemo: boolean, events: FlightEvent[] = []): Live {
  const plan = flight?.plan ?? null;
  const completed = flight?.status === "completed";
  const dest = plan
    ? { lat: plan.destination.lat, lon: plan.destination.lon, icao: plan.destination.icao, name: plan.destination.name, elevationFt: plan.destination.elevationFt }
    : null;
  const flownNm = flight?.distanceNm ?? 0;
  const airborne = !!frame && !frame.position.onGround;
  const base: Live = {
    frame, flight, phase, plan, isDemo, airborne, flownNm, toGoNm: null, progress: completed ? 1 : 0, etaLanding: null, etaOnBlock: null,
    scheduleDeltaMin: null, tod: null, fuelAtDestinationKg: null, destination: dest, completed, timings: null,
  };
  if (flight && (completed || !frame)) {
    base.timings = timingsFor(flight, events, frame, { toGoNm: null, minutesToTod: null, now: flight.endedAt ?? frame?.t ?? Date.now() });
  }
  if (!frame || completed) return base;

  let toGo: number | null = null;
  if (plan && dest) {
    const route: LatLon[] = [{ lat: plan.origin.lat, lon: plan.origin.lon }, ...plan.fixes, dest];
    toGo = routeProgress(route, frame.position)?.distanceRemainingNm ?? distanceNm(frame.position, dest);
  } else if (dest) {
    toGo = distanceNm(frame.position, dest);
  }
  base.toGoNm = toGo;
  if (toGo !== null) base.progress = Math.max(0, Math.min(1, flownNm / Math.max(1, flownNm + toGo)));

  const gs = frame.speed.gsKt ?? 0;
  if (toGo !== null && airborne && gs > 60) {
    const flow = frame.fuel.totalFlowKgH;
    if (frame.fuel.totalKg !== null && flow !== null) base.fuelAtDestinationKg = Math.round(frame.fuel.totalKg - flow * (toGo / gs));
  }

  if (dest && toGo !== null && airborne && (phase === "CLIMB" || phase === "CRUISE") && frame.position.altMslFt !== null) {
    const elev = dest.elevationFt ?? 0;
    const target = { distanceNm: Math.max(0, toGo - 10), altitudeFt: elev + 3000 };
    const r = computeTopOfDescent({
      currentAltitudeFt: frame.position.altMslFt, groundSpeedKt: gs, trueAirspeedKt: frame.speed.tasKt,
      descentHeadwindKt: frame.speed.tasKt !== null ? frame.speed.tasKt - gs : null, target,
    });
    base.tod = { ...r, targetLabel: `${(elev + 3000).toLocaleString("en-US")} ft, 10 nm before ${dest.icao}` };
  }
  if (flight) {
    const t = timingsFor(flight, events, frame, { toGoNm: toGo, minutesToTod: base.tod && !base.tod.pastTod ? base.tod.minutesToTod : null, now: frame.t });
    base.timings = t;
    base.etaLanding = t.milestones[4]!.actual ?? t.milestones[4]!.estimated;
    base.etaOnBlock = t.milestones[5]!.actual ?? t.milestones[5]!.estimated;
    base.scheduleDeltaMin = t.arrival?.deltaMin ?? null;
  }
  return base;
}

/* ---------------- formatting ---------------- */

export const fmt = (v: number | null | undefined, dp = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

export function zulu(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

export function dur(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const m = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Countdown wording: "under 1 min", "12 min", "1h 05m". */
export function countdown(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (ms < 60_000) return "under 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export const PHASE_LABEL: Record<FlightPhase, string> = {
  PREFLIGHT: "At the gate", PUSHBACK: "Pushback", TAXI_OUT: "Taxiing out", TAKEOFF: "Takeoff", CLIMB: "Climbing", CRUISE: "Cruising",
  DESCENT: "Descending", APPROACH: "On approach", LANDING: "Landing", TAXI_IN: "Taxiing in", COMPLETED: "On blocks",
};

export const EVENT_LABEL: Record<string, string> = {
  OFF_BLOCK: "Off block", PUSHBACK_START: "Pushback", TAXI_START: "Taxi out", TAKEOFF_ROLL: "Takeoff roll", WHEELS_UP: "Wheels up",
  TOP_OF_CLIMB: "Top of climb", TOP_OF_DESCENT: "Top of descent", APPROACH_START: "Approach", GO_AROUND: "Go-around", TOUCHDOWN: "Touchdown",
  TOUCH_AND_GO: "Touch-and-go", RUNWAY_EXIT: "Off the runway", ON_BLOCK: "On block", ENGINES_OFF: "Engines off",
  POSITION_DISCONTINUITY: "Position jump", SIM_PAUSED: "Sim paused", SIM_RESUMED: "Sim resumed",
};

export function fuel(kg: number | null | undefined, unit: "kg" | "lb"): string {
  if (kg === null || kg === undefined) return "—";
  return unit === "lb" ? `${fmt(kg / 0.45359237)} lb` : `${fmt(kg)} kg`;
}
