/**
 * Flight timings: the six airline milestones (OUT, OFF, top of climb, top of
 * descent, ON, IN), each with up to three times:
 *
 *   scheduled  from the SimBrief plan (real UTC)
 *   estimated  a live estimate, recomputed every frame (always labelled)
 *   actual     recorded by the Bridge when it happened
 *
 * plus block/air/taxi durations, countdowns and on-time status.
 *
 * Estimate rules (kept simple and explainable, every one is shown to users):
 *  - Before take-off: estimated OFF = off-block (or the later of now and the
 *    scheduled OUT) + planned taxi-out; estimated ON = estimated OFF + planned air time.
 *  - Airborne: estimated ON = now + distance to go at current groundspeed, with
 *    the last 30 nm flown at an approach average of 200 kt.
 *  - Estimated IN = estimated (or actual) ON + planned taxi-in (5 min without a plan).
 *  - Top of climb: altitude still to climb at the current climb rate.
 *  - Top of descent: from the top-of-descent calculator.
 * Times are Unix milliseconds. Durations are milliseconds.
 */

export type MilestoneId = "out" | "off" | "toc" | "tod" | "on" | "in";

export interface Milestone {
  id: MilestoneId;
  label: string;
  /** Airline shorthand shown in compact layouts. */
  short: string;
  scheduled: number | null;
  estimated: number | null;
  actual: number | null;
  state: "done" | "next" | "later";
  /** Minutes against schedule: actual if done, else estimate. + = late. */
  deltaMin: number | null;
  /** Which airport's local time applies ("origin" before take-off, "destination" after). */
  side: "origin" | "destination";
}

export interface TimingStatus {
  deltaMin: number;
  label: string;
  tone: "on-time" | "early" | "late";
}

export interface FlightTimings {
  milestones: Milestone[];
  departure: TimingStatus | null;
  arrival: TimingStatus | null;
  /** Off-block → on-block (or → now while flying). */
  blockMs: number | null;
  /** Wheels-up → wheels-down (or → now while airborne). */
  airMs: number | null;
  taxiOutMs: number | null;
  taxiInMs: number | null;
  planned: { blockMs: number | null; airMs: number | null; taxiOutMs: number | null; taxiInMs: number | null };
  /** Countdowns from now; null when not applicable. */
  toTakeoffMs: number | null;
  toTopOfClimbMs: number | null;
  toTopOfDescentMs: number | null;
  toLandingMs: number | null;
  toGateMs: number | null;
  /** Plain-language description of how the arrival estimate was made. */
  basis: string | null;
}

export interface TimingsInput {
  now: number;
  airborne: boolean;
  completed: boolean;
  groundSpeedKt: number | null;
  altitudeFt: number | null;
  verticalSpeedFpm: number | null;
  /** Distance still to fly along the route to the destination (nm). */
  toGoNm: number | null;
  /** Minutes to top of descent from the ToD calculator (null if past/unknown). */
  minutesToTod: number | null;
  cruiseAltitudeFt: number | null;
  actual: { offBlock: number | null; wheelsUp: number | null; topOfClimb: number | null; topOfDescent: number | null; wheelsDown: number | null; onBlock: number | null };
  /** Simulation rate (1 = real time). Estimates are shown in real (wall-clock) time. */
  simRate?: number | null;
  /** Scheduled times from the plan, Unix SECONDS (SimBrief's unit). */
  plan: { out: number | null; off: number | null; on: number | null; in: number | null; airTimeS: number | null } | null;
}

const MIN = 60_000;
const DEFAULT_TAXI_IN = 5 * MIN;
const DEFAULT_TAXI_OUT = 12 * MIN;

export function statusFor(deltaMin: number | null, toleranceMin = 2): TimingStatus | null {
  if (deltaMin === null || !Number.isFinite(deltaMin)) return null;
  const d = Math.round(deltaMin);
  if (Math.abs(d) <= toleranceMin) return { deltaMin: d, label: "On time", tone: "on-time" };
  return d < 0 ? { deltaMin: d, label: `${fmtMinutes(-d)} early`, tone: "early" } : { deltaMin: d, label: `${fmtMinutes(d)} late`, tone: "late" };
}

function fmtMinutes(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}

/** Air time for a distance at a groundspeed, flying the last 30 nm at an approach average of 200 kt. */
export function timeToFlyMs(toGoNm: number, gsKt: number): number {
  const gs = Math.max(gsKt, 120);
  const approach = Math.min(toGoNm, 30);
  const cruise = Math.max(0, toGoNm - 30);
  return (cruise / gs + approach / Math.min(gs, 200)) * 3_600_000;
}

export function computeTimings(i: TimingsInput): FlightTimings {
  const s = (v: number | null | undefined) => (v === null || v === undefined ? null : v * 1000);
  const sched = { out: s(i.plan?.out), off: s(i.plan?.off), on: s(i.plan?.on), in: s(i.plan?.in) };
  const a = i.actual;
  const rate = i.simRate && Number.isFinite(i.simRate) && i.simRate > 0 ? Math.min(128, Math.max(0.25, i.simRate)) : 1;
  const rateNote = rate !== 1 ? ` (sim rate ${rate}x, shown in real time)` : "";

  const plannedTaxiOut = sched.out !== null && sched.off !== null ? sched.off - sched.out : null;
  const plannedTaxiIn = sched.on !== null && sched.in !== null ? sched.in - sched.on : null;
  const plannedAir = i.plan?.airTimeS ? i.plan.airTimeS * 1000 : sched.off !== null && sched.on !== null ? sched.on - sched.off : null;
  const plannedBlock = sched.out !== null && sched.in !== null ? sched.in - sched.out : null;

  // --- estimates ---
  let estOut: number | null = null;
  let estOff: number | null = null;
  let estOn: number | null = null;
  let basis: string | null = null;

  if (a.offBlock === null && !i.completed) estOut = sched.out !== null ? Math.max(i.now, sched.out) : null;
  if (a.wheelsUp === null && !i.completed) {
    const fromOut = a.offBlock ?? estOut;
    if (fromOut !== null) estOff = Math.max(i.now, fromOut + (plannedTaxiOut ?? DEFAULT_TAXI_OUT));
  }
  if (a.wheelsDown === null && !i.completed) {
    if (i.airborne && i.toGoNm !== null && (i.groundSpeedKt ?? 0) > 60) {
      estOn = i.now + timeToFlyMs(i.toGoNm, i.groundSpeedKt!) / rate;
      basis = `${Math.round(i.toGoNm)} nm to go at ${Math.round(i.groundSpeedKt!)} kt, last 30 nm at approach speed${rateNote}`;
    } else if (!i.airborne && estOff !== null && plannedAir !== null) {
      estOn = estOff + plannedAir;
      basis = "planned air time from the estimated take-off";
    } else if (i.airborne && a.wheelsUp !== null && plannedAir !== null) {
      estOn = a.wheelsUp + plannedAir;
      basis = "planned air time from take-off";
    }
  }
  let estIn: number | null = null;
  if (a.onBlock === null && !i.completed) {
    const on = a.wheelsDown ?? estOn;
    if (on !== null) estIn = Math.max(i.now, on + (plannedTaxiIn ?? DEFAULT_TAXI_IN));
    if (a.wheelsDown !== null) basis = `landed; ${plannedTaxiIn ? "planned" : "typical"} taxi-in of ${Math.round((plannedTaxiIn ?? DEFAULT_TAXI_IN) / MIN)} min`;
  }

  let estToc: number | null = null;
  if (a.topOfClimb === null && i.airborne && i.cruiseAltitudeFt !== null && i.altitudeFt !== null && (i.verticalSpeedFpm ?? 0) > 300) {
    const left = i.cruiseAltitudeFt - i.altitudeFt;
    if (left > 0) estToc = i.now + ((left / i.verticalSpeedFpm!) * MIN) / rate;
  }
  let estTod: number | null = null;
  if (a.topOfDescent === null && i.airborne && i.minutesToTod !== null && i.minutesToTod > 0) estTod = i.now + (i.minutesToTod * MIN) / rate;
  // Descent has begun but is not yet confirmed (the phase detector waits 30 s): it is happening now.
  if (a.topOfDescent === null && estTod === null && i.airborne && a.wheelsUp !== null && (i.verticalSpeedFpm ?? 0) < -500 && (i.altitudeFt ?? 0) > 8000) estTod = i.now;

  // --- milestones ---
  const rows: Array<Omit<Milestone, "state" | "deltaMin">> = [
    { id: "out", label: "Off block", short: "OUT", scheduled: sched.out, estimated: estOut, actual: a.offBlock, side: "origin" },
    { id: "off", label: "Take-off", short: "OFF", scheduled: sched.off, estimated: estOff, actual: a.wheelsUp, side: "origin" },
    { id: "toc", label: "Top of climb", short: "TOC", scheduled: null, estimated: estToc, actual: a.topOfClimb, side: "origin" },
    { id: "tod", label: "Top of descent", short: "TOD", scheduled: null, estimated: estTod, actual: a.topOfDescent, side: "destination" },
    { id: "on", label: "Landing", short: "ON", scheduled: sched.on, estimated: estOn, actual: a.wheelsDown, side: "destination" },
    { id: "in", label: "On block", short: "IN", scheduled: sched.in, estimated: estIn, actual: a.onBlock, side: "destination" },
  ];
  // A later milestone that happened means earlier ones are done even if skipped (e.g. joined mid-flight).
  const lastDone = rows.reduce((idx, r, k) => (r.actual !== null ? k : idx), -1);
  let nextAssigned = false;
  const milestones: Milestone[] = rows.map((r, k) => {
    const done = r.actual !== null || k < lastDone || i.completed;
    let state: Milestone["state"] = done ? "done" : "later";
    if (!done && !nextAssigned) {
      state = "next";
      nextAssigned = true;
    }
    const ref = r.actual ?? r.estimated;
    const deltaMin = r.scheduled !== null && ref !== null ? Math.round((ref - r.scheduled) / MIN) : null;
    return { ...r, state, deltaMin };
  });

  const outM = milestones[0]!;
  const inM = milestones[5]!;
  const departure = statusFor(outM.deltaMin);
  const arrival = statusFor(inM.deltaMin);

  const until = (t: number | null) => (t === null ? null : Math.max(0, t - i.now));
  return {
    milestones,
    departure,
    arrival,
    blockMs: a.offBlock !== null ? (a.onBlock ?? i.now) - a.offBlock : null,
    airMs: a.wheelsUp !== null ? (a.wheelsDown ?? i.now) - a.wheelsUp : null,
    taxiOutMs: a.offBlock === null ? null : a.wheelsUp !== null ? a.wheelsUp - a.offBlock : i.airborne ? null : i.now - a.offBlock,
    taxiInMs: a.wheelsDown !== null ? (a.onBlock ?? i.now) - a.wheelsDown : null,
    planned: { blockMs: plannedBlock, airMs: plannedAir, taxiOutMs: plannedTaxiOut, taxiInMs: plannedTaxiIn },
    toTakeoffMs: a.wheelsUp === null ? until(estOff) : null,
    toTopOfClimbMs: until(estToc),
    toTopOfDescentMs: until(estTod),
    toLandingMs: a.wheelsDown === null ? until(estOn) : null,
    toGateMs: a.onBlock === null ? until(estIn) : null,
    basis,
  };
}

/** Clock time at a fixed UTC offset (hours), e.g. 14:42. */
export function clockAt(ms: number, utcOffsetH: number | null): string | null {
  if (utcOffsetH === null || !Number.isFinite(utcOffsetH)) return null;
  const d = new Date(ms + utcOffsetH * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
