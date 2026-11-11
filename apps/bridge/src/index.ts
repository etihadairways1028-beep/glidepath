/**
 * Glidepath Bridge — entry point.
 *
 *   Simulator adapter → FlightSession (engine + recorder) → LAN server
 */
import { PROTOCOL_VERSION, type AircraftInfo, type BridgeStatus, type SimConnectionState, type SimulatorInfo } from "@glidepath/protocol";
import { BRIDGE_VERSION, HOSTNAME, loadConfig, loadIdentity } from "./config.js";
import { exec } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lanAddresses } from "./server.js";
import { createLogger } from "./log.js";
import { Recorder } from "./recorder.js";
import { FlightSession } from "./session.js";
import { LanServer } from "./server.js";
import { ExternalData } from "./external.js";
import { AiService } from "./ai.js";
import { AirportDb, type AirportRow, type FrequencyRow, type RunwayRow } from "@glidepath/aviation-data";
import airportsJson from "../../../packages/aviation-data/data/airports.json";
import runwaysJson from "../../../packages/aviation-data/data/runways.json";
import frequenciesJson from "../../../packages/aviation-data/data/frequencies.json";
import { MsfsAdapter } from "./adapters/msfs.js";
import { ReplayAdapter } from "./adapters/replay.js";
import type { SimAdapter } from "./adapters/types.js";
import { runProbeCli } from "../scripts/probe-msfs.js";

// node:sqlite emits an "experimental" warning when it loads. In the bundled exe that
// happens before any code here runs, but warnings are printed on the next tick, so
// replacing the default printer now still catches it. Every other warning is kept.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (/SQLite is an experimental feature/.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});

async function main(): Promise<void> {
  if (process.argv.includes("--probe")) {
    runProbeCli("msfs-probe-report.json");
    return;
  }
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error(`\n  Settings problem: ${(e as Error).message}\n  Press Enter to close.\n`);
    await holdWindow(10 * 60 * 1000);
    process.exit(2);
  }
  const log = createLogger(cfg.dataDir, cfg.logLevel);
  const identity = loadIdentity(cfg.dataDir);
  log.info(`Glidepath Bridge ${BRIDGE_VERSION} (protocol v${PROTOCOL_VERSION}) starting`, { dataDir: cfg.dataDir, adapter: cfg.adapter });

  const recorder = new Recorder(cfg.dataDir);
  const airports = new AirportDb(airportsJson as unknown as AirportRow[], runwaysJson as unknown as Record<string, RunwayRow[]>, frequenciesJson as unknown as Record<string, FrequencyRow[]>);
  const external = new ExternalData(log);
  log.info(`Airport database: ${airports.size.toLocaleString("en-US")} airports (OurAirports)`);
  const session = new FlightSession(recorder, log, airports, external);

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

  const ai = new AiService(cfg.dataDir, log);
  const server = new LanServer(cfg, identity, session, recorder, status, log, external, airports, ai);

  adapter.on("state", (s, m) => {
    if (s !== simState || m !== simMessage) {
      const text = s === "connected" ? `Connected${simulator ? " to " + simulator.name : ""}` : s === "searching" ? "Waiting for Microsoft Flight Simulator… (start a flight in the sim; the Bridge connects by itself)" : (m ?? s);
      log.info(`Simulator: ${text}`);
    }
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
  server.setRemote(adapter);

  try {
    await server.start();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      // Most likely the Bridge is already open in another window.
      console.log(`\n  Glidepath Bridge is already running on this PC (port ${cfg.port} is in use).\n  Opening it in your browser. You can close this window.\n`);
      if (cfg.openBrowser) openInBrowser(`http://localhost:${cfg.port}`);
      await holdWindow(8000);
      process.exit(0);
    }
    throw e;
  }
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

  const lan = lanAddresses();
  console.log([
    "",
    "  ============================================================",
    "    Glidepath Bridge is running. Keep this window open.",
    "  ============================================================",
    `  On this PC:      http://localhost:${cfg.port}`,
    "",
    "  CONNECT YOUR iPAD (same Wi-Fi):",
    `    1. In Safari on the iPad, go to:   glidepath.local:${cfg.port}`,
    `    2. Type this code:                 ${server.pairCode.slice(0, 3)} ${server.pairCode.slice(3)}`,
    "    Or open the Glidepath website on the iPad, tap Connect, and type the same code.",
    ...lan.map((ip) => `    (If that address doesn't open, use http://${ip}:${cfg.port} instead.)`),
    "",
    "  To stop:         close this window or press Ctrl+C",
    "",
  ].join("\n"));
  const spaced = `${server.pairCode.slice(0, 3)} ${server.pairCode.slice(3)}`;
  log.info(`Pairing code: ${spaced}`);
  try { process.title = `Glidepath Bridge - code ${spaced}`; } catch { /* ignore */ }
  writeCodeFile(spaced, cfg.port, log);
  if (cfg.openBrowser) openInBrowser(`http://localhost:${cfg.port}`);
}

/** Put the pairing code on the Desktop too, so it is easy to find while flying. */
function writeCodeFile(code: string, port: number, log: { info(m: string): void }): void {
  const home = homedir();
  const desks = [join(home, "Desktop"), join(home, "OneDrive", "Desktop")].filter((d) => existsSync(d));
  const text = `GLIDEPATH PAIRING CODE: ${code}\r\n\r\nOn the iPad: open the Glidepath website or app, tap Connect to my PC, and type this code.\r\nOr in Safari go to glidepath.local:${port}\r\n\r\nThe code changes each time the Bridge starts. This file is updated automatically.\r\n`;
  for (const d of desks) {
    try { writeFileSync(join(d, "Glidepath code.txt"), text); log.info(`Pairing code also saved to ${join(d, "Glidepath code.txt")}`); } catch { /* not writable */ }
  }
}

function openInBrowser(url: string): void {
  const cmd = platform() === "win32" ? `start "" "${url}"` : platform() === "darwin" ? `open "${url}"` : null;
  if (cmd) exec(cmd, { windowsHide: true }, () => undefined);
}

/** When the Bridge was double-clicked, keep its window open long enough to read why it stopped. */
function holdWindow(ms: number): Promise<void> {
  if (platform() !== "win32" || !process.stdin.isTTY) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    process.stdin.once("data", () => { clearTimeout(t); resolve(); });
    process.stdin.resume();
  });
}

main().catch(async (e) => {
  const err = e as Error;
  console.error([
    "",
    "  The Glidepath Bridge couldn't start.",
    `  Reason: ${err?.message ?? String(e)}`,
    "",
    "  Send a photo of this window to whoever gave you Glidepath, or open",
    "  README-FIRST.txt for help. Press Enter to close.",
    "",
  ].join("\n"));
  await holdWindow(10 * 60 * 1000);
  process.exit(1);
});
