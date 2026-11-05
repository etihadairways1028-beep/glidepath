/**
 * Small rotating logger: one file per day in <dataDir>/logs, 7 days kept.
 * Logs stay on the user's PC; nothing is uploaded.
 */
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(scope: string): Logger;
  /** Most recent lines, for the diagnostics page. */
  recent(): string[];
}

export function createLogger(dataDir: string, level: Level): Logger {
  const dir = join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  try {
    const files = readdirSync(dir).filter((f) => f.startsWith("bridge-") && f.endsWith(".log")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 7))) unlinkSync(join(dir, f));
  } catch {
    /* best effort */
  }
  const ring: string[] = [];

  const write = (lvl: Level, scope: string, msg: string, data?: unknown) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const ts = new Date().toISOString();
    let extra = "";
    if (data !== undefined) {
      try {
        extra = " " + (data instanceof Error ? `${data.name}: ${data.message}` : JSON.stringify(data));
      } catch {
        extra = " [unserialisable]";
      }
    }
    const line = `${ts} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${msg}${extra}`;
    ring.push(line);
    if (ring.length > 300) ring.shift();
    (lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log)(line);
    try {
      appendFileSync(join(dir, `bridge-${ts.slice(0, 10)}.log`), line + "\n");
    } catch {
      /* disk full or locked: console still has it */
    }
  };

  const make = (scope: string): Logger => ({
    debug: (m, d) => write("debug", scope, m, d),
    info: (m, d) => write("info", scope, m, d),
    warn: (m, d) => write("warn", scope, m, d),
    error: (m, d) => write("error", scope, m, d),
    child: (s) => make(`${scope}:${s}`),
    recent: () => [...ring],
  });
  return make("bridge");
}
