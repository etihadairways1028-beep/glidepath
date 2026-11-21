/**
 * The last few minutes of altitude, speed, vertical speed and fuel, for the small trend lines on Home.
 * One sample every 2 seconds from the live frames; cleared when a new flight starts.
 */
import { useSyncExternalStore } from "react";
import { store } from "./store";

export interface Series { alt: number[]; gs: number[]; vs: number[]; fuel: number[] }
const N = 150; // 5 minutes
let s: Series = { alt: [], gs: [], vs: [], fuel: [] };
let lastT = 0, lastFlight: string | null = null;
const subs = new Set<() => void>();
const push = (a: number[], v: number | null | undefined) => { if (v == null || !Number.isFinite(v)) return a; const n = a.length >= N ? a.slice(1) : a.slice(); n.push(v); return n; };

store.subscribe(() => {
  const st = store.get();
  const f = st.frame;
  const id = st.flight?.id ?? null;
  if (id !== lastFlight) { lastFlight = id; s = { alt: [], gs: [], vs: [], fuel: [] }; lastT = 0; }
  if (!f || f.t - lastT < 2000) return;
  lastT = f.t;
  s = { alt: push(s.alt, f.position.altMslFt), gs: push(s.gs, f.speed.gsKt), vs: push(s.vs, f.speed.vsFpm), fuel: push(s.fuel, f.fuel.totalKg) };
  subs.forEach((l) => l());
});

export function useSeries(): Series {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => s);
}

/** A smooth SVG path for a sparkline (0..w × 0..h). */
export function sparkPath(v: number[], w: number, h: number, pad = 3): { line: string; area: string } | null {
  if (v.length < 2) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const x = (i: number) => (i / (v.length - 1)) * w;
  const y = (n: number) => pad + (1 - (n - lo) / (hi - lo)) * (h - pad * 2);
  let d = `M${x(0).toFixed(1)} ${y(v[0]!).toFixed(1)}`;
  for (let i = 1; i < v.length; i++) {
    const x0 = x(i - 1), x1 = x(i), y0 = y(v[i - 1]!), y1 = y(v[i]!), cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return { line: d, area: `${d} L${w} ${h} L0 ${h} Z` };
}
