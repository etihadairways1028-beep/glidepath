import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";

export const BRIDGE_VERSION = "1.1.0";

export type AdapterChoice = "auto" | "msfs" | "replay";

export interface BridgeConfig {
  port: number;
  host: string;
  dataDir: string;
  adapter: AdapterChoice;
  replayFile: string | null;
  replaySpeed: number;
  /** Max frames per second streamed to each client. */
  streamHz: number;
  /** SimConnect: deliver data every N sim frames. */
  simconnectInterval: number;
  mdns: boolean;
  /** HTTPS on port+1 so the Glidepath website can reach this PC. */
  secureLink: boolean;
  /** Open the status page in the default browser on start. */
  openBrowser: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface BridgeIdentity {
  bridgeId: string;
  /** Local pairing token. Stage 3 replaces this with account-based device pairing. */
  pairingToken: string;
  createdAt: string;
}

function defaultDataDir(): string {
  if (process.env.GLIDEPATH_DATA_DIR) return process.env.GLIDEPATH_DATA_DIR;
  if (platform() === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Glidepath", "Bridge");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Glidepath Bridge");
  return join(homedir(), ".glidepath-bridge");
}

/** Parse `--key value` / `--flag` arguments. Unknown keys are rejected with a clear message. */
export function loadConfig(argv = process.argv.slice(2)): BridgeConfig {
  const cfg: BridgeConfig = {
    port: Number(process.env.GLIDEPATH_PORT ?? 4810),
    host: process.env.GLIDEPATH_HOST ?? "0.0.0.0",
    dataDir: defaultDataDir(),
    adapter: "auto",
    replayFile: null,
    replaySpeed: 1,
    streamHz: 5,
    simconnectInterval: 3,
    mdns: true,
    secureLink: true,
    openBrowser: true,
    logLevel: "info",
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    const val = argv[i + 1];
    const need = () => {
      if (val === undefined) throw new Error(`Missing value for ${key}`);
      i++;
      return val;
    };
    switch (key) {
      case "--port": cfg.port = Number(need()); break;
      case "--host": cfg.host = need(); break;
      case "--data-dir": cfg.dataDir = need(); break;
      case "--no-secure-link": cfg.secureLink = false; break;
      case "--adapter": {
        const a = need();
        if (a !== "auto" && a !== "msfs" && a !== "replay") throw new Error(`--adapter must be auto, msfs or replay (got ${a})`);
        cfg.adapter = a;
        break;
      }
      case "--replay": cfg.replayFile = need(); break;
      case "--speed": cfg.replaySpeed = Math.max(0.1, Number(need())); break;
      case "--stream-hz": cfg.streamHz = Math.min(20, Math.max(1, Number(need()))); break;
      case "--simconnect-interval": cfg.simconnectInterval = Math.max(1, Number(need())); break;
      case "--no-mdns": cfg.mdns = false; break;
      case "--no-open": cfg.openBrowser = false; break;
      case "--debug": cfg.logLevel = "debug"; break;
      case "--help":
        console.log(HELP);
        process.exit(0);
      default:
        throw new Error(`Unknown option ${key}. Run with --help.`);
    }
  }
  if (cfg.adapter === "replay" && !cfg.replayFile) throw new Error("--adapter replay needs --replay <file.ndjson>");
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error(`Invalid port ${cfg.port}`);
  mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}

export function loadIdentity(dataDir: string): BridgeIdentity {
  const file = join(dataDir, "bridge.json");
  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as BridgeIdentity;
    if (parsed.bridgeId && parsed.pairingToken) return parsed;
  }
  const id: BridgeIdentity = {
    bridgeId: randomUUID(),
    pairingToken: randomBytes(24).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(id, null, 2), { mode: 0o600 });
  return id;
}

export const HOSTNAME = hostname();

const HELP = `Glidepath Bridge ${BRIDGE_VERSION}

Usage: glidepath-bridge [options]

  --adapter auto|msfs|replay   Simulator source (default auto = MSFS via SimConnect)
  --replay <file.ndjson>       Recorded/synthetic flight to replay (marked as REPLAY to clients)
  --speed <n>                  Replay speed multiplier (default 1)
  --port <n>                   LAN port (default 4810)
  --host <addr>                Bind address (default 0.0.0.0)
  --data-dir <path>            Where flights and logs are stored
  --stream-hz <n>              Max frames/s per client (default 5)
  --simconnect-interval <n>    SimConnect delivery every N sim frames (default 3)
  --no-mdns                    Do not advertise on the local network
  --debug                      Verbose logging
  --probe                      Test the MSFS connection for 15 s and write msfs-probe-report.json
`;
