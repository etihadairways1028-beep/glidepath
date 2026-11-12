/**
 * Follow my flight: while it's on, the app sends your position to your account
 * every 10 seconds, and anyone with the link can watch on a map. Nothing is
 * sent until you turn it on, and it stops by itself after you park.
 */
import { useSyncExternalStore } from "react";
import { authed, followUrl, useCloud } from "./cloud";
import { store } from "./store";

interface LiveState { id: string | null; on: boolean; busy: boolean; error: string | null; sentAt: number | null }
const KEY = "glidepath.liveShare";
let state: LiveState = (() => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.id && Date.now() - (v.at ?? 0) < 12 * 3600_000) return { id: v.id, on: true, busy: false, error: null, sentAt: null }; } catch { /* ignore */ }
  return { id: null, on: false, busy: false, error: null, sentAt: null };
})();
const listeners = new Set<() => void>();
const set = (p: Partial<LiveState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
const save = () => { try { state.on && state.id ? localStorage.setItem(KEY, JSON.stringify({ id: state.id, at: Date.now() })) : localStorage.removeItem(KEY); } catch { /* ignore */ } };
export const useLive = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
export const liveLink = () => (state.id ? followUrl(state.id) : null);

let timer: ReturnType<typeof setInterval> | null = null;
let parkedSince: number | null = null;
let pilotName: string | null = null;

async function tick() {
  if (!state.on || !state.id) return;
  const s = store.get();
  const f = s.frame;
  if (!f || s.mode === "none" || (s.lastFrameAt && Date.now() - s.lastFrameAt > 30_000)) return; // sim not sending
  const flight = s.flight ?? s.lastFlight;
  try {
    await authed("/live/update", "POST", {
      id: state.id,
      pos: { lat: f.position.lat, lon: f.position.lon, alt: f.position.altMslFt, gs: f.speed.gsKt, hdg: f.attitude.headingTrueDeg, vs: f.speed.vsFpm, onGround: f.position.onGround },
      info: {
        callsign: flight?.plan?.callsign ?? flight?.callsign ?? null,
        dep: flight?.departureIcao ?? flight?.plan?.origin?.icao ?? null, arr: flight?.plan?.destination?.icao ?? flight?.arrivalIcao ?? null,
        depLat: flight?.plan?.origin?.lat, depLon: flight?.plan?.origin?.lon, arrLat: flight?.plan?.destination?.lat, arrLon: flight?.plan?.destination?.lon,
        depName: flight?.departureName ?? null, arrName: flight?.arrivalName ?? null,
        aircraft: flight?.aircraft?.icaoType ?? flight?.plan?.aircraftIcao ?? flight?.aircraft?.title ?? null,
        distToGoNm: s.flight ? distToGo(f.position.lat, f.position.lon, flight?.plan?.destination) : null,
        phase: s.phase, pilot: pilotName,
      },
    });
    set({ sentAt: Date.now(), error: null });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/stopped/.test(m)) { void stopSharing(); set({ error: m }); } else set({ error: m });
  }
  // Flight completed 3 minutes ago after a flight: the link ends by itself.
  if (s.phase === "COMPLETED") { parkedSince ??= Date.now(); if (Date.now() - parkedSince > 180_000) void stopSharing(); } else parkedSince = null;
}

function loop() {
  if (timer) clearInterval(timer);
  timer = state.on ? setInterval(() => void tick(), 10_000) : null;
  if (state.on) void tick();
}

export async function startSharing(pilot?: string | null): Promise<string | null> {
  pilotName = pilot ?? null;
  set({ busy: true, error: null });
  try {
    const r = await authed<{ id: string }>("/live/start", "POST", {});
    set({ id: r.id, on: true, busy: false }); save(); loop();
    return followUrl(r.id);
  } catch (e) { set({ busy: false, error: e instanceof Error ? e.message : String(e) }); return null; }
}

export async function stopSharing(): Promise<void> {
  const id = state.id;
  set({ on: false, busy: false }); save(); loop();
  if (id) { try { await authed("/live/stop", "POST", { id }); } catch { /* it expires anyway */ } }
}

/** Resume after a reload, if a link was on. */
export function initLive() { if (state.on) setTimeout(loop, 4000); }

/** Hook for components: whether sharing is possible right now. */
export function useCanShare() { const c = useCloud(); return !!c.active; }

function distToGo(lat: number, lon: number, d?: { lat: number; lon: number } | null): number | null {
  if (!d) return null;
  const r = Math.PI / 180, a = Math.sin(((d.lat - lat) * r) / 2) ** 2 + Math.cos(lat * r) * Math.cos(d.lat * r) * Math.sin(((d.lon - lon) * r) / 2) ** 2;
  return Math.round(3440.065 * 2 * Math.asin(Math.sqrt(a)));
}
