/**
 * Glidepath Bridge — entry point.
 *
 *   Simulator adapter → FlightSession (engine + recorder) → LAN server
 */
import { PROTOCOL_VERSION, type AircraftInfo, type BridgeStatus, type SimConnectionState, type SimulatorInfo } from "@glidepath/protocol";
import { BRIDGE_VERSION, HOSTNAME, loadConfig, loadIdentity } from "./config.js";
import { createLogger } from "./log.js";
import { Recorder } from "./recorder.js";
import { FlightSession } from "./session.js";
import { LanServer } from "./server.js";
import { MsfsAdapter } from "./adapters/msfs.js";
import { ReplayAdapter } from "./adapters/replay.js";
import type { SimAdapter } from "./adapters/types.js";
import { runProbeCli } from "../scripts/probe-msfs.js";

// node:sqlite prints an "experimental" warning on every start; it is expected, so hide just that one.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  if (String(w instanceof Error ? w.message : w).includes("SQLite is an experimental feature")) return;
  return (emitWarning as (...a: unknown[]) => void)(w, ...rest);
}) as typeof process.emitWarning;

async function main(): Promise<void> {
  if (process.argv.includes("--probe")) {
    runProbeCli("msfs-probe-report.json");
    return;
  }
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const log = createLogger(cfg.dataDir, cfg.logLevel);
  const identity = loadIdentity(cfg.dataDir);
  log.info(`Glidepath Bridge ${BRIDGE_VERSION} (protocol v${PROTOCOL_VERSION}) starting`, { dataDir: cfg.dataDir, adapter: cfg.adapter });

  const recorder = new Recorder(cfg.dataDir);
  const session = new FlightSession(recorder, log);

  let simState: SimConnectionState = "searching";
  let simMessage: string | null = null;
  let simulator: SimulatorInfo | null = null;
  let aircraft: AircraftInfo | null = null;
  let lastFrameAt: number | null = null;
  const frameTimes: number[] = [];

  const adapter: SimAdapter = cfg.adapter === "replay"
    ? new ReplayAdapter(cfg.replayFile!, cfg.replaySpeed, log)
    : new MsfsAdapter({ interval: cfg.simconnectInterval, maxHz: 10, log });

  const status = (): BridgeStatus => {
    const now = Date.now();
    while (frameTimes.length && frameTimes[0]! < now - 5000) frameTimes.shift();
    return {
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      bridgeId: identity.bridgeId,
      hostname: HOSTNAME,
      simState,
      simulator,
      aircraft,
      lastFrameAt,
      framesPerSecond: frameTimes.length / 5,
      clients: server.clientCount,
      activeFlightId: session.activeFlight?.id ?? null,
      message: simMessage,
    };
  };

  const server = new LanServer(cfg, identity, session, recorder, status, log);

  adapter.on("state", (s, m) => {
    simState = s;
    simMessage = m;
    server.broadcastStatus();
  });
  adapter.on("simulator", (info) => {
    simulator = info;
    session.setSimulator(info);
    server.broadcastStatus();
  });
  adapter.on("aircraft", (info) => {
    aircraft = info;
    session.setAircraft(info);
    server.broadcastStatus();
  });
  adapter.on("frame", (f) => {
    lastFrameAt = f.t;
    frameTimes.push(Date.now());
    try {
      session.ingest(f);
    } catch (e) {
      log.error("Failed to process frame", e);
    }
  });
  adapter.on("sessionEnd", () => session.endSession());

  await server.start();
  await adapter.start();

  const statusTimer = setInterval(() => server.broadcastStatus(), 5000);
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Shutting down (${signal})`);
    clearInterval(statusTimer);
    await adapter.stop();
    session.shutdown();
    await server.stop();
    recorder.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (e) => log.error("Uncaught exception (Bridge keeps running)", e));
  process.on("unhandledRejection", (e) => log.error("Unhandled rejection (Bridge keeps running)", e));

  log.info(`Open http://localhost:${cfg.port} on this PC to pair your iPad or phone`);
}

void main();
