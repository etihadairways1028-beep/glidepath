/**
 * Live direct-to handling: watches your track, and when you've flown direct
 * to a later waypoint for a few seconds, drops the waypoints you skipped from
 * the plan everyone sees (map, navlog, next waypoint). It can be undone.
 */
import { useEffect, useState } from "react";
import { DirectTracker, bearingDeg, directCandidate, distanceNm, routeProgress, type LatLon } from "@glidepath/flight-engine";
import type { FlightPlan, TelemetryFrame } from "@glidepath/protocol";

const KEY = "glidepath.skipped";
const planKey = (p: FlightPlan) => `${p.origin.icao}-${p.destination.icao}-${p.fixes.length}-${p.fixes[0]?.ident ?? ""}-${p.fixes.at(-1)?.ident ?? ""}`;
const fixKey = (f: { ident: string; lat: number; lon: number }) => `${f.ident}@${f.lat.toFixed(3)},${f.lon.toFixed(3)}`;

interface State { key: string; skipped: string[]; history: Array<{ target: string; targetKey?: string; skipped: string[]; t: number }>; ignore?: string[] }
let st: State | null = null;
const tracker = new DirectTracker();
let last: { lat: number; lon: number; t: number } | null = null;
let track: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(key: string): State {
  if (st?.key === key) return st;
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null; if (s?.key === key) return (st = s); } catch { /* fresh */ }
  tracker.reset();
  return (st = { key, skipped: [], history: [] });
}
function save() { try { if (st) localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode */ } emit(); }

const memo = new WeakMap<FlightPlan, { sig: string; plan: FlightPlan }>();
function filtered(plan: FlightPlan, s: State): FlightPlan {
  if (!s.skipped.length) return plan;
  const sig = s.skipped.join("|");
  const m = memo.get(plan);
  if (m?.sig === sig) return m.plan;
  const drop = new Set(s.skipped);
  const out = { ...plan, fixes: plan.fixes.filter((f) => !drop.has(fixKey(f))) };
  memo.set(plan, { sig, plan: out });
  return out;
}

/** The plan with any skipped waypoints removed; also checks this frame for a new direct-to. */
export function withDirects(plan: FlightPlan, frame: TelemetryFrame | null): FlightPlan {
  const s = load(planKey(plan));
  let eff = filtered(plan, s);
  if (!frame || frame.position.onGround || (frame.position.altAglFt ?? 9999) < 1000) return eff;
  const pos = { lat: frame.position.lat, lon: frame.position.lon };
  // Ground track from positions at least 4 s and 0.2 nm apart.
  if (!last || frame.t < last.t || frame.t - last.t > 60_000) last = { ...pos, t: frame.t };
  else if (frame.t - last.t >= 4000 && distanceNm(last, pos) > 0.2) { track = bearingDeg(last, pos); last = { ...pos, t: frame.t }; }
  else return eff;
  if (track === null) return eff;
  const route: LatLon[] = [{ lat: eff.origin.lat, lon: eff.origin.lon }, ...eff.fixes, { lat: eff.destination.lat, lon: eff.destination.lon }];
  const prog = routeProgress(route, pos);
  if (!prog) return eff;
  const nextIdx = prog.legIndex + 1;
  const raw = directCandidate({ route, nextIdx, pos, trackDeg: track, bankDeg: frame.attitude.bankDeg });
  // A direct-to you put back isn't detected again.
  const rawKey = raw !== null && raw - 1 < eff.fixes.length ? fixKey(eff.fixes[raw - 1]!) : raw !== null ? "dest" : null;
  const j = tracker.update(rawKey && s.ignore?.includes(rawKey) ? null : raw, frame.t);
  if (j !== null && j > nextIdx) {
    const skipped = eff.fixes.slice(nextIdx - 1, j - 1);
    const target = j - 1 < eff.fixes.length ? eff.fixes[j - 1]!.ident : eff.destination.icao;
    if (skipped.length) {
      s.skipped.push(...skipped.map(fixKey));
      s.history.push({ target, targetKey: j - 1 < eff.fixes.length ? fixKey(eff.fixes[j - 1]!) : "dest", skipped: skipped.map(fixKey), t: frame.t });
      save();
      eff = filtered(plan, s);
    }
  }
  return eff;
}

/** Put back the waypoints from the last direct-to. */
export function undoDirect(): void {
  if (!st?.history.length) return;
  const h = st.history.pop()!;
  const back = new Set(h.skipped);
  st.skipped = st.skipped.filter((k) => !back.has(k));
  if (h.targetKey) st.ignore = [...(st.ignore ?? []), h.targetKey];
  tracker.reset();
  save();
}
/** Put back every skipped waypoint. */
export function restoreAll(): void { if (!st) return; st.skipped = []; st.history = []; st.ignore = []; tracker.reset(); save(); }

export function useLastDirect(): { target: string; count: number; idents: string[] } | null {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const h = st?.history.at(-1);
  return h ? { target: h.target, count: h.skipped.length, idents: h.skipped.map((k) => k.split("@")[0]!) } : null;
}
