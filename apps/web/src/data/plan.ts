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
