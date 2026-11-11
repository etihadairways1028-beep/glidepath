/**
 * App state: one small store, fed by a BridgeClient (live) or a DemoClient
 * (synthetic flight through the real engine). Screens read it with useApp().
 */
import { useSyncExternalStore } from "react";
import type { BridgeStatus, FlightEvent, FlightPhase, FlightPlan, FlightSummary, LandingReport, TelemetryFrame } from "@glidepath/protocol";

export type Mode = "none" | "bridge" | "demo";
export type ConnState = "idle" | "connecting" | "live" | "reconnecting" | "unreachable" | "unauthorised";

export interface TrailPoint { lat: number; lon: number; alt: number; gs: number; t: number }

export interface AppState {
  mode: Mode;
  conn: ConnState;
  connMessage: string | null;
  status: BridgeStatus | null;
  flight: FlightSummary | null;
  /** The flight that just completed: kept on screen until the next one leaves the gate. */
  lastFlight: FlightSummary | null;
  frame: TelemetryFrame | null;
  phase: FlightPhase;
  trail: TrailPoint[];
  events: FlightEvent[];
  landing: LandingReport | null;
  lastFrameAt: number | null;
  demoSpeed: number;
}

/** Base maps. "map" (kept for older saved settings) means: follow the light/dark theme. */
export type MapStyle = "chart" | "satellite" | "map" | "dark" | "light" | "fiord" | "liberty" | "bright";
export const MAP_STYLES: Array<{ id: MapStyle; label: string; hint: string }> = [
  { id: "map", label: "Standard", hint: "Clean street map, light or dark with the app" },
  { id: "satellite", label: "Satellite", hint: "Sharp imagery near airports and cities" },
  { id: "chart", label: "Chart", hint: "Navigation-chart look: black land, blue sea, lat/long grid, online ATC sectors" },
  { id: "dark", label: "Dark", hint: "Night-friendly street map" },
  { id: "fiord", label: "Navy", hint: "Deep blue, calm" },
  { id: "light", label: "Light", hint: "Clean and minimal" },
  { id: "liberty", label: "Colour", hint: "Full-colour street map" },
  { id: "bright", label: "Bright", hint: "Classic OpenStreetMap look" },
];

export interface Settings {
  bridgeUrl: string;
  token: string;
  simbriefUser: string;
  showVatsim: boolean;
  showIvao: boolean;
  showSayIntentions: boolean;
  fuelUnit: "kg" | "lb";
  accent: "glideslope" | "aurora" | "ice";
  theme: "system" | "dark" | "light";
  /** Background behind the glass: a built-in wallpaper, plain, or the person's own photo. */
  wallpaper: "aurora" | "sunset" | "ocean" | "dusk" | "forest" | "plain" | "photo";
  /** Speak phase changes, top of descent and approach altitude callouts. */
  voiceCallouts: boolean;
  reduceTransparency: boolean;
  /** Base map: satellite imagery, or a street map that follows the light/dark theme. */
  mapStyle: MapStyle;
  map3d: boolean;
  /** Glideslope banners at each stage of the flight. */
  flightMessages: boolean;
  /** Messages when the aircraft lights are switched, plus light reminders. */
  lightMessages: boolean;
  /** Also show Glideslope messages as system notifications (when the app is in the background). */
  systemNotifications: boolean;
  atcAlerts: boolean;
  showAtc: boolean;
  showRadar: boolean;
  showMetars: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  bridgeUrl: "", token: "", simbriefUser: "", showVatsim: true, showIvao: false, showSayIntentions: false, fuelUnit: "kg", accent: "glideslope", theme: "system", wallpaper: "aurora", voiceCallouts: false, reduceTransparency: false, mapStyle: "map", map3d: false, flightMessages: true, systemNotifications: false, atcAlerts: true, lightMessages: true, showAtc: true, showRadar: false, showMetars: false,
};

const initial: AppState = {
  mode: "none", conn: "idle", connMessage: null, status: null, flight: null, lastFlight: null, frame: null, phase: "PREFLIGHT",
  trail: [], events: [], landing: null, lastFrameAt: null, demoSpeed: 30,
};

type Listener = () => void;
let state: AppState = initial;
const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  reset(mode: Mode) {
    state = { ...initial, mode, demoSpeed: state.demoSpeed };
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(initial));
}

/* ---------------- settings (localStorage, guarded) ---------------- */

let settings: Settings = DEFAULT_SETTINGS;
const settingsListeners = new Set<Listener>();
try {
  const raw = localStorage.getItem("glidepath.settings");
  if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  // 0.6.1: the new Standard street map becomes everyone's default once.
  if (localStorage.getItem("glidepath.mapV") !== "2") {
    settings = { ...settings, mapStyle: "map" };
    localStorage.setItem("glidepath.mapV", "2");
    localStorage.setItem("glidepath.settings", JSON.stringify(settings));
  }
} catch {
  /* private mode or storage disabled: defaults */
}

export const settingsStore = {
  get: () => settings,
  set(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem("glidepath.settings", JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    settingsListeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    settingsListeners.add(l);
    return () => settingsListeners.delete(l);
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get, () => DEFAULT_SETTINGS);
}

/* ---------------- helpers shared by both clients ---------------- */

/** Append a frame to the trail when it has moved enough (keeps long-hauls light). */
export function pushTrail(trail: TrailPoint[], f: TelemetryFrame): TrailPoint[] {
  const last = trail[trail.length - 1];
  const p = { lat: f.position.lat, lon: f.position.lon, alt: f.position.altMslFt ?? 0, gs: f.speed.gsKt ?? 0, t: f.t };
  if (last) {
    const moved = Math.abs(last.lat - p.lat) + Math.abs(last.lon - p.lon);
    if (moved < 0.0008 && Math.abs(last.alt - p.alt) < 150 && p.t - last.t < 30_000) return trail;
  }
  const next = trail.length > 20000 ? trail.filter((_, i) => i % 2 === 0) : trail.slice();
  next.push(p);
  return next;
}

export function framesToTrail(frames: TelemetryFrame[]): TrailPoint[] {
  let t: TrailPoint[] = [];
  for (const f of frames) t = pushTrail(t, f);
  return t;
}

export type { FlightPlan };
