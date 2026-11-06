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
  return true;
}

export class BridgeClient {
  private ws: WebSocket | null = null;
  private retry = 1000;
  private timer: number | null = null;
  private stopped = false;
  private lastSeq: number | null = null;
  private trailFor: string | null = null;

  constructor(private readonly base: string, private readonly token: string) {}

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
    this.ws?.close();
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, { headers: { Authorization: `Bearer ${this.token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Bridge returned HTTP ${res.status}`);
    return body as T;
  }

  /** POST and read a server-sent-event stream of {"t": text} chunks. */
  async stream(path: string, data: unknown, onText: (t: string) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(this.base + path, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(data), signal,
    });
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
    const res = await fetch(this.base + path, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
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
