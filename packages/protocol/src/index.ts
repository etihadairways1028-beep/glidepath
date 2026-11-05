/**
 * @glidepath/protocol
 *
 * The single source of truth for every message that moves between the
 * Bridge (simulator PC), the Glidepath app and the cloud.
 *
 * Rules:
 *  - Every live value is `number | null`. `null` means "the simulator or the
 *    aircraft does not expose this". It must never be replaced by 0.
 *  - Units are in the field name (Ft, Kt, Fpm, Kg, C, Hpa, Mhz, Deg).
 *  - The protocol is versioned. Breaking changes bump PROTOCOL_VERSION.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const num = z.number().finite().nullable();
const bool = z.boolean().nullable();

/* ------------------------------------------------------------------ */
/* Simulator + aircraft identity                                       */
/* ------------------------------------------------------------------ */

export const SimulatorId = z.enum(["msfs2020", "msfs2024", "xplane11", "xplane12", "replay", "unknown"]);
export type SimulatorId = z.infer<typeof SimulatorId>;

/** Where the data comes from. Anything other than "live" must be badged in the UI. */
export const DataSource = z.enum(["live", "replay"]);
export type DataSource = z.infer<typeof DataSource>;

export const SimulatorInfo = z.object({
  id: SimulatorId,
  name: z.string(),
  version: z.string().nullable(),
  source: DataSource,
});
export type SimulatorInfo = z.infer<typeof SimulatorInfo>;

export const AircraftInfo = z.object({
  /** Raw title string from the simulator, e.g. "FenixA320 - Speedbird". */
  title: z.string(),
  /** ICAO type designator if the sim exposes it, e.g. "A320". */
  icaoType: z.string().nullable(),
  /** Registration / ATC ID if exposed. */
  registration: z.string().nullable(),
  /** Airline / ATC airline string if exposed. */
  airline: z.string().nullable(),
  engineCount: z.number().int().min(0).max(8).nullable(),
  /** Aircraft profile id chosen by the Bridge, e.g. "generic-jet", "fenix-a320". */
  profileId: z.string(),
});
export type AircraftInfo = z.infer<typeof AircraftInfo>;

/* ------------------------------------------------------------------ */
/* Telemetry frame                                                     */
/* ------------------------------------------------------------------ */

export const EngineFrame = z.object({
  running: bool,
  n1Pct: num,
  n2Pct: num,
  egtC: num,
  fuelFlowKgH: num,
});
export type EngineFrame = z.infer<typeof EngineFrame>;

export const TelemetryFrame = z.object({
  /** Monotonic sequence number assigned by the Bridge. Used for back-fill. */
  seq: z.number().int().nonnegative(),
  /** Wall-clock time on the sim PC (Unix ms). */
  t: z.number().int(),

  position: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    altMslFt: num,
    altAglFt: num,
    onGround: z.boolean(),
  }),
  attitude: z.object({
    /** Positive = nose up. */
    pitchDeg: num,
    /** Positive = right wing down. */
    bankDeg: num,
    headingTrueDeg: num,
    headingMagDeg: num,
  }),
  speed: z.object({
    iasKt: num,
    tasKt: num,
    gsKt: num,
    mach: num,
    vsFpm: num,
  }),
  environment: z.object({
    windDirDeg: num,
    windKt: num,
    oatC: num,
    qnhHpa: num,
  }),
  loads: z.object({
    gForce: num,
    /** Touchdown sink rate as reported by the simulator itself (MSFS: PLANE TOUCHDOWN NORMAL VELOCITY). */
    touchdownVsFpm: num,
  }),
  engines: z.array(EngineFrame).max(8),
  fuel: z.object({
    totalKg: num,
    totalFlowKgH: num,
  }),
  controls: z.object({
    gearDown: bool,
    flapsIndex: num,
    flapsPct: num,
    spoilersPct: num,
    parkingBrake: bool,
    pushbackActive: bool,
  }),
  autopilot: z.object({
    master: bool,
    flightDirector: bool,
    headingHold: bool,
    selectedHeadingDeg: num,
    selectedAltitudeFt: num,
    selectedVsFpm: num,
    selectedSpeedKt: num,
    selectedMach: num,
    navHold: bool,
    approachHold: bool,
    autothrottle: bool,
  }),
  lights: z.object({
    nav: bool,
    beacon: bool,
    strobe: bool,
    landing: bool,
    taxi: bool,
    logo: bool,
    wing: bool,
  }),
  electrical: z.object({
    battery: bool,
    externalPower: bool,
    apuRpmPct: num,
  }),
  radios: z.object({
    com1ActiveMhz: num,
    com1StandbyMhz: num,
    com2ActiveMhz: num,
    com2StandbyMhz: num,
    nav1ActiveMhz: num,
    nav1StandbyMhz: num,
    nav2ActiveMhz: num,
    nav2StandbyMhz: num,
  }),
  sim: z.object({
    paused: z.boolean(),
    simRate: num,
    slew: bool,
  }),
});
export type TelemetryFrame = z.infer<typeof TelemetryFrame>;

/* ------------------------------------------------------------------ */
/* Flight phases + events                                              */
/* ------------------------------------------------------------------ */

export const FlightPhase = z.enum([
  "PREFLIGHT",
  "PUSHBACK",
  "TAXI_OUT",
  "TAKEOFF",
  "CLIMB",
  "CRUISE",
  "DESCENT",
  "APPROACH",
  "LANDING",
  "TAXI_IN",
  "COMPLETED",
]);
export type FlightPhase = z.infer<typeof FlightPhase>;

export const FlightEventType = z.enum([
  "OFF_BLOCK",
  "PUSHBACK_START",
  "TAXI_START",
  "TAKEOFF_ROLL",
  "WHEELS_UP",
  "TOP_OF_CLIMB",
  "TOP_OF_DESCENT",
  "APPROACH_START",
  "GO_AROUND",
  "TOUCHDOWN",
  "TOUCH_AND_GO",
  "RUNWAY_EXIT",
  "ON_BLOCK",
  "ENGINES_OFF",
  "POSITION_DISCONTINUITY",
  "SIM_PAUSED",
  "SIM_RESUMED",
]);
export type FlightEventType = z.infer<typeof FlightEventType>;

export const FlightEvent = z.object({
  type: FlightEventType,
  t: z.number().int(),
  seq: z.number().int().nonnegative(),
  lat: z.number(),
  lon: z.number(),
  altMslFt: num,
  phaseBefore: FlightPhase,
  phaseAfter: FlightPhase,
  detail: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type FlightEvent = z.infer<typeof FlightEvent>;

/* ------------------------------------------------------------------ */
/* Landing report                                                      */
/* ------------------------------------------------------------------ */

export const LandingComponent = z.object({
  id: z.enum(["sinkRate", "gLoad", "bounce", "bank", "pitch", "centreline", "touchdownZone"]),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string(),
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().min(0),
  note: z.string(),
});
export type LandingComponent = z.infer<typeof LandingComponent>;

export const LandingReport = z.object({
  t: z.number().int(),
  lat: z.number(),
  lon: z.number(),
  touchdownVsFpm: z.number().nullable(),
  touchdownVsSource: z.enum(["simulator", "derived"]),
  peakG: z.number().nullable(),
  iasKt: z.number().nullable(),
  gsKt: z.number().nullable(),
  pitchDeg: z.number().nullable(),
  bankDeg: z.number().nullable(),
  bounces: z.number().int().nonnegative(),
  flareSeconds: z.number().nullable(),
  crosswindKt: z.number().nullable(),
  headwindKt: z.number().nullable(),
  runway: z
    .object({
      ident: z.string(),
      distanceFromThresholdFt: z.number(),
      centrelineOffsetFt: z.number(),
    })
    .nullable(),
  profileId: z.string(),
  components: z.array(LandingComponent),
  /** 0-100, from the components that had data, weights renormalised. */
  score: z.number().min(0).max(100),
  grade: z.enum(["A+", "A", "B", "C", "D", "F"]),
  verdict: z.string(),
});
export type LandingReport = z.infer<typeof LandingReport>;


/* ------------------------------------------------------------------ */
/* Takeoff report and whole-flight stats (for the debrief)             */
/* ------------------------------------------------------------------ */

export const ReviewNote = z.object({
  level: z.enum(["good", "ok", "improve"]),
  text: z.string(),
});
export type ReviewNote = z.infer<typeof ReviewNote>;

export const TakeoffReport = z.object({
  t: z.number().int(),
  profileId: z.string(),
  /** IAS when the nose started coming up. */
  rotateIasKt: num,
  liftoffIasKt: num,
  liftoffPitchDeg: num,
  /** Average pitch rate from rotation to lift-off (deg/s). */
  rotationRateDegS: num,
  /** Highest pitch between lift-off and 1,500 ft above the runway. */
  maxPitchDeg: num,
  avgClimbPitchDeg: num,
  /** Average climb rate from 35 ft to 1,000 ft above the runway. */
  initialClimbFpm: num,
  maxBankDeg: num,
  groundRollFt: num,
  /** Seconds from lift-off to gear up, when the aircraft reports gear. */
  gearUpS: num,
  peakG: num,
  tailStrikePitchDeg: z.number(),
  score: z.number().min(0).max(100),
  grade: z.enum(["A+", "A", "B", "C", "D", "F"]),
  verdict: z.string(),
  notes: z.array(ReviewNote),
});
export type TakeoffReport = z.infer<typeof TakeoffReport>;

export const ApproachGate = z.object({
  heightFt: z.number(),
  iasKt: num,
  vsFpm: num,
  gearDown: bool,
  flapsPct: num,
  bankDeg: num,
});
export type ApproachGate = z.infer<typeof ApproachGate>;

export const FlightStats = z.object({
  /** Seconds above 250 kt IAS below 10,000 ft MSL while airborne. */
  overspeedBelow10kS: z.number(),
  maxIasBelow10kKt: num,
  maxBankDeg: num,
  /** Seconds banked beyond 30°. */
  steepBankS: z.number(),
  maxG: num,
  minG: num,
  maxTaxiKt: num,
  /** Seconds above 30 kt while taxiing. */
  fastTaxiS: z.number(),
  climbAvgFpm: num,
  descentAvgFpm: num,
  maxDescentFpm: num,
  gate1000: ApproachGate.nullable(),
  gate500: ApproachGate.nullable(),
  maxSinkBelow1000Fpm: num,
  iasSpreadBelow1000Kt: num,
  maxBankBelow500Deg: num,
  goArounds: z.number().int(),
  pausedS: z.number(),
});
export type FlightStats = z.infer<typeof FlightStats>;

/* ------------------------------------------------------------------ */
/* Flight plan (from SimBrief, via the Bridge)                         */
/* ------------------------------------------------------------------ */

export const PlanFix = z.object({ ident: z.string(), lat: z.number(), lon: z.number(), altitudeFt: z.number().nullable() });

export const FlightPlan = z.object({
  source: z.literal("simbrief"),
  ofpId: z.string().nullable(),
  callsign: z.string().nullable(),
  flightNumber: z.string().nullable(),
  airline: z.string().nullable(),
  aircraftIcao: z.string().nullable(),
  registration: z.string().nullable(),
  origin: z.object({ icao: z.string(), name: z.string().nullable(), runway: z.string().nullable(), lat: z.number(), lon: z.number(), elevationFt: z.number().nullable() }),
  destination: z.object({ icao: z.string(), name: z.string().nullable(), runway: z.string().nullable(), lat: z.number(), lon: z.number(), elevationFt: z.number().nullable() }),
  alternate: z.string().nullable(),
  route: z.string(),
  fixes: z.array(PlanFix),
  cruiseAltitudeFt: z.number().nullable(),
  distanceNm: z.number().nullable(),
  /** Unix seconds. */
  scheduledOut: z.number().nullable(),
  scheduledOff: z.number().nullable(),
  scheduledOn: z.number().nullable(),
  scheduledIn: z.number().nullable(),
  blockTimeS: z.number().nullable(),
  airTimeS: z.number().nullable(),
  /** Airport UTC offsets in hours (from the plan), for local clock times. */
  originUtcOffsetH: z.number().nullable().default(null),
  destinationUtcOffsetH: z.number().nullable().default(null),
  fuelUnits: z.enum(["kg", "lb"]),
  /** Values in kg regardless of the plan's units. */
  fuelRampKg: z.number().nullable(),
  fuelBurnKg: z.number().nullable(),
  fuelLandingKg: z.number().nullable(),
  fetchedAt: z.number().int(),
});
export type FlightPlan = z.infer<typeof FlightPlan>;

/* ------------------------------------------------------------------ */
/* Flight summary                                                      */
/* ------------------------------------------------------------------ */

export const FlightSummary = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "completed", "incomplete"]),
  simulator: SimulatorInfo,
  aircraft: AircraftInfo.nullable(),
  callsign: z.string().nullable(),
  departureIcao: z.string().nullable(),
  arrivalIcao: z.string().nullable(),
  departureName: z.string().nullable().default(null),
  arrivalName: z.string().nullable().default(null),
  departureRunway: z.string().nullable().default(null),
  arrivalRunway: z.string().nullable().default(null),
  /** Parking stand / gate from OpenStreetMap, when one is mapped there. */
  departureStand: z.string().nullable().default(null),
  arrivalStand: z.string().nullable().default(null),
  plan: FlightPlan.nullable().default(null),
  phase: FlightPhase,
  startedAt: z.number().int(),
  offBlockAt: z.number().int().nullable(),
  wheelsUpAt: z.number().int().nullable(),
  wheelsDownAt: z.number().int().nullable(),
  onBlockAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  distanceNm: z.number().nonnegative(),
  maxAltitudeFt: z.number().nullable(),
  maxGsKt: z.number().nullable(),
  fuelStartKg: z.number().nullable(),
  fuelEndKg: z.number().nullable(),
  landings: z.array(LandingReport),
  takeoff: TakeoffReport.nullable().default(null),
  stats: FlightStats.nullable().default(null),
  lastSeq: z.number().int().nonnegative(),
});
export type FlightSummary = z.infer<typeof FlightSummary>;

/* ------------------------------------------------------------------ */
/* Bridge status                                                       */
/* ------------------------------------------------------------------ */

export const SimConnectionState = z.enum(["searching", "connected", "disconnected", "error"]);
export type SimConnectionState = z.infer<typeof SimConnectionState>;

export const BridgeStatus = z.object({
  bridgeVersion: z.string(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  bridgeId: z.string(),
  hostname: z.string(),
  simState: SimConnectionState,
  simulator: SimulatorInfo.nullable(),
  aircraft: AircraftInfo.nullable(),
  lastFrameAt: z.number().int().nullable(),
  framesPerSecond: z.number().nonnegative(),
  clients: z.number().int().nonnegative(),
  activeFlightId: z.string().nullable(),
  message: z.string().nullable(),
});
export type BridgeStatus = z.infer<typeof BridgeStatus>;

/* ------------------------------------------------------------------ */
/* Commands (remote control) — lifecycle is part of the protocol       */
/* ------------------------------------------------------------------ */

export const CommandState = z.enum(["pending", "confirmed", "rejected", "timeout", "unsupported", "disarmed"]);
export type CommandState = z.infer<typeof CommandState>;

export const CommandRequest = z.object({
  type: z.literal("command"),
  id: z.string().min(8).max(64),
  /** Capability name from the aircraft profile, e.g. "autopilot.selectedHeading". */
  capability: z.string().min(1).max(96),
  value: z.union([z.number().finite(), z.boolean()]).nullable(),
  /** Client must confirm destructive commands explicitly. */
  confirmed: z.boolean().default(false),
});
export type CommandRequest = z.infer<typeof CommandRequest>;

/* ------------------------------------------------------------------ */
/* Wire messages                                                       */
/* ------------------------------------------------------------------ */

/** Messages from a client (app) to the Bridge. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocolVersion: z.number().int(), client: z.string().max(64), lastSeq: z.number().int().nonnegative().nullable() }),
  z.object({ type: z.literal("resume"), fromSeq: z.number().int().nonnegative() }),
  z.object({ type: z.literal("ping"), t: z.number() }),
  CommandRequest,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Messages from the Bridge to a client. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), status: BridgeStatus, flight: FlightSummary.nullable() }),
  z.object({ type: z.literal("status"), status: BridgeStatus }),
  z.object({ type: z.literal("frame"), frame: TelemetryFrame, phase: FlightPhase }),
  z.object({ type: z.literal("backfill"), frames: z.array(TelemetryFrame), complete: z.boolean() }),
  z.object({ type: z.literal("event"), event: FlightEvent }),
  z.object({ type: z.literal("flight"), flight: FlightSummary }),
  z.object({ type: z.literal("landing"), landing: LandingReport }),
  z.object({ type: z.literal("commandState"), id: z.string(), state: CommandState, detail: z.string().nullable() }),
  z.object({ type: z.literal("pong"), t: z.number() }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Helper: an empty frame with every value null. Adapters fill what they can. */
export function emptyFrame(seq: number, t: number, lat: number, lon: number): TelemetryFrame {
  return {
    seq,
    t,
    position: { lat, lon, altMslFt: null, altAglFt: null, onGround: false },
    attitude: { pitchDeg: null, bankDeg: null, headingTrueDeg: null, headingMagDeg: null },
    speed: { iasKt: null, tasKt: null, gsKt: null, mach: null, vsFpm: null },
    environment: { windDirDeg: null, windKt: null, oatC: null, qnhHpa: null },
    loads: { gForce: null, touchdownVsFpm: null },
    engines: [],
    fuel: { totalKg: null, totalFlowKgH: null },
    controls: { gearDown: null, flapsIndex: null, flapsPct: null, spoilersPct: null, parkingBrake: null, pushbackActive: null },
    autopilot: {
      master: null, flightDirector: null, headingHold: null, selectedHeadingDeg: null, selectedAltitudeFt: null,
      selectedVsFpm: null, selectedSpeedKt: null, selectedMach: null, navHold: null, approachHold: null, autothrottle: null,
    },
    lights: { nav: null, beacon: null, strobe: null, landing: null, taxi: null, logo: null, wing: null },
    electrical: { battery: null, externalPower: null, apuRpmPct: null },
    radios: {
      com1ActiveMhz: null, com1StandbyMhz: null, com2ActiveMhz: null, com2StandbyMhz: null,
      nav1ActiveMhz: null, nav1StandbyMhz: null, nav2ActiveMhz: null, nav2StandbyMhz: null,
    },
    sim: { paused: false, simRate: null, slew: null },
  };
}
