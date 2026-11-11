/**
 * Rain radar frames from RainViewer's free public API (no key; CORS allowed).
 * The last ~2 hours in 10-minute steps, for the animated radar.
 */
import { usePoll } from "./external";

export interface RadarFrame { time: number; tiles: string }

export async function fetchRadarFrames(): Promise<RadarFrame[]> {
  const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`RainViewer ${r.status}`);
  const j = (await r.json()) as { host: string; radar: { past?: Array<{ path: string; time: number }>; nowcast?: Array<{ path: string; time: number }> } };
  const all = [...(j.radar.past ?? []), ...(j.radar.nowcast ?? [])];
  return all.map((f) => ({ time: f.time, tiles: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` }));
}

export function useRadarFrames(on = true) {
  return usePoll(on ? fetchRadarFrames : null, 10 * 60_000, [on]);
}
