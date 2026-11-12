/**
 * Discord status: shows what you're flying on your Discord profile, through the
 * Discord app running on this PC (its local "Rich Presence" connection; nothing
 * goes over the internet from here, and no Discord login is needed).
 *
 * Discord needs an Application ID to show a status. It's a public number, not a
 * secret: make a free application called "Glidepath" in the Discord Developer
 * Portal and paste its ID in Glidepath (Settings → Discord status).
 */
import { connect, type Socket } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FlightPhase, FlightSummary, TelemetryFrame } from "@glidepath/protocol";
import type { Logger } from "./log.js";

export interface DiscordConfig { enabled: boolean; clientId: string }
export interface DiscordStatus extends DiscordConfig { state: "off" | "needs-id" | "connecting" | "no-discord" | "on"; message: string; user: string | null }
export interface Activity {
  details?: string; state?: string;
  timestamps?: { start?: number };
  assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  buttons?: Array<{ label: string; url: string }>;
}

const OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2;

export function encode(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const head = Buffer.alloc(8); head.writeUInt32LE(op, 0); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Split a stream into Discord IPC packets. */
export class Decoder {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): Array<{ op: number; data: Record<string, unknown> }> {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: Array<{ op: number; data: Record<string, unknown> }> = [];
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0), len = this.buf.readUInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(this.buf.subarray(8, 8 + len).toString("utf8")); } catch { /* ignore */ }
      out.push({ op, data });
      this.buf = this.buf.subarray(8 + len);
    }
    return out;
  }
}

export function ipcPath(i: number): string {
  if (process.platform === "win32") return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  return join(dir.replace(/\/$/, ""), `discord-ipc-${i}`);
}

const PHASE: Record<string, string> = {
  PREFLIGHT: "At the gate", PUSHBACK: "Pushing back", TAXI_OUT: "Taxiing out", TAKEOFF: "Taking off", CLIMB: "Climbing",
  CRUISE: "Cruising", DESCENT: "Descending", APPROACH: "On approach", LANDING: "Landing", TAXI_IN: "Taxiing in", COMPLETED: "Parked",
};

/** What to show for a flight. Pure, so it's easy to test. */
export function activityFor(flight: FlightSummary | null, frame: TelemetryFrame | null, phase: FlightPhase): Activity | null {
  if (!frame && !flight) return null;
  const dep = flight?.departureIcao ?? flight?.plan?.origin?.icao ?? null;
  const arr = flight?.plan?.destination?.icao ?? flight?.arrivalIcao ?? null;
  const type = flight?.aircraft?.icaoType ?? flight?.plan?.aircraftIcao ?? null;
  const route = dep || arr ? `${dep ?? "····"} → ${arr ?? "····"}` : "Free flight";
  const alt = frame?.position.altMslFt;
  const level = frame && !frame.position.onGround && alt != null ? (alt >= 18000 ? `FL${String(Math.round(alt / 100)).padStart(3, "0")}` : `${Math.round(alt / 100) * 100} ft`) : null;
  const gs = frame?.speed.gsKt != null && !frame.position.onGround ? `${Math.round(frame.speed.gsKt)} kt` : null;
  let state = PHASE[phase] ?? "Flying";
  if (level) state += ` at ${level}`;
  if (gs && (phase === "CRUISE" || phase === "CLIMB" || phase === "DESCENT")) state += `, ${gs}`;
  if (phase === "COMPLETED" && flight?.landings.at(-1)) {
    const l = flight.landings.at(-1)!;
    state = `Landed${l.touchdownVsFpm != null ? ` at ${Math.round(Math.abs(l.touchdownVsFpm))} fpm` : ""}${l.grade ? `, grade ${l.grade}` : ""}`;
  }
  const callsign = flight?.plan?.callsign ?? flight?.callsign ?? null;
  return {
    details: [route, type].filter(Boolean).join(" · ").slice(0, 128),
    state: (callsign ? `${callsign} · ${state}` : state).slice(0, 128),
    timestamps: flight?.offBlockAt ?? flight?.startedAt ? { start: flight!.offBlockAt ?? flight!.startedAt } : undefined,
    assets: { large_image: "glidepath", large_text: "Glidepath for MSFS" },
    buttons: [{ label: "Get Glidepath (free)", url: "https://glidepath-ad9.pages.dev" }],
  };
}

export class DiscordPresence {
  private cfg: DiscordConfig = { enabled: false, clientId: "" };
  private readonly file: string;
  private sock: Socket | null = null;
  private ready = false;
  private state: DiscordStatus["state"] = "off";
  private message = "Off";
  private user: string | null = null;
  private retry: NodeJS.Timeout | null = null;
  private last: Activity | null = null;
  private lastKey = "";
  private lastSent = 0;
  private pendingTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, private readonly log: Logger, private readonly path: (i: number) => string = ipcPath) {
    this.file = join(dataDir, "discord.json");
    try { if (existsSync(this.file)) this.cfg = { ...this.cfg, ...JSON.parse(readFileSync(this.file, "utf8")) }; } catch { /* defaults */ }
  }

  status(): DiscordStatus { return { ...this.cfg, state: this.state, message: this.message, user: this.user }; }

  setConfig(p: Partial<DiscordConfig>): DiscordStatus {
    const id = typeof p.clientId === "string" ? p.clientId.trim() : this.cfg.clientId;
    if (id && !/^\d{15,22}$/.test(id)) throw new Error("A Discord Application ID is a long number, like 1234567890123456789.");
    const next = { enabled: typeof p.enabled === "boolean" ? p.enabled : this.cfg.enabled, clientId: id };
    const changedId = next.clientId !== this.cfg.clientId;
    this.cfg = next;
    try { writeFileSync(this.file, JSON.stringify(next, null, 2)); } catch (e) { this.log.warn("Couldn't save Discord settings", e); }
    if (changedId || !next.enabled) this.disconnect();
    this.start();
    return this.status();
  }

  start(): void {
    if (!this.cfg.enabled) { this.set("off", "Off"); return; }
    if (!this.cfg.clientId) { this.set("needs-id", "Add your Discord Application ID to turn this on."); return; }
    if (this.sock || this.retry) return;
    void this.connect(0);
  }

  private set(state: DiscordStatus["state"], message: string) { this.state = state; this.message = message; }

  private async connect(i: number): Promise<void> {
    if (i > 9) { this.set("no-discord", "Discord isn't running on this PC. Open the Discord app and it connects by itself."); this.later(); return; }
    this.set("connecting", "Connecting to Discord…");
    const s = connect(this.path(i));
    const dec = new Decoder();
    let opened = false;
    s.once("connect", () => { opened = true; this.sock = s; s.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.cfg.clientId })); });
    s.on("data", (chunk: Buffer) => {
      for (const { op, data } of dec.push(chunk)) {
        if (op === OP_FRAME && data.evt === "READY") {
          this.ready = true;
          const u = (data.data as { user?: { username?: string; global_name?: string } } | undefined)?.user;
          this.user = u?.global_name ?? u?.username ?? null;
          this.set("on", this.user ? `Showing on ${this.user}'s Discord.` : "Showing on your Discord.");
          this.log.info("Discord status connected");
          if (this.last) this.send(this.last, true);
        } else if (op === OP_FRAME && data.evt === "ERROR") {
          const m = String((data.data as { message?: string } | undefined)?.message ?? "Discord said no.");
          this.set("needs-id", /client/i.test(m) ? "Discord didn't accept that Application ID. Check it in the Developer Portal." : m);
        } else if (op === OP_CLOSE) {
          const m = String(data.message ?? "");
          this.set("needs-id", /client/i.test(m) ? "Discord didn't accept that Application ID. Check it in the Developer Portal." : `Discord closed the connection${m ? `: ${m}` : ""}.`);
          s.destroy();
        }
      }
    });
    s.on("error", () => { if (!opened) { s.destroy(); void this.connect(i + 1); } });
    s.on("close", () => {
      if (!opened) return;
      this.sock = null; this.ready = false;
      if (this.cfg.enabled && this.state !== "needs-id") { this.set("no-discord", "Discord closed. Reconnecting when it's back."); this.later(); }
    });
  }

  private later() { if (this.retry) return; this.retry = setTimeout(() => { this.retry = null; this.start(); }, 30_000); }

  private disconnect() {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    try { this.sock?.destroy(); } catch { /* ignore */ }
    this.sock = null; this.ready = false; this.user = null;
  }

  /** Show (or clear, with null) an activity. Discord allows about 5 updates per 20 s, so changes are spaced out. */
  update(a: Activity | null): void {
    const key = JSON.stringify(a ? { ...a, timestamps: undefined } : null);
    this.last = a;
    if (key === this.lastKey || !this.ready) return;
    const wait = 15_000 - (Date.now() - this.lastSent);
    if (wait > 0) { if (!this.pendingTimer) this.pendingTimer = setTimeout(() => { this.pendingTimer = null; if (this.last) this.send(this.last); }, wait); return; }
    this.send(a);
  }

  private send(a: Activity | null, force = false) {
    if (!this.sock || !this.ready) return;
    const key = JSON.stringify(a ? { ...a, timestamps: undefined } : null);
    if (!force && key === this.lastKey) return;
    this.lastKey = key; this.lastSent = Date.now();
    this.sock.write(encode(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: a ?? undefined }, nonce: randomUUID() }));
  }

  stop(): void { this.cfg.enabled = false; this.disconnect(); }
}
