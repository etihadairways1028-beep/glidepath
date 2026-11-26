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

const sameAirports = (a: FlightPlan, b: FlightPlan) => a.origin.icao === b.origin.icao && a.destination.icao === b.destination.icao;
/** A plan with no real route: what MSFS has when the route lives in the aircraft's own FMS (Fenix, PMDG…). */
export const isThin = (p: FlightPlan | null) => !!p && p.fixes.filter((f) => !/^(TOC|TOD|T\/C|T\/D)$/i.test(f.ident)).length < 2;

/** Why the full route isn't showing, for the map and Home to explain. */
export type PlanNote = { kind: "no-user" } | { kind: "mismatch"; simbrief: string; flying: string } | { kind: "failed"; msg: string } | null;
let note: PlanNote = null;
const noteSubs = new Set<() => void>();
const setNote = (n: PlanNote) => { if (JSON.stringify(n) === JSON.stringify(note)) return; note = n; noteSubs.forEach((f) => f()); };
export function usePlanNote(): PlanNote {
  return useSyncExternalStore((f) => { noteSubs.add(f); return () => { noteSubs.delete(f); }; }, () => note);
}

/** A plan the Bridge has (from MSFS, or SimBrief loaded on another device). */
export function adoptPlan(p: FlightPlan): void {
  const cur = current;
  // Your SimBrief plan wins over the sim's plan for the same airports, and over any sim plan for 12 hours.
  if (cur && cur.source === "simbrief" && p.source === "msfs" && (sameAirports(cur, p) || Date.now() - cur.fetchedAt < 12 * 3600_000)) return;
  if (cur && JSON.stringify(cur.fixes) === JSON.stringify(p.fixes) && cur.origin.icao === p.origin.icao) return;
  set(p);
}

/**
 * Keep the plan current by itself: pick up the plan the Bridge has (MSFS or SimBrief),
 * and if there's none, fetch your latest SimBrief plan when you've saved your SimBrief name.
 */
export function startPlanSync(getUser: () => string, getBridge: () => { get: <T>(p: string) => Promise<T> } | null): () => void {
  let lastSb = 0;
  let lastAuto = 0;
  const tick = async () => {
    const b = getBridge();
    const u = getUser().trim();
    if (b && appStore.get().mode === "bridge") {
      try {
        const r = await b.get<{ plan: unknown }>("/api/plan");
        if (r.plan) {
          const sim = FlightPlanSchema.parse(r.plan);
          adoptPlan(sim);
          // What the flight will show: your saved plan if it's for these airports, else the sim's.
          const shown = current && sameAirports(current, sim) ? current : sim;
          // The sim only has "direct to the destination": the real route is in SimBrief.
          if (isThin(shown)) {
            if (!u) { setNote({ kind: "no-user" }); return; }
            if (Date.now() - lastSb > 3 * 60_000) {
              lastSb = Date.now();
              try {
                const sb = await loadLatestPlan(u);
                setNote(sameAirports(sb, sim) ? null : { kind: "mismatch", simbrief: `${sb.origin.icao} to ${sb.destination.icao}`, flying: `${sim.origin.icao} to ${sim.destination.icao}` });
              } catch (e) { setNote({ kind: "failed", msg: (e as Error).message }); }
            }
          } else setNote(null);
          return;
        }
      } catch { /* older Bridge or offline */ }
    }
    // Planned a new flight on SimBrief? It appears here by itself (on the ground only, never mid-flight).
    const onGround = appStore.get().frame?.position.onGround !== false;
    if (u && autoSimbrief() && appStore.get().mode !== "demo" && onGround && Date.now() - lastAuto > 60_000) {
      lastAuto = Date.now();
      try {
        const fresh = FlightPlanSchema.parse(await publicGet<unknown>(`/simbrief?user=${encodeURIComponent(u)}`));
        if (fresh.ofpId && fresh.ofpId !== current?.ofpId && (!current || current.source !== "simbrief" || fresh.ofpId !== current.ofpId)) {
          const hadOne = !!current?.ofpId;
          set(fresh); setNote(null);
          if (hadOne || !current) onNewPlan(fresh);
        }
      } catch { /* no plan yet or offline */ }
    }
    if (u && appStore.get().mode !== "demo" && (!current || Date.now() - current.fetchedAt > 6 * 3600_000) && Date.now() - lastSb > 10 * 60_000) {
      lastSb = Date.now();
      try { await loadLatestPlan(u); } catch { /* no plan or offline */ }
    }
  };
  void tick();
  const t = window.setInterval(() => void tick(), 20_000);
  return () => clearInterval(t);
}

/** Auto-load new SimBrief flights: on unless you turn it off in the SimBrief app. */
const AUTO_KEY = "glidepath.simbrief.auto";
export function autoSimbrief(): boolean { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } }
export function setAutoSimbrief(on: boolean) { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* private mode */ } }
let newPlanSubs: ((p: FlightPlan) => void)[] = [];
export function onNewSimbriefPlan(f: (p: FlightPlan) => void): () => void { newPlanSubs.push(f); return () => { newPlanSubs = newPlanSubs.filter((x) => x !== f); }; }
function onNewPlan(p: FlightPlan) { newPlanSubs.forEach((f) => f(p)); }

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
  setNote(null);
  return p;
}
