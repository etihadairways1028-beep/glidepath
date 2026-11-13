/**
 * Live connection to a Glidepath Bridge.
 *
 * Where the Bridge is:
 *  - Opened from the Bridge itself (http://<pc>:4810/app/): same origin.
 *  - Opened from the hosted site on the sim PC: http://localhost:4810
 *    (browsers allow https pages to reach localhost).
 *  - Pairing links put `#bridge=<host:port>&token=<key>` in the URL once.
 *
 * Resilience: exponential reconnect, resume from the last sequence number
 * (the Bridge back-fills everything missed), reconnect when the tab becomes
 * visible again (iPad screen woke up).
 */
import { ServerMessage, type FlightSummary, type TelemetryFrame } from "@glidepath/protocol";
import { framesToTrail, pushTrail, settingsStore, store } from "./store";

export function detectBridgeUrl(): string | null {
  const s = settingsStore.get();
  if (s.bridgeUrl) return s.bridgeUrl;
  if (location.protocol === "http:" && location.pathname.startsWith("/app")) return location.origin; // served by the Bridge
  return null;
}

/** Read `#bridge=…&token=…` pairing parameters, save them, and clean the URL. */
export function consumePairingLink(): boolean {
  keepPairingForHomeScreen();
  const h = location.hash;
  const q = h.includes("?") ? h.slice(h.indexOf("?") + 1) : h.startsWith("#bridge=") || h.startsWith("#token=") ? h.slice(1) : "";
  if (!q) return false;
  const params = new URLSearchParams(q);
  const token = params.get("token");
  const bridge = params.get("bridge");
  if (!token && !bridge) return false;
  const patch: { token?: string; bridgeUrl?: string } = {};
  if (token) patch.token = token;
  if (bridge) patch.bridgeUrl = /^https?:\/\//.test(bridge) ? bridge : `http://${bridge}`;
  else if (location.protocol === "http:" && location.pathname.startsWith("/app")) patch.bridgeUrl = location.origin;
  settingsStore.set(patch);
  history.replaceState(null, "", location.pathname + "#/home");
  keepPairingForHomeScreen();
  return true;
}

/**
 * A Home Screen web app on iPad/iPhone gets its own storage and starts from the
 * address it was added from. On the Bridge-served app we keep the pairing key in
 * the address (?pair=…) and drop the manifest's fixed start page, so an app added
 * to the Home Screen opens already paired with this PC.
 */
function keepPairingForHomeScreen(): void {
  if (!(location.protocol === "http:" && location.pathname.startsWith("/app"))) return;
  const sp = new URLSearchParams(location.search);
  const fromUrl = sp.get("pair");
  if (fromUrl && settingsStore.get().token !== fromUrl) settingsStore.set({ token: fromUrl, bridgeUrl: location.origin });
  const token = settingsStore.get().token;
  if (token && fromUrl !== token) {
    sp.set("pair", token);
    history.replaceState(null, "", `${location.pathname}?${sp.toString()}${location.hash || "#/home"}`);
  }
  document.querySelector('link[rel="manifest"]')?.remove();
}

/** Connect anywhere: reach the PC through the account's relay instead of the local network. */
export interface RelayTarget { urls: string[]; token: string }

interface Pending { resolve: (r: Response) => void; reject: (e: Error) => void; ctrl?: ReadableStreamDefaultController<Uint8Array>; timer: number }

export class BridgeClient {
  private ws: WebSocket | null = null;
  private retry = 1000;
  private timer: number | null = null;
  private stopped = false;
  private lastSeq: number | null = null;
  private trailFor: string | null = null;

  constructor(private readonly base: string, private readonly token: string, private readonly relay: RelayTarget | null = null) {}

  /** True when this connection goes through the account relay (any network). */
  get isRelay(): boolean { return !!this.relay; }
  private relayAt = 0;
  private relayOnline = false;
  private reqs = new Map<string, Pending>();
  private pingTimer: number | null = null;

  /** fetch() to the Bridge, directly or through the relay. */
  private fetchBridge(path: string, init: { method?: string; body?: string; signal?: AbortSignal } = {}): Promise<Response> {
    if (!this.relay) {
      return fetch(this.base + path, {
        method: init.method ?? "GET", signal: init.signal, body: init.body,
        headers: { Authorization: `Bearer ${this.token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      });
    }
    return new Promise<Response>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.relayOnline) { reject(new Error("Your PC isn't connected right now.")); return; }
      const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const timer = window.setTimeout(() => { this.reqs.delete(id); reject(new Error("Your PC didn't answer in time.")); }, 30_000);
      this.reqs.set(id, { resolve, reject, timer });
      init.signal?.addEventListener("abort", () => { const q = this.reqs.get(id); if (q) { window.clearTimeout(q.timer); this.reqs.delete(id); q.ctrl?.close(); reject(new DOMException("Aborted", "AbortError")); } });
      this.ws.send(JSON.stringify({ $: "req", id, method: init.method ?? "GET", path, body: init.body !== undefined ? JSON.parse(init.body) : undefined }));
    });
  }

  /** A relay control message (request answers, PC online/offline). */
  private onRelayControl(m: { $: string; id?: string; online?: boolean; status?: number; ct?: string; text?: string; b64?: string; t?: string; stream?: boolean }): void {
    if (m.$ === "bridge") {
      this.relayOnline = !!m.online;
      if (m.online) {
        this.ws?.send(JSON.stringify({ type: "hello", protocolVersion: 1, client: "glidepath-app", lastSeq: this.lastSeq }));
      } else {
        store.set({ conn: "unreachable", connMessage: "Your PC isn't online. Open Glidepath Bridge on the PC; it connects by itself once it's signed in to this account." });
        for (const [id, q] of this.reqs) { window.clearTimeout(q.timer); q.reject(new Error("Your PC went offline.")); this.reqs.delete(id); }
      }
      return;
    }
    const q = m.id ? this.reqs.get(m.id) : undefined;
    if (!q) return;
    const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (m.$ === "res") {
      window.clearTimeout(q.timer);
      const headers = { "Content-Type": m.ct ?? "application/octet-stream" };
      if (m.stream) {
        const body = new ReadableStream<Uint8Array>({ start: (c) => { q.ctrl = c; } });
        q.timer = window.setTimeout(() => { this.reqs.delete(m.id!); try { q.ctrl?.error(new Error("Your PC stopped answering.")); } catch { /* closed */ } }, 120_000);
        q.resolve(new Response(body, { status: m.status ?? 200, headers }));
      } else {
        this.reqs.delete(m.id!);
        q.resolve(new Response(m.b64 !== undefined ? bytes(m.b64) : (m.text ?? ""), { status: m.status ?? 200, headers }));
      }
      return;
    }
    if (m.$ === "chunk") { try { q.ctrl?.enqueue(m.b64 !== undefined ? bytes(m.b64) : new TextEncoder().encode(m.t ?? "")); } catch { /* reader gone */ } return; }
    if (m.$ === "end") { window.clearTimeout(q.timer); this.reqs.delete(m.id!); try { q.ctrl?.close(); } catch { /* closed */ } }
  }

  /** Something the browser should show itself (a chart PDF): a link on the local network, or a downloaded copy through the relay. */
  async viewUrl(path: string): Promise<string> {
    if (!this.relay) return this.authedUrl(path);
    const r = await this.fetchBridge(path);
    if (!r.ok) throw new Error(`Your PC answered ${r.status}`);
    return URL.createObjectURL(await r.blob());
  }

  /* ---- Remote control ---- */
  private cmdWaiters = new Map<string, (r: { state: string; detail: string | null }) => void>();
  /** Send a command; resolves with the final state (confirmed, timeout, rejected, …). */
  command(capability: string, value: number | boolean | null, confirmed = false): Promise<{ state: string; detail: string | null }> {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { resolve({ state: "rejected", detail: "Not connected to your PC." }); return; }
      const t = window.setTimeout(() => { this.cmdWaiters.delete(id); resolve({ state: "timeout", detail: "No answer from your PC." }); }, 8000);
      this.cmdWaiters.set(id, (r) => { window.clearTimeout(t); resolve(r); });
      this.ws.send(JSON.stringify({ type: "command", id, capability, value, confirmed }));
    });
  }

  /* ---- Live camera signalling ---- */
  rtcListeners = new Set<(m: { kind: string; from?: string; live?: boolean; data?: unknown }) => void>();
  cameraLive = false;
  rtc(kind: "host-on" | "host-off" | "watch" | "signal" | "leave", to?: string, data?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "rtc", kind, to, data }));
  }

  /** The address this device reaches the Bridge on. */
  get baseUrl(): string { return this.base; }

  start(): void {
    store.reset("bridge");
    this.stopped = false;
    this.connect();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  /** A Bridge address that carries the pairing key, for things the browser loads itself (like a chart in a frame). */
  authedUrl(path: string): string { return `${this.base}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}`; }

  async get<T>(path: string): Promise<T> {
    const res = await this.fetchBridge(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Bridge returned HTTP ${res.status}`);
    return body as T;
  }

  /** POST and read a server-sent-event stream of {"t": text} chunks. */
  async stream(path: string, data: unknown, onText: (t: string) => void, signal?: AbortSignal): Promise<void> {
    const res = await this.fetchBridge(path, { method: "POST", body: JSON.stringify(data), signal });
    if (!res.ok || !res.body) {
      let msg = `Bridge answered ${res.status}`;
      try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!ev.startsWith("data:")) continue;
        const payload = ev.slice(5).trim();
        if (payload === "[DONE]") return;
        try { onText((JSON.parse(payload) as { t: string }).t); } catch { /* ignore */ }
      }
    }
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    const res = await this.fetchBridge(path, { method: "POST", body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Bridge returned HTTP ${res.status}`);
    return body as T;
  }

  private onVisible = () => {
    if (document.visibilityState === "visible" && (!this.ws || this.ws.readyState > 1)) {
      if (this.timer) clearTimeout(this.timer);
      this.retry = 1000;
      this.connect();
    }
  };

  private connect(): void {
    if (this.stopped) return;
    store.set({ conn: store.get().conn === "live" ? "reconnecting" : "connecting", connMessage: null });
    if (this.relay) { this.connectRelay(); return; }
    const url = this.base.replace(/^http/, "ws") + `/ws?client=glidepath-app&token=${encodeURIComponent(this.token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      store.set({ conn: "unreachable", connMessage: "This address can't be opened from this page." });
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 1000;
      ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, client: "glidepath-app", lastSeq: this.lastSeq }));
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => {
      if (this.stopped) return;
      if (!opened) {
        // Distinguish "wrong key" from "not running" with a plain HTTP check.
        fetch(this.base + "/api/status", { headers: { Authorization: `Bearer ${this.token}` } })
          .then((r) => store.set(r.status === 401
            ? { conn: "unauthorised", connMessage: "The Bridge rejected the pairing key. Open the link from the Bridge's page again." }
            : { conn: "unreachable", connMessage: "Bridge reachable but the live connection failed." }))
          .catch(() => store.set({ conn: "unreachable", connMessage: "Can't reach the Bridge. Is it running, and is this device on the same Wi-Fi?" }));
      } else {
        store.set({ conn: "reconnecting", connMessage: "Connection dropped. Reconnecting…" });
      }
      this.timer = window.setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
  }

  private connectRelay(): void {
    const r = this.relay!;
    const base = r.urls[this.relayAt % r.urls.length]!;
    let ws: WebSocket;
    try { ws = new WebSocket(`${base.replace(/^http/, "ws")}/relay/app?token=${encodeURIComponent(r.token)}`); }
    catch { store.set({ conn: "unreachable", connMessage: "Couldn't reach Glidepath. Check your internet connection." }); return; }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 1000;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 25_000);
    };
    ws.onmessage = (ev) => {
      const d = String(ev.data);
      if (d === "pong") return;
      if (d.startsWith('{"$"')) { try { this.onRelayControl(JSON.parse(d)); } catch { /* ignore */ } return; }
      this.onMessage(d);
    };
    ws.onclose = (ev) => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.relayOnline = false;
      for (const [id, q] of this.reqs) { window.clearTimeout(q.timer); q.reject(new Error("Connection dropped.")); this.reqs.delete(id); }
      if (this.stopped) return;
      if (!opened) this.relayAt++; // try the other address next time (some networks block one)
      store.set(opened
        ? { conn: "reconnecting", connMessage: "Connection dropped. Reconnecting…" }
        : { conn: "unreachable", connMessage: ev.code === 1006 && this.relayAt >= r.urls.length ? "Couldn't reach Glidepath. Check your internet connection." : "Connecting through your account…" });
      this.timer = window.setTimeout(() => this.connect(), opened ? 1000 : this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = ServerMessage.parse(JSON.parse(raw));
    } catch {
      return; // ignore anything that doesn't match the protocol
    }
    switch (msg.type) {
      case "welcome":
        store.set({ conn: "live", connMessage: null, status: msg.status });
        if (msg.flight) this.setFlight(msg.flight);
        break;
      case "status":
        store.set({ status: msg.status });
        break;
      case "frame": {
        const f = msg.frame;
        this.lastSeq = f.seq;
        store.set((s) => ({ frame: f, phase: msg.phase, trail: pushTrail(s.trail, f), lastFrameAt: Date.now(), conn: "live" }));
        break;
      }
      case "backfill":
        if (msg.frames.length) {
          this.lastSeq = msg.frames[msg.frames.length - 1]!.seq;
          store.set((s) => {
            let t = s.trail;
            for (const f of msg.frames) t = pushTrail(t, f);
            return { trail: t };
          });
        }
        break;
      case "event":
        store.set((s) => ({ events: [...s.events, msg.event] }));
        break;
      case "flight":
        this.setFlight(msg.flight);
        break;
      case "landing":
        store.set({ landing: msg.landing });
        break;
      case "error":
        if (msg.code === "protocol_mismatch") store.set({ connMessage: msg.message });
        break;
      case "commandState": {
        if (msg.state === "pending") break;
        const w = this.cmdWaiters.get(msg.id);
        if (w) { this.cmdWaiters.delete(msg.id); w({ state: msg.state, detail: msg.detail }); }
        break;
      }
      case "rtc":
        if (msg.kind === "host-state") this.cameraLive = !!msg.live;
        this.rtcListeners.forEach((f) => f(msg));
        break;
    }
  }

  private setFlight(f: FlightSummary): void {
    const s = store.get();
    if (f.status === "completed") {
      store.set({ flight: f, lastFlight: f, landing: f.landings.at(-1) ?? s.landing });
      return;
    }
    // A new, not-yet-departed flight replaces a completed one only once it leaves the gate.
    if (s.lastFlight && s.lastFlight.id !== f.id && !f.offBlockAt) {
      store.set({ flight: f });
      return;
    }
    const isNew = s.flight?.id !== f.id;
    store.set({ flight: f, ...(isNew ? { events: [], landing: f.landings.at(-1) ?? null, trail: [], lastFlight: null } : {}) });
    if (this.trailFor !== f.id) {
      this.trailFor = f.id;
      this.get<TelemetryFrame[]>(`/api/flights/${f.id}/frames`).then((frames) => {
        store.set((st) => ({ trail: framesToTrail([...frames, ...[]]).concat(st.trail.filter((p) => p.t > (frames.at(-1)?.t ?? 0))) }));
      }).catch(() => undefined);
      this.get<import("@glidepath/protocol").FlightEvent[]>(`/api/flights/${f.id}/events`).then((events) => store.set({ events })).catch(() => undefined);
    }
  }
}

let active: BridgeClient | null = null;
export function activeBridge(): BridgeClient | null {
  return active;
}
export function setActiveBridge(c: BridgeClient | null): void {
  active?.stop();
  active = c;
  c?.start();
}
