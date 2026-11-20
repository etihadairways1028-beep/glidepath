/**
 * The flight plan loaded in Microsoft Flight Simulator. The sim writes the active plan to a
 * .PLN file (CUSTOMFLIGHT.PLN) when you set one up in the world map, and reports plans it
 * activates. Glidepath only reads these files; it never asks the simulator for anything here.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parsePln, type FlightPlan } from "@glidepath/protocol";
import type { Logger } from "./log.js";

/** Where MSFS 2020 and 2024 (Microsoft Store and Steam) keep the custom flight's plan. */
export function planFileCandidates(env = process.env): string[] {
  const local = env.LOCALAPPDATA, roam = env.APPDATA;
  const out: string[] = [];
  const tail = ["MISSIONS", "Custom", "CustomFlight", "CUSTOMFLIGHT.PLN"];
  if (local) {
    out.push(join(local, "Packages", "Microsoft.FlightSimulator_8wekyb3d8bbwe", "LocalState", ...tail));
    out.push(join(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalState", ...tail));
  }
  if (roam) {
    out.push(join(roam, "Microsoft Flight Simulator", ...tail));
    out.push(join(roam, "Microsoft Flight Simulator 2024", ...tail));
  }
  return out;
}

export class SimPlanWatcher {
  private seen = new Map<string, number>();
  private extra: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  onPlan: ((plan: FlightPlan, file: string) => void) | null = null;
  constructor(private log: Logger, private files = planFileCandidates()) {}

  /** A plan file the simulator just reported (FlightPlanActivated). */
  reported(file: string): void {
    if (!/\.pln$/i.test(file)) return;
    this.extra = file;
    this.seen.delete(file);
    this.check();
  }

  start(): void {
    this.check(true);
    this.timer = setInterval(() => this.check(), 15_000);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private check(first = false): void {
    let best: { file: string; at: number } | null = null;
    for (const f of this.extra ? [this.extra, ...this.files] : this.files) {
      try {
        if (!existsSync(f)) continue;
        const at = statSync(f).mtimeMs;
        const was = this.seen.get(f);
        this.seen.set(f, at);
        if (was === at) continue;
        // On start, only pick up a plan saved in the last 12 hours.
        if (first && Date.now() - at > 12 * 3600_000) continue;
        if (!best || at > best.at) best = { file: f, at };
      } catch { /* unreadable: skip */ }
    }
    if (!best) return;
    try {
      const plan = parsePln(readFileSync(best.file, "utf8"));
      this.log.info(`Flight plan from the simulator: ${plan.origin.icao} to ${plan.destination.icao}, ${plan.fixes.length} waypoints`);
      this.onPlan?.(plan, best.file);
    } catch (e) { this.log.debug("Couldn't read the simulator's flight plan", (e as Error).message); }
  }
}
