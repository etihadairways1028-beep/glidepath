/**
 * The SimBrief plan you loaded, kept on this device. It shows on the map and the Flight screen
 * before the sim is even running, and works without the Bridge (through the Glidepath service).
 */
import { useSyncExternalStore } from "react";
import { FlightPlan as FlightPlanSchema } from "@glidepath/protocol";
import type { FlightPlan } from "@glidepath/protocol";
import { publicGet } from "./cloud";
import { loadPlan as loadViaBridge } from "./external";
import { store as appStore } from "./store";

const KEY = "glidepath.plan";
let current: FlightPlan | null = (() => { try { const r = localStorage.getItem(KEY); return r ? FlightPlanSchema.parse(JSON.parse(r)) : null; } catch { return null; } })();
const subs = new Set<() => void>();
function set(p: FlightPlan | null) {
  current = p;
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  subs.forEach((f) => f());
}
export const savedPlan = () => current;
export const clearSavedPlan = () => set(null);
export function useSavedPlan(): FlightPlan | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
}

/** A plan the Bridge has (from MSFS, or SimBrief loaded on another device). */
export function adoptPlan(p: FlightPlan): void {
  const cur = current;
  if (cur && cur.source === "simbrief" && p.source === "msfs" && Date.now() - cur.fetchedAt < 12 * 3600_000) return; // your SimBrief plan wins
  if (cur && JSON.stringify(cur.fixes) === JSON.stringify(p.fixes) && cur.origin.icao === p.origin.icao) return;
  set(p);
}

/**
 * Keep the plan current by itself: pick up the plan the Bridge has (MSFS or SimBrief),
 * and if there's none, fetch your latest SimBrief plan when you've saved your SimBrief name.
 */
export function startPlanSync(getUser: () => string, getBridge: () => { get: <T>(p: string) => Promise<T> } | null): () => void {
  let lastSb = 0;
  const tick = async () => {
    const b = getBridge();
    if (b && appStore.get().mode === "bridge") {
      try { const r = await b.get<{ plan: unknown }>("/api/plan"); if (r.plan) { adoptPlan(FlightPlanSchema.parse(r.plan)); return; } } catch { /* older Bridge or offline */ }
    }
    const u = getUser().trim();
    if (u && appStore.get().mode !== "demo" && (!current || Date.now() - current.fetchedAt > 6 * 3600_000) && Date.now() - lastSb > 10 * 60_000) {
      lastSb = Date.now();
      try { await loadLatestPlan(u); } catch { /* no plan or offline */ }
    }
  };
  void tick();
  const t = window.setInterval(() => void tick(), 20_000);
  return () => clearInterval(t);
}

/** Load the latest SimBrief plan: through the Bridge when connected (it links to your flight), otherwise directly. */
export async function loadLatestPlan(user: string): Promise<FlightPlan> {
  const u = user.trim();
  if (!u) throw new Error("Type your SimBrief username or Pilot ID.");
  const viaBridge = appStore.get().mode === "bridge";
  let p: FlightPlan;
  try { p = viaBridge ? await loadViaBridge(u) : FlightPlanSchema.parse(await publicGet<unknown>(`/simbrief?user=${encodeURIComponent(u)}`)); }
  catch (e) {
    if (!viaBridge) throw e;
    p = FlightPlanSchema.parse(await publicGet<unknown>(`/simbrief?user=${encodeURIComponent(u)}`));
  }
  set(p);
  return p;
}
