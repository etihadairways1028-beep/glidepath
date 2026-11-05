/**
 * Microsoft Flight Simulator 2020 / 2024 adapter (SimConnect).
 *
 * Uses node-simconnect, a pure-TypeScript SimConnect client: no DLL, nothing
 * installed in the Community folder. Connection details are auto-discovered
 * from the Windows registry once the sim is running.
 *
 * STATUS: written against the documented SimConnect API and simvar list.
 * It has NOT yet been run against a live simulator. Run
 * `pnpm bridge:probe` on the simulator PC to verify (Stage 4).
 *
 * Robustness:
 *  - Retries every 5 s until the sim starts; reconnects after the sim quits.
 *  - If the sim rejects a variable (SimConnect exception), that variable is
 *    marked unsupported, the data definition is rebuilt without it, and the
 *    value is sent as null. One bad variable never breaks the stream.
 */
import { EventEmitter } from "node:events";
import {
  open,
  Protocol,
  SimConnectConstants,
  SimConnectDataType,
  SimConnectPeriod,
  type RecvEventFilename,
  type RecvException,
  type RecvSimObjectData,
  type SimConnectConnection,
} from "node-simconnect";
import type { AircraftInfo, SimulatorInfo } from "@glidepath/protocol";
import { emptyFrame } from "@glidepath/protocol";
import type { Logger } from "../log.js";
import { profileForTitle } from "../profiles.js";
import type { RawFrame, SimAdapter } from "./types.js";

const LB_TO_KG = 0.45359237;

/** [simvar, unit, key]. Order defines the data layout. */
type VarDef = readonly [name: string, unit: string, key: string];

const ENGINE_VARS = (i: number): VarDef[] => [
  [`GENERAL ENG COMBUSTION:${i}`, "bool", `eng${i}.running`],
  [`TURB ENG N1:${i}`, "percent", `eng${i}.n1`],
  [`TURB ENG N2:${i}`, "percent", `eng${i}.n2`],
  [`GENERAL ENG EXHAUST GAS TEMPERATURE:${i}`, "celsius", `eng${i}.egt`],
  [`ENG FUEL FLOW PPH:${i}`, "pounds per hour", `eng${i}.ffLbH`],
];

export const TELEMETRY_VARS: VarDef[] = [
  ["PLANE LATITUDE", "degrees", "lat"],
  ["PLANE LONGITUDE", "degrees", "lon"],
  ["PLANE ALTITUDE", "feet", "altMsl"],
  ["PLANE ALT ABOVE GROUND", "feet", "altAgl"],
  ["SIM ON GROUND", "bool", "onGround"],
  ["PLANE PITCH DEGREES", "degrees", "pitch"],
  ["PLANE BANK DEGREES", "degrees", "bank"],
  ["PLANE HEADING DEGREES TRUE", "degrees", "hdgTrue"],
  ["PLANE HEADING DEGREES MAGNETIC", "degrees", "hdgMag"],
  ["AIRSPEED INDICATED", "knots", "ias"],
  ["AIRSPEED TRUE", "knots", "tas"],
  ["GROUND VELOCITY", "knots", "gs"],
  ["AIRSPEED MACH", "mach", "mach"],
  ["VERTICAL SPEED", "feet per minute", "vs"],
  ["AMBIENT WIND DIRECTION", "degrees", "windDir"],
  ["AMBIENT WIND VELOCITY", "knots", "windKt"],
  ["AMBIENT TEMPERATURE", "celsius", "oat"],
  ["SEA LEVEL PRESSURE", "millibars", "qnh"],
  ["G FORCE", "gforce", "g"],
  ["PLANE TOUCHDOWN NORMAL VELOCITY", "feet per second", "tdVelFps"],
  ["NUMBER OF ENGINES", "number", "engines"],
  ...ENGINE_VARS(1), ...ENGINE_VARS(2), ...ENGINE_VARS(3), ...ENGINE_VARS(4),
  ["FUEL TOTAL QUANTITY WEIGHT", "pounds", "fuelLb"],
  ["GEAR HANDLE POSITION", "bool", "gear"],
  ["FLAPS HANDLE INDEX", "number", "flapsIdx"],
  ["FLAPS HANDLE PERCENT", "percent", "flapsPct"],
  ["SPOILERS HANDLE POSITION", "percent", "spoilers"],
  ["BRAKE PARKING POSITION", "bool", "parkBrake"],
  ["PUSHBACK STATE", "enum", "pushback"],
  ["AUTOPILOT MASTER", "bool", "apMaster"],
  ["AUTOPILOT FLIGHT DIRECTOR ACTIVE", "bool", "fd"],
  ["AUTOPILOT HEADING LOCK", "bool", "hdgHold"],
  ["AUTOPILOT HEADING LOCK DIR", "degrees", "selHdg"],
  ["AUTOPILOT ALTITUDE LOCK VAR", "feet", "selAlt"],
  ["AUTOPILOT VERTICAL HOLD VAR", "feet per minute", "selVs"],
  ["AUTOPILOT AIRSPEED HOLD VAR", "knots", "selSpd"],
  ["AUTOPILOT MACH HOLD VAR", "number", "selMach"],
  ["AUTOPILOT NAV1 LOCK", "bool", "navHold"],
  ["AUTOPILOT APPROACH HOLD", "bool", "apprHold"],
  ["AUTOPILOT THROTTLE ARM", "bool", "athr"],
  ["LIGHT NAV", "bool", "lNav"],
  ["LIGHT BEACON", "bool", "lBeacon"],
  ["LIGHT STROBE", "bool", "lStrobe"],
  ["LIGHT LANDING", "bool", "lLanding"],
  ["LIGHT TAXI", "bool", "lTaxi"],
  ["LIGHT LOGO", "bool", "lLogo"],
  ["LIGHT WING", "bool", "lWing"],
  ["ELECTRICAL MASTER BATTERY", "bool", "battery"],
  ["EXTERNAL POWER ON", "bool", "extPower"],
  ["APU PCT RPM", "percent", "apuRpm"],
  ["COM ACTIVE FREQUENCY:1", "MHz", "com1a"],
  ["COM STANDBY FREQUENCY:1", "MHz", "com1s"],
  ["COM ACTIVE FREQUENCY:2", "MHz", "com2a"],
  ["COM STANDBY FREQUENCY:2", "MHz", "com2s"],
  ["NAV ACTIVE FREQUENCY:1", "MHz", "nav1a"],
  ["NAV STANDBY FREQUENCY:1", "MHz", "nav1s"],
  ["NAV ACTIVE FREQUENCY:2", "MHz", "nav2a"],
  ["NAV STANDBY FREQUENCY:2", "MHz", "nav2s"],
  ["SIMULATION RATE", "number", "simRate"],
  ["IS SLEW ACTIVE", "bool", "slew"],
];

const IDENT_VARS: VarDef[] = [
  ["TITLE", "", "title"],
  ["ATC TYPE", "", "atcType"],
  ["ATC MODEL", "", "atcModel"],
  ["ATC ID", "", "atcId"],
  ["ATC AIRLINE", "", "atcAirline"],
  ["ATC FLIGHT NUMBER", "", "atcFlightNumber"],
];

// SimConnect ids
const DEF_IDENT = 2;
const REQ_IDENT = 2;
const DEF_TELEMETRY_BASE = 100; // + generation
const EVT_PAUSE = 10;
const EVT_SIM = 11;
const EVT_AIRCRAFT_LOADED = 12;
const EVT_FLIGHT_LOADED = 13;
const EVT_CRASHED = 14;

export interface MsfsAdapterOptions {
  interval: number;
  maxHz: number;
  log: Logger;
}

export class MsfsAdapter extends EventEmitter implements SimAdapter {
  readonly id = "msfs";
  private handle: SimConnectConnection | null = null;
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private activeVars: VarDef[] = [];
  private unsupported = new Set<string>();
  /** sendId of each AddToDataDefinition call → var name, to map exceptions back. */
  private sendIdToVar = new Map<number, string>();
  private rebuildTimer: NodeJS.Timeout | null = null;
  private paused = false;
  private lastEmit = 0;
  private aircraftTitle = "";
  private readonly log: Logger;

  constructor(private readonly opts: MsfsAdapterOptions) {
    super();
    this.log = opts.log.child("msfs");
  }

  async start(): Promise<void> {
    this.stopped = false;
    void this.connectLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    try {
      this.handle?.close();
    } catch {
      /* already closed */
    }
    this.handle = null;
  }

  private scheduleRetry(ms = 5000): void {
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connectLoop(), ms);
  }

  private async connectLoop(): Promise<void> {
    if (this.stopped || this.handle) return;
    this.emit("state", "searching", "Waiting for Microsoft Flight Simulator…");
    try {
      const { recvOpen, handle } = await open("Glidepath Bridge", Protocol.KittyHawk);
      this.handle = handle;
      const sim = detectSimulator(recvOpen.applicationName, recvOpen.applicationVersionMajor, recvOpen.applicationVersionMinor);
      this.log.info("Connected to simulator", { app: recvOpen.applicationName, version: `${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`, detected: sim.id });
      this.emit("simulator", sim);
      this.emit("state", "connected", null);
      this.wire(handle);
      this.subscribe(handle);
      this.buildTelemetryDefinition(handle);
      this.requestIdent(handle);
    } catch (err) {
      this.log.debug("SimConnect not available yet", err instanceof Error ? err.message : String(err));
      this.handle = null;
      this.scheduleRetry();
    }
  }

  private wire(h: SimConnectConnection): void {
    h.on("quit", () => this.onDisconnected("Simulator closed"));
    h.on("close", () => this.onDisconnected("Connection closed"));
    h.on("error", (e: Error) => {
      this.log.warn("SimConnect socket error", e.message);
      this.onDisconnected("Connection error");
    });
    h.on("exception", (ex: RecvException) => this.onException(ex));
    h.on("event", (ev) => {
      if (ev.clientEventId === EVT_PAUSE) this.paused = ev.data !== 0;
      if (ev.clientEventId === EVT_SIM && ev.data === 0) this.emit("sessionEnd");
      if (ev.clientEventId === EVT_CRASHED) this.log.info("Simulator reported a crash");
    });
    h.on("eventFilename", (ev: RecvEventFilename) => {
      if (ev.clientEventId === EVT_AIRCRAFT_LOADED || ev.clientEventId === EVT_FLIGHT_LOADED) {
        this.log.info("Aircraft/flight loaded", ev.fileName);
        this.requestIdent(h);
      }
    });
    h.on("simObjectData", (d: RecvSimObjectData) => this.onData(d));
  }

  private subscribe(h: SimConnectConnection): void {
    h.subscribeToSystemEvent(EVT_PAUSE, "Pause");
    h.subscribeToSystemEvent(EVT_SIM, "Sim");
    h.subscribeToSystemEvent(EVT_AIRCRAFT_LOADED, "AircraftLoaded");
    h.subscribeToSystemEvent(EVT_FLIGHT_LOADED, "FlightLoaded");
    h.subscribeToSystemEvent(EVT_CRASHED, "Crashed");
  }

  private requestIdent(h: SimConnectConnection): void {
    h.clearDataDefinition(DEF_IDENT);
    for (const [name] of IDENT_VARS) h.addToDataDefinition(DEF_IDENT, name, null, SimConnectDataType.STRING256);
    h.requestDataOnSimObject(REQ_IDENT, DEF_IDENT, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE);
  }

  private buildTelemetryDefinition(h: SimConnectConnection): void {
    const old = DEF_TELEMETRY_BASE + this.generation;
    if (this.generation > 0) {
      try {
        h.requestDataOnSimObject(old, old, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.NEVER);
        h.clearDataDefinition(old);
      } catch {
        /* ignore */
      }
    }
    this.generation++;
    const def = DEF_TELEMETRY_BASE + this.generation;
    this.activeVars = TELEMETRY_VARS.filter(([name]) => !this.unsupported.has(name));
    this.sendIdToVar.clear();
    for (const [name, unit] of this.activeVars) {
      const sendId = h.addToDataDefinition(def, name, unit, SimConnectDataType.FLOAT64);
      this.sendIdToVar.set(sendId, name);
    }
    h.requestDataOnSimObject(def, def, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME, 0, 0, this.opts.interval, 0);
    this.log.debug(`Telemetry definition #${this.generation} with ${this.activeVars.length} variables`);
  }

  private onException(ex: RecvException): void {
    const varName = this.sendIdToVar.get(ex.sendId);
    if (varName) {
      this.log.warn(`Simulator rejected variable "${varName}" (${ex.exceptionName}); it will be reported as unavailable`);
      this.unsupported.add(varName);
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => this.handle && this.buildTelemetryDefinition(this.handle), 250);
      return;
    }
    this.log.warn("SimConnect exception", { name: ex.exceptionName, sendId: ex.sendId, index: ex.index });
  }

  private onDisconnected(reason: string): void {
    if (!this.handle) return;
    this.log.info(`Disconnected: ${reason}`);
    this.handle = null;
    this.emit("state", "disconnected", reason);
    this.emit("sessionEnd");
    this.scheduleRetry(3000);
  }

  private onData(d: RecvSimObjectData): void {
    if (d.requestID === REQ_IDENT) {
      const v: Record<string, string> = {};
      for (const [, , key] of IDENT_VARS) v[key] = d.data.readString256().trim();
      this.aircraftTitle = v.title ?? "";
      const profile = profileForTitle(this.aircraftTitle);
      const info: AircraftInfo = {
        title: this.aircraftTitle || "Unknown aircraft",
        icaoType: cleanIcao(v.atcModel) ?? cleanIcao(v.atcType),
        registration: v.atcId || null,
        airline: v.atcAirline || null,
        engineCount: null,
        profileId: profile.id,
      };
      this.log.info("Aircraft detected", { title: info.title, type: info.icaoType, profile: profile.id });
      this.emit("aircraft", info);
      return;
    }
    if (d.requestID !== DEF_TELEMETRY_BASE + this.generation) return; // stale generation

    const now = Date.now();
    const values = new Map<string, number>();
    for (const [, , key] of this.activeVars) values.set(key, d.data.readFloat64());
    if (now - this.lastEmit < 1000 / this.opts.maxHz) return;
    this.lastEmit = now;
    this.emit("frame", toFrame(values, now, this.paused));
  }
}

/** MSFS 2020 reports application version 11.x; MSFS 2024 reports 12.x ("SunRise"). Verified by the probe in Stage 4. */
export function detectSimulator(appName: string, major: number, minor: number): SimulatorInfo {
  const is2024 = /sunrise/i.test(appName) || major >= 12;
  return {
    id: is2024 ? "msfs2024" : "msfs2020",
    name: is2024 ? "Microsoft Flight Simulator 2024" : "Microsoft Flight Simulator 2020",
    version: `${major}.${minor}`,
    source: "live",
  };
}

function cleanIcao(s: string | undefined): string | null {
  if (!s) return null;
  // ATC MODEL is often a localisation key like "TT:ATCCOM.AC_MODEL_A20N.0.text".
  const m = /AC_MODEL[_ ]([A-Z0-9]{2,4})/i.exec(s) ?? /^([A-Z][A-Z0-9]{1,3})$/i.exec(s.trim());
  return m ? m[1]!.toUpperCase() : null;
}

function toFrame(v: Map<string, number>, t: number, paused: boolean): RawFrame {
  const n = (k: string): number | null => {
    const x = v.get(k);
    return x === undefined || !Number.isFinite(x) ? null : x;
  };
  const b = (k: string): boolean | null => {
    const x = n(k);
    return x === null ? null : x !== 0;
  };
  const lat = n("lat") ?? 0;
  const lon = n("lon") ?? 0;
  const f = emptyFrame(0, t, clamp(lat, -90, 90), clamp(lon, -180, 180));
  const { seq: _seq, ...frame } = f;
  frame.position.altMslFt = n("altMsl");
  frame.position.altAglFt = n("altAgl");
  frame.position.onGround = b("onGround") ?? false;
  // SimConnect: PLANE PITCH DEGREES is positive nose-DOWN; we publish positive nose-up.
  const pitch = n("pitch");
  frame.attitude.pitchDeg = pitch === null ? null : -pitch;
  // SimConnect: PLANE BANK DEGREES is positive left-wing-down; we publish positive right-wing-down. (Verify with probe.)
  const bank = n("bank");
  frame.attitude.bankDeg = bank === null ? null : -bank;
  frame.attitude.headingTrueDeg = n("hdgTrue");
  frame.attitude.headingMagDeg = n("hdgMag");
  frame.speed = { iasKt: n("ias"), tasKt: n("tas"), gsKt: n("gs"), mach: n("mach"), vsFpm: n("vs") };
  frame.environment = { windDirDeg: n("windDir"), windKt: n("windKt"), oatC: n("oat"), qnhHpa: n("qnh") };
  const td = n("tdVelFps");
  frame.loads = { gForce: n("g"), touchdownVsFpm: td === null ? null : Math.abs(td) * 60 };
  const count = Math.max(0, Math.min(4, Math.round(n("engines") ?? 0)));
  frame.engines = [];
  for (let i = 1; i <= count; i++) {
    const ff = n(`eng${i}.ffLbH`);
    frame.engines.push({ running: b(`eng${i}.running`), n1Pct: n(`eng${i}.n1`), n2Pct: n(`eng${i}.n2`), egtC: n(`eng${i}.egt`), fuelFlowKgH: ff === null ? null : ff * LB_TO_KG });
  }
  const fuel = n("fuelLb");
  const flows = frame.engines.map((e) => e.fuelFlowKgH).filter((x): x is number => x !== null);
  frame.fuel = { totalKg: fuel === null ? null : fuel * LB_TO_KG, totalFlowKgH: flows.length ? flows.reduce((a, c) => a + c, 0) : null };
  const push = n("pushback");
  frame.controls = {
    gearDown: b("gear"), flapsIndex: n("flapsIdx"), flapsPct: n("flapsPct"), spoilersPct: n("spoilers"), parkingBrake: b("parkBrake"),
    pushbackActive: push === null ? null : push !== 3, // 3 = no pushback
  };
  frame.autopilot = {
    master: b("apMaster"), flightDirector: b("fd"), headingHold: b("hdgHold"), selectedHeadingDeg: n("selHdg"), selectedAltitudeFt: n("selAlt"),
    selectedVsFpm: n("selVs"), selectedSpeedKt: n("selSpd"), selectedMach: n("selMach"), navHold: b("navHold"), approachHold: b("apprHold"), autothrottle: b("athr"),
  };
  frame.lights = { nav: b("lNav"), beacon: b("lBeacon"), strobe: b("lStrobe"), landing: b("lLanding"), taxi: b("lTaxi"), logo: b("lLogo"), wing: b("lWing") };
  frame.electrical = { battery: b("battery"), externalPower: b("extPower"), apuRpmPct: n("apuRpm") };
  frame.radios = {
    com1ActiveMhz: n("com1a"), com1StandbyMhz: n("com1s"), com2ActiveMhz: n("com2a"), com2StandbyMhz: n("com2s"),
    nav1ActiveMhz: n("nav1a"), nav1StandbyMhz: n("nav1s"), nav2ActiveMhz: n("nav2a"), nav2StandbyMhz: n("nav2s"),
  };
  frame.sim = { paused, simRate: n("simRate"), slew: b("slew") };
  return frame;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
