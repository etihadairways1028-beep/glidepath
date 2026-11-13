/**
 * Connect anywhere: sign this PC in to a Glidepath account once, and every device
 * signed in to the same account reaches it through the account's relay, on any
 * Wi-Fi or mobile data. No codes, no same-network rules, no router settings.
 *
 * - Signing in: email + password go to the accounts service once, over HTTPS, in
 *   exchange for a key for this PC. The password is never stored; the session
 *   used for it is signed out straight away. Only the key is kept (cloud.json).
 * - The relay only passes messages. Each device that connects gets its own
 *   connection to this Bridge on 127.0.0.1, marked as coming from the relay so
 *   it is treated like a paired iPad (never like someone sitting at this PC).
 * - Only /api/ requests and the live stream are passed on. Live frames go out at
 *   most twice a second per device to stay inside the free plan.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { Logger } from "./log.js";

export const CLOUD_BASES = (process.env.GLIDEPATH_CLOUD ?? "https://glidepath-ad9.pages.dev/acct,https://glidepath-accounts.webeyepagesdev.workers.dev")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

/** Header that marks loopback requests made for the relay (they are never "local"). */
export const RELAY_HEADER = "x-glidepath-relay";

interface Saved { key: string; email: string; name: string | null; base?: string }
export interface CloudLinkStatus { signedIn: boolean; email: string | null; online: boolean; error: string | null; devices: number }

interface Device { local: WebSocket | null; queue: string[]; lastFrame: number; closed: boolean }

const FRAME_GAP_MS = 450;
const CHUNK = 192 * 1024;

export class CloudLink {
  private saved: Saved | null = null;
  private ws: WebSocket | null = null;
  private online = false;
  private error: string | null = null;
  private retry = 2000;
  private timer: NodeJS.Timeout | null = null;
  private beat: NodeJS.Timeout | null = null;
  private alive = true;
  private stopped = false;
  private devices = new Map<string, Device>();
  private readonly file: string;

  constructor(private readonly o: { dataDir: string; port: number; host: string; bridgeId: string; version: string; token: () => string; log: Logger }) {
    this.file = join(o.dataDir, "cloud.json");
    try { if (existsSync(this.file)) this.saved = JSON.parse(readFileSync(this.file, "utf8")) as Saved; } catch { this.saved = null; }
  }

  status(): CloudLinkStatus {
    return { signedIn: !!this.saved, email: this.saved?.email ?? null, online: this.online, error: this.error, devices: this.devices.size };
  }

  start(): void { this.stopped = false; if (this.saved) this.connect(); }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.beat) clearInterval(this.beat);
    this.ws?.terminate(); this.ws = null; this.online = false;
    this.dropDevices();
  }

  private get ua(): string { return `GlidepathBridge/${this.o.version} (${process.platform === "win32" ? "Windows" : process.platform})`; }

  /** Calls the accounts service, trying the website's address first (some networks block workers.dev). */
  private async call<T>(path: string, init: { method?: string; token?: string; body?: unknown }): Promise<{ base: string; status: number; data: T & { error?: string } }> {
    let last: Error | null = null;
    const bases = this.saved?.base ? [this.saved.base, ...CLOUD_BASES.filter((b) => b !== this.saved!.base)] : CLOUD_BASES;
    for (const base of bases) {
      try {
        const r = await fetch(base + path, {
          method: init.method ?? "GET",
          headers: { "User-Agent": this.ua, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 404 && !(r.headers.get("content-type") ?? "").includes("json")) continue;
        return { base, status: r.status, data: (await r.json().catch(() => ({}))) as T & { error?: string } };
      } catch (e) { last = e as Error; }
    }
    throw new Error(last ? "Couldn't reach Glidepath. Check this PC is online." : "Couldn't reach Glidepath.");
  }

  async signIn(email: string, password: string): Promise<CloudLinkStatus> {
    email = String(email ?? "").trim();
    if (!email || !password) throw new Error("Type your email and password.");
    const login = await this.call<{ token?: string }>("/auth/login", { method: "POST", body: { email, password } });
    if (login.status !== 200 || !login.data.token) throw new Error(login.data.error ?? "That email and password don't match an account.");
    const token = login.data.token;
    try {
      const link = await this.call<{ key?: string; user?: { email: string; display_name: string | null } }>("/relay/link", { method: "POST", token, body: { bridge_id: this.o.bridgeId, name: hostname() } });
      if (link.status !== 200 || !link.data.key) throw new Error(link.data.error ?? "Couldn't sign this PC in. Try again in a minute.");
      this.saved = { key: link.data.key, email: link.data.user?.email ?? email, name: link.data.user?.display_name ?? null, base: login.base };
      writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } finally {
      // The password session was only needed to get this PC's key.
      void this.call("/auth/logout", { method: "POST", token }).catch(() => undefined);
    }
    this.o.log.info(`Signed in for Connect anywhere`);
    this.error = null; this.retry = 2000; this.stopped = false;
    this.ws?.terminate();
    this.connect();
    return this.status();
  }

  async signOut(): Promise<CloudLinkStatus> {
    const key = this.saved?.key;
    this.stop();
    this.saved = null; this.error = null;
    try { rmSync(this.file, { force: true }); } catch { /* ignore */ }
    if (key) await this.call("/relay/unlink", { method: "POST", body: { key } }).catch(() => undefined);
    this.o.log.info("Signed out of Connect anywhere");
    return this.status();
  }

  private connect(): void {
    if (this.stopped || !this.saved) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const bases = this.saved.base ? [this.saved.base, ...CLOUD_BASES.filter((b) => b !== this.saved!.base)] : CLOUD_BASES;
    const base = bases[(this.attempt++) % bases.length]!;
    const url = base.replace(/^http/, "ws") + `/relay/bridge?key=${this.saved.key}`;
    const ws = new WebSocket(url, { headers: { "User-Agent": this.ua }, handshakeTimeout: 15_000, maxPayload: 4 * 1024 * 1024 });
    this.ws = ws;
    ws.on("open", () => {
      this.online = true; this.error = null; this.retry = 2000; this.alive = true;
      if (this.saved && this.saved.base !== base) { this.saved.base = base; try { writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 }); } catch { /* ignore */ } }
      this.attempt = 0;
      this.o.log.info("Connect anywhere is on");
      if (this.beat) clearInterval(this.beat);
      // Protocol pings are free on the relay and tell us quickly if the line died.
      this.beat = setInterval(() => {
        if (!this.alive) { ws.terminate(); return; }
        this.alive = false;
        try { ws.ping(); } catch { /* closing */ }
      }, 30_000);
    });
    ws.on("pong", () => { this.alive = true; });
    ws.on("message", (data) => this.fromRelay(String(data)));
    ws.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401) {
        this.error = "This PC was signed out of your account. Sign in again.";
        this.o.log.warn("Connect anywhere: the key was refused; signing out");
        void this.signOut().then(() => { this.error = "This PC was signed out of your account. Sign in again."; });
      } else this.error = `Glidepath answered ${res.statusCode}. Trying again…`;
    });
    ws.on("error", (e) => { if (!this.error) this.o.log.debug("Connect anywhere connection error", String(e)); });
    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      this.online = false;
      if (this.beat) { clearInterval(this.beat); this.beat = null; }
      this.dropDevices();
      if (this.stopped || !this.saved) return;
      if (code === 4000) this.error = "Another PC signed in to this account and took over. Sign in again here to switch back.";
      else if (!this.error) this.error = "Reconnecting…";
      if (code === 4000) return; // don't fight the other PC
      this.timer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 60_000);
    });
  }
  private attempt = 0;

  private sendUp(cid: string, msg: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`${cid}\n${msg}`);
  }

  private dropDevices(): void {
    for (const d of this.devices.values()) { d.closed = true; try { d.local?.close(); } catch { /* ignore */ } }
    this.devices.clear();
  }

  private get localHost(): string { return this.o.host === "0.0.0.0" || this.o.host === "::" || !this.o.host ? "127.0.0.1" : this.o.host; }

  private fromRelay(raw: string): void {
    const i = raw.indexOf("\n");
    if (i < 1) return;
    const cid = raw.slice(0, i), body = raw.slice(i + 1);
    if (!/^[a-z0-9]{1,32}$/i.test(cid)) return;
    if (body.startsWith('{"$"')) {
      let m: { $: string; id?: string; method?: string; path?: string; body?: unknown };
      try { m = JSON.parse(body); } catch { return; }
      if (m.$ === "open") { this.openDevice(cid); return; }
      if (m.$ === "close") { const d = this.devices.get(cid); if (d) { d.closed = true; d.local?.close(); this.devices.delete(cid); } return; }
      if (m.$ === "req" && typeof m.id === "string") { void this.request(cid, m.id, m.method ?? "GET", m.path ?? "", m.body); return; }
      return;
    }
    // A live-stream message from the app (hello, command, rtc…).
    let d = this.devices.get(cid);
    if (!d) d = this.openDevice(cid);
    if (d.local?.readyState === WebSocket.OPEN) d.local.send(body);
    else if (d.queue.length < 50) d.queue.push(body);
  }

  private openDevice(cid: string): Device {
    const old = this.devices.get(cid);
    if (old && !old.closed) return old;
    const d: Device = { local: null, queue: [], lastFrame: 0, closed: false };
    this.devices.set(cid, d);
    const ws = new WebSocket(`ws://${this.localHost}:${this.o.port}/ws?client=glidepath-relay&token=${encodeURIComponent(this.o.token())}`, { headers: { [RELAY_HEADER]: "1" } });
    d.local = ws;
    ws.on("open", () => { for (const q of d.queue.splice(0)) ws.send(q); });
    ws.on("message", (data) => {
      const s = String(data);
      if (s.startsWith('{"type":"frame"')) {
        const now = Date.now();
        if (now - d.lastFrame < FRAME_GAP_MS) return;
        d.lastFrame = now;
      }
      this.sendUp(cid, s);
    });
    ws.on("error", () => undefined);
    ws.on("close", () => { if (this.devices.get(cid) === d) this.devices.delete(cid); });
    return d;
  }

  /** An HTTP request from a device, made to this Bridge on its behalf. */
  private async request(cid: string, id: string, method: string, path: string, body: unknown): Promise<void> {
    const reply = (m: Record<string, unknown>) => this.sendUp(cid, JSON.stringify({ $: m.$, id, ...m }));
    if (!path.startsWith("/api/") || path.includes("..") || !["GET", "POST"].includes(method)) { reply({ $: "res", status: 403, ct: "application/json", text: '{"error":"Not available through Connect anywhere."}' }); return; }
    try {
      const r = await fetch(`http://${this.localHost}:${this.o.port}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.o.token()}`, [RELAY_HEADER]: "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
      });
      const ct = r.headers.get("content-type") ?? "application/octet-stream";
      if (ct.includes("text/event-stream") && r.body) {
        reply({ $: "res", status: r.status, ct, stream: true });
        const dec = new TextDecoder();
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) reply({ $: "chunk", t: dec.decode(chunk, { stream: true }) });
        reply({ $: "end" });
        return;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const textual = /json|text|javascript|xml|svg/.test(ct);
      if (buf.length <= CHUNK) { reply({ $: "res", status: r.status, ct, ...(textual ? { text: buf.toString("utf8") } : { b64: buf.toString("base64") }) }); return; }
      reply({ $: "res", status: r.status, ct, stream: true });
      for (let o = 0; o < buf.length; o += CHUNK) reply({ $: "chunk", b64: buf.subarray(o, o + CHUNK).toString("base64") });
      reply({ $: "end" });
    } catch (e) {
      reply({ $: "res", status: 502, ct: "application/json", text: JSON.stringify({ error: `The Bridge couldn't answer: ${(e as Error).message}` }) });
    }
  }
}
