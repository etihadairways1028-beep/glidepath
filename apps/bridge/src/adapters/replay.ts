/**
 * Replay adapter: plays a recorded or SYNTHETIC flight file (NDJSON of
 * TelemetryFrame). The simulator info is always reported with
 * source "replay" so every client shows a REPLAY/DEMO badge.
 *
 * Timestamps keep the file's own timeline (shifted to start now), so the
 * flight engine sees the same durations as the original flight even when
 * played faster than real time.
 */
import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { TelemetryFrame } from "@glidepath/protocol";
import type { Logger } from "../log.js";
import type { RawFrame, SimAdapter } from "./types.js";

export class ReplayAdapter extends EventEmitter implements SimAdapter {
  readonly id = "replay";
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly log: Logger;

  constructor(private readonly file: string, private readonly speed: number, log: Logger) {
    super();
    this.log = log.child("replay");
  }

  async start(): Promise<void> {
    this.stopped = false;
    const frames = await this.load();
    if (!frames.length) {
      this.emit("state", "error", `No valid frames in ${this.file}`);
      return;
    }
    const name = basename(this.file);
    this.emit("simulator", { id: "replay", name: `Replay: ${name}`, version: null, source: "replay" });
    this.emit("aircraft", {
      title: /SYNTHETIC/i.test(name) ? "Synthetic test aircraft (A320-class)" : "Replayed aircraft",
      icaoType: /SYNTHETIC/i.test(name) ? "A320" : null,
      registration: null, airline: null, engineCount: frames[0]!.engines.length, profileId: "generic",
    });
    this.emit("state", "connected", `Replaying ${name} at ${this.speed}×`);
    this.log.info(`Replaying ${frames.length} frames from ${name} at ${this.speed}×`);

    const fileStart = frames[0]!.t;
    const wallStart = Date.now();
    let i = 0;
    const tick = () => {
      if (this.stopped) return;
      const elapsedFileMs = (Date.now() - wallStart) * this.speed;
      while (i < frames.length && frames[i]!.t - fileStart <= elapsedFileMs) {
        const src = frames[i]!;
        const { seq: _s, ...rest } = src;
        const out: RawFrame = { ...rest, t: wallStart + (src.t - fileStart) };
        this.emit("frame", out);
        i++;
      }
      if (i >= frames.length) {
        this.log.info("Replay finished");
        this.emit("sessionEnd");
        this.emit("state", "disconnected", "Replay finished");
        return;
      }
      this.timer = setTimeout(tick, 20);
    };
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async load(): Promise<TelemetryFrame[]> {
    const frames: TelemetryFrame[] = [];
    const rl = createInterface({ input: createReadStream(this.file, "utf8"), crlfDelay: Infinity });
    let lineNo = 0;
    let bad = 0;
    for await (const line of rl) {
      lineNo++;
      if (!line.trim() || line.startsWith("#")) continue;
      try {
        frames.push(TelemetryFrame.parse(JSON.parse(line)));
      } catch {
        bad++;
        if (bad <= 3) this.log.warn(`Skipping invalid frame on line ${lineNo}`);
      }
    }
    return frames;
  }
}
