/**
 * LAN server: HTTP (status page, live page, REST) + WebSocket stream.
 *
 * Security model for Stage 1:
 *  - Every API and WebSocket request needs the Bridge's pairing token,
 *    compared in constant time. Requests from this PC (localhost) may read
 *    the status page, which displays the token so the user can pair.
 *  - Nothing listens on the public internet: the PC's firewall/router keeps
 *    port 4810 on the local network. Remote access will go through an
 *    outbound-only relay (Stage 5), never through port forwarding.
 *  - Stage 3 replaces the shared token with per-device tokens tied to the
 *    user's account, revocable from Settings.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { announce, secureHost, startSecure } from "./secure.js";
import { addonStatus } from "./addons.js";
import { networkInterfaces } from "node:os";
import { randomInt, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { Bonjour } from "bonjour-service";
import {
  ClientMessage, PROTOCOL_VERSION,
  type BridgeStatus, type FlightPhase, type ServerMessage, type TelemetryFrame,
} from "@glidepath/protocol";
import type { BridgeConfig, BridgeIdentity } from "./config.js";
import type { Logger } from "./log.js";
import type { Recorder } from "./recorder.js";
import type { FlightSession } from "./session.js";
import { livePage, liveRedirectPage, pairPage, statusPage } from "./pages.js";
import { HttpError, type AiConfig, type AiService, type ChatMessage } from "./ai.js";
import type { ExternalData } from "./external.js";
import type { AirportDb } from "@glidepath/aviation-data";
import { appAsset } from "./assets.js";
import { commandDone, planCommand, type Capability } from "./remote.js";
import type { SimAdapter } from "./adapters/types.js";

/** Websites allowed to call this Bridge from a browser (the hosted Glidepath app). */
const ALLOWED_ORIGINS = [/^https:\/\/etihadairways1028-beep\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

interface Client {
  ws: WebSocket;
  name: string;
  lastFrameSent: number;
  queued: { frame: TelemetryFrame; phase: FlightPhase } | null;
  /** Messages per 10 s window, for rate limiting. */
  msgCount: number;
  /** Short random id, used to route camera signalling. */
  id: string;
}

export class LanServer {
  private clients = new Set<Client>();
  private http = createServer((req, res) => this.route(req, res));
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private bonjour: Bonjour | null = null;
  /** Six-digit code shown on the PC; typing it on an iPad hands over the pairing key. */
  readonly pairCode = newPairCode();
  private pairFails = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private rateTimer: NodeJS.Timeout | null = null;
  private readonly log: Logger;

  constructor(
    private readonly cfg: BridgeConfig,
    private readonly identity: BridgeIdentity,
    private readonly session: FlightSession,
    private readonly recorder: Recorder,
    private readonly getStatus: () => BridgeStatus,
    log: Logger,
    private readonly external: ExternalData | null = null,
    private readonly airports: AirportDb | null = null,
    private readonly ai: AiService | null = null,
  ) {
    this.log = log.child("lan");
    this.http.on("upgrade", this.onUpgrade);
  }

  /** Secure (https) address for this PC, when the secure link is running. */
  secureUrl: string | null = null;
  private secure: import("node:https").Server | null = null;
  private announceTimer?: NodeJS.Timeout;

  private onUpgrade = (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname !== "/ws" || !this.tokenOk(url.searchParams.get("token"))) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, url.searchParams.get("client") ?? "unknown"));
  };

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.cfg.port, this.cfg.host, () => resolve());
    });
    this.log.info(`Listening on ${this.cfg.host}:${this.cfg.port}`);
    for (const ip of lanAddresses()) this.log.info(`  LAN address: http://${ip}:${this.cfg.port}`);
    if (this.cfg.mdns) {
      try {
        this.bonjour = new Bonjour();
        this.bonjour.publish({
          name: `Glidepath Bridge ${this.identity.bridgeId.slice(0, 6)}`,
          type: "glidepath",
          port: this.cfg.port,
          txt: { id: this.identity.bridgeId, pv: String(PROTOCOL_VERSION) },
        });
        // Lets an iPad on the same Wi-Fi open http://glidepath.local:4810 instead of the PC's numbers.
        this.bonjour.publish({ name: "Glidepath", type: "http", port: this.cfg.port, host: "glidepath.local" });
        this.log.info("Advertising _glidepath._tcp on the local network");
      } catch (e) {
        this.log.warn("mDNS advertising failed; apps can still connect by address", e);
      }
    }
    // Secure link so the Glidepath website (https) can reach this PC too.
    const ip = lanAddresses()[0];
    if (ip && this.cfg.secureLink !== false) {
      const port = this.cfg.port + 1;
      void startSecure({ dataDir: this.cfg.dataDir, host: this.cfg.host, port, log: this.log, handler: (req, res) => this.route(req, res), upgrade: this.onUpgrade }).then((srv) => {
        if (!srv) return;
        this.secure = srv;
        const host = secureHost(ip);
        this.secureUrl = `https://${host}:${port}`;
        this.log.info(`Secure address: ${this.secureUrl}`);
        const post = () => void announce(this.pairCode, host, port, this.log);
        post();
        this.announceTimer = setInterval(post, 30 * 60_000);
      });
    }
    // Frames are throttled per client: the newest frame wins, sent at streamHz.
    this.flushTimer = setInterval(() => this.flushFrames(), 1000 / this.cfg.streamHz);
    this.rateTimer = setInterval(() => this.clients.forEach((c) => (c.msgCount = 0)), 10_000);

    this.session.on("frame", (frame: TelemetryFrame, phase: FlightPhase) => {
      for (const c of this.clients) c.queued = { frame, phase };
    });
    this.session.on("event", (event) => this.broadcast({ type: "event", event }));
    this.session.on("landing", (landing) => this.broadcast({ type: "landing", landing }));
    this.session.on("flight", (flight) => this.broadcast({ type: "flight", flight }));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcastStatus(): void {
    this.broadcast({ type: "status", status: this.getStatus() });
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.secure?.close();
    if (this.rateTimer) clearInterval(this.rateTimer);
    for (const c of this.clients) c.ws.close(1001, "Bridge shutting down");
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
    await new Promise<void>((r) => this.http.close(() => r()));
  }

  /* ---------------- WebSocket ---------------- */

  private onConnection(ws: WebSocket, name: string): void {
    const client: Client = { ws, name: name.slice(0, 64), lastFrameSent: 0, queued: null, msgCount: 0, id: randomInt(1e9, 9e9).toString(36) };
    this.clients.add(client);
    this.log.info(`Client connected: ${client.name} (${this.clients.size} total)`);
    this.send(client, { type: "welcome", status: this.getStatus(), flight: this.session.activeFlight });
    this.send(client, { type: "rtc", kind: "host-state", live: !!this.cameraHost });

    ws.on("message", (data) => {
      if (++client.msgCount > 240) {
        this.send(client, { type: "error", code: "rate_limited", message: "Too many messages" });
        return;
      }
      let msg: ClientMessage;
      try {
        msg = ClientMessage.parse(JSON.parse(String(data)));
      } catch {
        this.send(client, { type: "error", code: "bad_message", message: "Message did not match the protocol" });
        return;
      }
      this.onMessage(client, msg);
    });
    ws.on("close", () => {
      this.clients.delete(client);
      if (this.cameraHost === client) { this.cameraHost = null; this.broadcast({ type: "rtc", kind: "host-state", live: false }); }
      else if (this.cameraHost) this.send(this.cameraHost, { type: "rtc", kind: "leave", from: client.id });
      this.log.info(`Client disconnected: ${client.name} (${this.clients.size} left)`);
    });
    ws.on("error", (e) => this.log.warn(`Client ${client.name} error`, e.message));
  }

  private onMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.send(client, { type: "error", code: "protocol_mismatch", message: `Bridge speaks protocol v${PROTOCOL_VERSION}; please update the app` });
        }
        if (msg.lastSeq !== null) this.backfill(client, msg.lastSeq);
        break;
      case "resume":
        this.backfill(client, msg.fromSeq);
        break;
      case "ping":
        this.send(client, { type: "pong", t: msg.t });
        break;
      case "command":
        this.runCommand(client, msg);
        break;
      case "rtc":
        this.onRtc(client, msg);
        break;
    }
  }

  /* ---------- Live camera (WebRTC signalling only) ---------- */
  private cameraHost: Client | null = null;
  private onRtc(client: Client, msg: Extract<ClientMessage, { type: "rtc" }>): void {
    switch (msg.kind) {
      case "host-on":
        this.cameraHost = client;
        this.log.info(`Live camera shared from ${client.name}`);
        this.broadcast({ type: "rtc", kind: "host-state", live: true });
        break;
      case "host-off":
        if (this.cameraHost === client) { this.cameraHost = null; this.broadcast({ type: "rtc", kind: "host-state", live: false }); }
        break;
      case "watch":
        if (this.cameraHost) this.send(this.cameraHost, { type: "rtc", kind: "watch", from: client.id });
        else this.send(client, { type: "rtc", kind: "host-state", live: false });
        break;
      case "leave":
        if (this.cameraHost && this.cameraHost !== client) this.send(this.cameraHost, { type: "rtc", kind: "leave", from: client.id });
        break;
      case "signal": {
        const to = client === this.cameraHost ? [...this.clients].find((c) => c.id === msg.to) : this.cameraHost;
        if (to) this.send(to, { type: "rtc", kind: "signal", from: client.id, data: msg.data });
        break;
      }
    }
  }

  /* ---------- Remote control ---------- */
  private remoteAdapter: SimAdapter | null = null;
  private lastFrame: TelemetryFrame | null = null;
  private waiting: Array<{ client: Client; id: string; cap: Capability; value: number | boolean | null; until: number }> = [];

  /** Give the server the adapter, so the app can send commands to the sim. */
  setRemote(adapter: SimAdapter): void {
    this.remoteAdapter = adapter;
    adapter.on("frame", (f) => {
      this.lastFrame = { ...f, seq: 0 } as TelemetryFrame;
      if (!this.waiting.length) return;
      const now = Date.now();
      this.waiting = this.waiting.filter((w) => {
        if (commandDone(w.cap, w.value, this.lastFrame!)) { this.send(w.client, { type: "commandState", id: w.id, state: "confirmed", detail: null }); return false; }
        if (now > w.until) { this.send(w.client, { type: "commandState", id: w.id, state: "timeout", detail: `Sent to the sim, but ${w.cap.label.toLowerCase()} didn't change. This aircraft may use its own systems for it.` }); return false; }
        return true;
      });
    });
  }

  private runCommand(client: Client, msg: Extract<ClientMessage, { type: "command" }>): void {
    const a = this.remoteAdapter;
    if (!a?.command) { this.send(client, { type: "commandState", id: msg.id, state: "unsupported", detail: "Remote control works with Microsoft Flight Simulator, not the demo replay." }); return; }
    const plan = planCommand(msg.capability, msg.value, msg.confirmed, this.lastFrame);
    if (!plan.ok) { this.send(client, { type: "commandState", id: msg.id, state: plan.state, detail: plan.detail }); return; }
    if (plan.already) { this.send(client, { type: "commandState", id: msg.id, state: "confirmed", detail: "Already set." }); return; }
    const err = a.command(plan.steps);
    if (err) { this.send(client, { type: "commandState", id: msg.id, state: "rejected", detail: err }); return; }
    this.log.info(`Remote: ${plan.cap.label}${msg.value !== null ? ` → ${String(msg.value)}` : ""}`);
    this.send(client, { type: "commandState", id: msg.id, state: "pending", detail: null });
    this.waiting.push({ client, id: msg.id, cap: plan.cap, value: msg.value, until: Date.now() + 4000 });
    // If frames stop (paused, disconnected), still answer.
    setTimeout(() => {
      const w = this.waiting.find((x) => x.id === msg.id);
      if (!w) return;
      this.waiting = this.waiting.filter((x) => x !== w);
      this.send(client, { type: "commandState", id: msg.id, state: commandDone(w.cap, w.value, this.lastFrame ?? ({} as TelemetryFrame)) ? "confirmed" : "timeout", detail: "No reply from the sim in time." });
    }, 5000);
  }

  /** Send every frame after `seq`, in chunks, from memory or disk. */
  private backfill(client: Client, seq: number): void {
    let from = seq;
    for (let i = 0; i < 50; i++) {
      const frames = this.session.framesAfter(from, 500);
      const complete = frames.length < 500;
      if (frames.length) this.send(client, { type: "backfill", frames, complete });
      if (complete) {
        if (!frames.length) this.send(client, { type: "backfill", frames: [], complete: true });
        return;
      }
      from = frames[frames.length - 1]!.seq;
    }
  }

  private flushFrames(): void {
    for (const c of this.clients) {
      if (!c.queued) continue;
      // Back-pressure: skip a frame rather than queue megabytes for a slow client.
      if (c.ws.bufferedAmount > 1_000_000) continue;
      this.send(c, { type: "frame", frame: c.queued.frame, phase: c.queued.phase });
      c.queued = null;
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients) this.send(c, msg);
  }

  private send(c: Client, msg: ServerMessage): void {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  /* ---------------- HTTP ---------------- */

  private route(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://x");
    const local = isLocal(req);
    const origin = req.headers.origin;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (origin && ALLOWED_ORIGINS.some((r) => r.test(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // Chrome's Private Network Access: lets the hosted app reach this Bridge on localhost.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    // A request from the hosted app on this PC must still carry the token: being "local" is not enough when a website made the request.
    const fromWebsite = !!origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && origin !== `http://${req.headers.host}`;
    const authed = (local && !fromWebsite) || this.tokenOk(url.searchParams.get("token") ?? bearer(req));
    void this.handle(req, res, url, local, authed).catch((e) => {
      this.log.error(`HTTP ${url.pathname} failed`, e);
      if (!res.headersSent) json(res, 500, { error: "Internal error" });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse, url: URL, local: boolean, authed: boolean): Promise<void> {
    const p = url.pathname;
    const POSTS = ["/api/plan", "/api/ai/config", "/api/ai/chat", "/api/pair"];
    if (req.method !== "GET" && !(req.method === "POST" && POSTS.includes(p))) return text(res, 405, "Method not allowed");
    if (p === "/") {
      if (!local) return html(res, pairPage());
      return html(res, statusPage({ local, pairCode: this.pairCode, status: this.getStatus(), token: local ? this.identity.pairingToken : null, addresses: lanAddresses(), port: this.cfg.port, logs: local ? this.log.recent().slice(-60) : [] }));
    }
    if (p === "/api/pair" && req.method === "POST") {
      if (this.pairFails >= 10) return json(res, 429, { error: "Too many wrong codes. Restart the Bridge on your PC for a new code." });
      const body = (await readBody(req, 500)) as { code?: unknown };
      const code = String(body?.code ?? "").replace(/\D/g, "");
      if (code.length === 6 && code === this.pairCode) {
        this.log.info(`Paired a device by code (${req.socket.remoteAddress ?? "?"})`);
        return json(res, 200, { token: this.identity.pairingToken });
      }
      this.pairFails++;
      this.log.warn(`Wrong pairing code from ${req.socket.remoteAddress ?? "?"}`);
      return json(res, 403, { error: "That code doesn't match. Check the code on your PC." });
    }
    if (p === "/live") return html(res, liveRedirectPage());
    if (p === "/lite") return html(res, livePage());
    if (p === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (p === "/healthz") return json(res, 200, { ok: true, bridgeId: this.identity.bridgeId, protocolVersion: PROTOCOL_VERSION });
    if (p === "/app") { res.writeHead(302, { Location: "/app/" }); res.end(); return; }
    if (p.startsWith("/app/")) return this.serveApp(res, p.slice(5) || "index.html");
    if (!authed) return json(res, 401, { error: "Pairing token required" });

    if (p === "/api/status") return json(res, 200, this.getStatus());
    if (p === "/api/addons") {
      const extra = (url.searchParams.get("extra") ?? "").split(",").map(Number).filter(Boolean).slice(0, 6);
      return json(res, 200, await addonStatus(lanAddresses(), extra));
    }
    if (p === "/api/lan") return json(res, 200, { bridgeId: this.identity.bridgeId, addresses: lanAddresses(), port: this.cfg.port });
    if (p === "/api/flight") return json(res, 200, this.session.activeFlight);
    if (p === "/api/flights") return json(res, 200, this.recorder.listFlights(Number(url.searchParams.get("limit") ?? 50)));
    const m = /^\/api\/flights\/([0-9a-f-]{36})(\/frames|\/events)?$/.exec(p);
    if (m) {
      const flight = this.recorder.getFlight(m[1]!);
      if (!flight) return json(res, 404, { error: "Flight not found" });
      if (m[2] === "/frames") return json(res, 200, this.recorder.framesSince(flight.id, Number(url.searchParams.get("after") ?? 0), 20000));
      if (m[2] === "/events") return json(res, 200, this.recorder.events(flight.id));
      return json(res, 200, flight);
    }

    if (p === "/api/plan" && req.method === "POST") {
      if (!this.external) return json(res, 503, { error: "External data is disabled" });
      const body = await readBody(req);
      const user = String((body as { user?: unknown }).user ?? "");
      try {
        const plan = await this.external.simbrief(user);
        this.session.setPlan(plan);
        return json(res, 200, plan);
      } catch (e) {
        return json(res, 502, { error: (e as Error).message });
      }
    }
    if (p.startsWith("/api/ai/")) {
      if (!this.ai) return json(res, 503, { error: "AI is disabled" });
      try {
        if (p === "/api/ai/status") return json(res, 200, await this.ai.status());
        if (p === "/api/ai/config" && req.method === "POST") {
          this.ai.setConfig((await readBody(req, 4_000)) as Partial<AiConfig>);
          return json(res, 200, await this.ai.status());
        }
        if (p === "/api/ai/chat" && req.method === "POST") {
          const body = (await readBody(req, 64_000)) as { messages?: ChatMessage[]; facts?: unknown };
          return await this.ai.chat(Array.isArray(body.messages) ? body.messages : [], body.facts, res);
        }
      } catch (e) {
        if (res.headersSent) { res.end(); return; }
        return json(res, e instanceof HttpError ? e.status : 400, { error: (e as Error).message });
      }
      return json(res, 404, { error: "Not found" });
    }
    if (p.startsWith("/api/ext/")) {
      if (!this.external) return json(res, 503, { error: "External data is disabled" });
      const ids = (url.searchParams.get("ids") ?? "").split(",");
      try {
        switch (p) {
          case "/api/ext/vatsim": return json(res, 200, await this.external.vatsim());
          case "/api/ext/ivao": return json(res, 200, await this.external.ivao());
          case "/api/ext/stands": {
            const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: "lat and lon required" });
            return json(res, 200, await this.external.stands(lat, lon));
          }
          case "/api/ext/sayintentions": return json(res, 200, await this.external.sayintentions());
          case "/api/ext/metar": return json(res, 200, await this.external.metar(ids));
          case "/api/ext/metarbox": return json(res, 200, await this.external.metarBox(url.searchParams.get("bbox") ?? ""));
          case "/api/ext/taf": return json(res, 200, await this.external.taf(ids));
          case "/api/ext/simbrief": return json(res, 200, await this.external.simbrief(url.searchParams.get("user") ?? ""));
        }
      } catch (e) {
        return json(res, 502, { error: (e as Error).message });
      }
      return json(res, 404, { error: "Not found" });
    }
    if (p === "/api/airports/search" && this.airports) return json(res, 200, this.airports.search(url.searchParams.get("q") ?? "", 25));
    const a = /^\/api\/airports\/([A-Za-z0-9]{2,7})$/.exec(p);
    if (a && this.airports) {
      const apt = this.airports.get(a[1]!);
      if (!apt) return json(res, 404, { error: "Airport not found" });
      return json(res, 200, { ...apt, runways: this.airports.runwaysAt(apt.code), frequencies: this.airports.frequencies(apt.code) });
    }
    return json(res, 404, { error: "Not found" });
  }

  private serveApp(res: ServerResponse, path: string): void {
    const clean = path.split("?")[0]!.replace(/\.\.+/g, "").replace(/^\/+/, "");
    let file = appAsset(clean);
    let name = clean;
    if (!file && !/\.[a-z0-9]+$/i.test(clean)) { file = appAsset("index.html"); name = "index.html"; } // SPA fallback
    if (!file) return text(res, 404, "Not found");
    const ext = name.split(".").pop()!.toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": name === "index.html" || name.endsWith(".webmanifest") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(file);
  }

  private tokenOk(token: string | null | undefined): boolean {
    if (!token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.identity.pairingToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/**
 * Addresses an iPad on the same Wi-Fi can reach, best first. Virtual adapters
 * (Hyper-V, WSL, VirtualBox, VPNs) and self-assigned 169.254 addresses are
 * left out: showing those is the usual reason "the link doesn't open".
 */
export function lanAddresses(): string[] {
  const skip = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier|npcap|docker|vbox|hamachi|radmin|vpn|tap-|tun/i;
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  const good: string[] = [], other: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal || ni.address.startsWith("169.254.")) continue;
      (skip.test(name) ? other : good).push(ni.address);
    }
  }
  const pick = good.length ? good : other;
  return [...new Set(pick)].sort((a, b) => rank(a) - rank(b));
}

function newPairCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function isLocal(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", webmanifest: "application/manifest+json", woff2: "font/woff2", ico: "image/x-icon", txt: "text/plain; charset=utf-8",
};
function readBody(req: IncomingMessage, limit = 10_000): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}
function text(res: ServerResponse, code: number, body: string): void {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}
