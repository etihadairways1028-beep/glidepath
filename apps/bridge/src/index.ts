import type { FlightEvent, FlightPhase, FlightSummary, LandingReport, TelemetryFrame } from "@glidepath/protocol";
/**
 * Glidepath Bridge — entry point.
 *
 *   Simulator adapter → FlightSession (engine + recorder) → LAN server
 */
import { activityFor, DiscordPresence } from "./discord.js";
import { CloudLink } from "./cloudlink.js";
import { Updater } from "./updater.js";
import { PROTOCOL_VERSION, type AircraftInfo, type BridgeStatus, type SimConnectionState, type SimulatorInfo } from "@glidepath/protocol";
import { BRIDGE_VERSION, HOSTNAME, loadConfig, loadIdentity } from "./config.js";
import { exec, spawn } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lanAddresses } from "./server.js";
import { ChartService } from "./charts.js";
import { createLogger } from "./log.js";
import { Recorder } from "./recorder.js";
import { FlightSession } from "./session.js";
import { SimPlanWatcher } from "./simplan.js";
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
  external.startTrafficRecording();
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

  // The flight plan you load in MSFS (world map, or a .PLN from any planner). A SimBrief plan you loaded wins.
  const simPlan = new SimPlanWatcher(log);
  simPlan.onPlan = (plan) => { const cur = session.currentPlan; if (!cur || cur.source === "msfs") session.setPlan(plan); };
  adapter.on("planFile", (file: string) => simPlan.reported(file));
  simPlan.start();

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
  // Discord status: what you're flying, on your Discord profile (off until turned on in the app).
  const discord = new DiscordPresence(cfg.dataDir, log.child("discord"));
  server.discord = discord;
  const cloud = new CloudLink({ dataDir: cfg.dataDir, port: cfg.port, host: cfg.host, bridgeId: identity.bridgeId, version: BRIDGE_VERSION, token: () => identity.pairingToken, log: log.child("cloud") });
  server.cloud = cloud;
  // Pairing by code from any network: the device types the code and stays on its page.
  const pcLink = process.env.GLIDEPATH_PC_LINK === "0" ? null : new CloudLink({ dataDir: cfg.dataDir, port: cfg.port, host: cfg.host, bridgeId: identity.bridgeId, version: BRIDGE_VERSION, token: () => identity.pairingToken, log: log.child("pair"),
    pc: { code: () => server.pairCode, onCodeTaken: () => { server.newPairCode(); } } });
  const updater = new Updater({
    version: BRIDGE_VERSION, dataDir: cfg.dataDir, log: log.child("update"),
    // Updates install themselves, but only while the simulator is closed, so the Windows prompt never lands on top of MSFS.
    autoInstall: () => process.env.GLIDEPATH_AUTO_UPDATE !== "0" && !session.activeFlight && simState !== "connected",
    // Test only: pretend to run the installer (used to check the update flow off Windows).
    ...(process.env.GLIDEPATH_UPDATE_FAKE_RUN === "1" ? { run: (f: string) => { log.info(`(test) would run ${f}`); setTimeout(() => process.exit(0), 1500); } } : {}),
  });
  server.updater = updater;
  discord.start();
  // Lock screen notifications on the pilot's devices (through the account, when this PC is signed in).
  const apt = (f: FlightSummary | null, side: "arr" | "dep") => (side === "arr" ? f?.arrivalIcao ?? f?.plan?.destination.icao : f?.departureIcao ?? f?.plan?.origin.icao) ?? null;
  session.on("event", (e: FlightEvent) => {
    const f = session.activeFlight;
    if (!f) return;
    // Checklist reminders at the moments they're run.
    if (e.type === "TAXI_START") void cloud.notify("cl-taxi", f.id, "Before take-off checklist", `Taxiing out${apt(f, "dep") ? ` of ${apt(f, "dep")}` : ""}. Run the before take-off checklist.`, "/app/#/checklists");
    if (e.type === "APPROACH_START") void cloud.notify("cl-approach", f.id, "Approach checklist", `On approach${apt(f, "arr") ? ` to ${apt(f, "arr")}` : ""}. Run the approach and landing checklists.`, "/app/#/checklists");
    if (e.type === "ON_BLOCK") void cloud.notify("cl-parked", f.id, "Parking checklist", "At the gate. Set the parking brake, shut down and secure the aircraft.", "/app/#/checklists");
    if (e.type === "TOP_OF_DESCENT") {
      const to = apt(f, "arr");
      void cloud.notify("tod", f.id, "Top of descent", `Time to start down${to ? ` for ${to}` : ""}. Brief the arrival and set up the approach.`);
    }
  });
  session.on("landing", (r: LandingReport) => {
    const f = session.activeFlight;
    if (!f) return;
    const to = f.arrivalIcao ?? apt(f, "arr");
    const fpm = r.touchdownVsFpm != null ? `${Math.round(Math.abs(r.touchdownVsFpm))} fpm` : null;
    void cloud.notify("landed", f.id, `Landed${to ? ` at ${to}` : ""}`, [fpm, r.grade ? `grade ${r.grade}` : null, f.arrivalRunway ? `runway ${f.arrivalRunway}` : null].filter(Boolean).join(" · ") || "Welcome in.");
  });
  session.on("flight", (f: FlightSummary) => {
    if (f.status !== "completed") return;
    const route = [apt(f, "dep"), apt(f, "arr")].filter(Boolean).join(" → ");
    void cloud.notify("review", f.id, "Your flight review is ready", `${route ? `${route}: ` : ""}see your scores and one thing to work on.`, `/app/#/review/${encodeURIComponent(f.id)}`);
  });
  session.on("frame", (frame: TelemetryFrame, phase: FlightPhase) => discord.update(activityFor(session.activeFlight, frame, phase)));
  setInterval(() => { if (!lastFrameAt || Date.now() - lastFrameAt > 120_000) discord.update(null); }, 30_000).unref();
  server.setCharts(new ChartService(join(cfg.dataDir, "charts"), fetch, log.child("charts")));

  try {
    await server.start();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      // Most likely the Bridge is already open in another window.
      console.log(`\n  Glidepath Bridge is already running on this PC (port ${cfg.port} is in use).\n  Opening the Glidepath window. You can close this one.\n`);
      if (cfg.openBrowser) openAppWindow(`http://localhost:${cfg.port}/app/`);
      await holdWindow(8000);
      process.exit(0);
    }
    throw e;
  }
  cloud.start();
  pcLink?.start();
  server.pcLink = pcLink;
  if (process.env.GLIDEPATH_UPDATES !== "0") updater.start();
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
    cloud.stop();
    pcLink?.stop();
    updater.stop();
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
    cloud.status().signedIn
      ? `  CONNECT ANYWHERE is on (${cloud.status().email}). On your iPad or phone, open`
      : `  EASIEST, ANY WI-FI: open http://localhost:${cfg.port} and sign in with your`,
    cloud.status().signedIn
      ? "    Glidepath and sign in with the same account. It connects by itself."
      : "    Glidepath account. Then sign in on your iPad too. No codes needed.",
    "",
    "  OR WITH A CODE (same Wi-Fi):",
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
  server.onPairCode = (c) => {
    const sp = `${c.slice(0, 3)} ${c.slice(3)}`;
    log.info(`New pairing code: ${sp}`);
    try { process.title = `Glidepath Bridge - code ${sp}`; } catch { /* ignore */ }
    writeCodeFile(sp, cfg.port, log);
    pcLink?.codeChanged();
  };
  if (cfg.openBrowser) openAppWindow(`http://localhost:${cfg.port}/app/`);
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

/**
 * Open Glidepath in its own app window, not a browser tab: no tabs, no address bar, its own taskbar entry.
 * Uses Microsoft Edge (part of every Windows 10 and 11) in app mode with its own profile, so it never mixes
 * with your normal browser and the connection is remembered. Falls back to Chrome, then the default browser.
 */
function openAppWindow(url: string): void {
  if (platform() !== "win32") return openInBrowser(url);
  const pf = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const candidates = [
    ...pf.map((d) => join(d, "Microsoft", "Edge", "Application", "msedge.exe")),
    ...pf.map((d) => join(d, "Google", "Chrome", "Application", "chrome.exe")),
  ];
  const exe = candidates.find((p) => { try { return existsSync(p); } catch { return false; } });
  if (!exe) return openInBrowser(url);
  const profile = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? ".", "Glidepath", "Window");
  try {
    const child = spawn(exe, [`--app=${url}`, `--user-data-dir=${profile}`, "--window-size=1320,880", "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => openInBrowser(url));
    child.unref();
  } catch { openInBrowser(url); }
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
