/**
 * Flight Replay: play back a recorded flight on the map, from the frames the
 * Bridge saved (nothing invented). Pause, scrub, change speed, jump to the
 * take-off or the landing, and follow the aircraft in 3D.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlightEvent, FlightPlan, TelemetryFrame } from "@glidepath/protocol";
import { MapView } from "./MapView";
import type { TrailPoint } from "../data/store";
import { fmt } from "../data/derive";

interface Pt { t: number; lat: number; lon: number; alt: number; gs: number; vs: number | null; hdg: number; ground: boolean | null }

const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

/** Points from recorded frames, or (in the demo) from the trail with headings worked out between points. */
export function replayPoints(frames: TelemetryFrame[] | null, trail: TrailPoint[]): Pt[] {
  if (frames && frames.length > 1) {
    return frames.filter((f) => Number.isFinite(f.position.lat) && Number.isFinite(f.position.lon)).map((f) => ({
      t: f.t, lat: f.position.lat, lon: f.position.lon, alt: f.position.altMslFt ?? 0, gs: f.speed.gsKt ?? 0,
      vs: f.speed.vsFpm ?? null, hdg: f.attitude.headingTrueDeg ?? 0, ground: f.position.onGround ?? null,
    }));
  }
  return trail.map((p, i) => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs, vs: null, ground: null,
    hdg: bearing(trail[Math.max(0, i - 1)]!, trail[Math.min(trail.length - 1, i + (i === 0 ? 1 : 0))]!) }));
}

function at(pts: Pt[], t: number): { p: Pt; i: number } {
  let lo = 0, hi = pts.length - 1;
  if (t <= pts[0]!.t) return { p: pts[0]!, i: 0 };
  if (t >= pts[hi]!.t) return { p: pts[hi]!, i: hi };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid]!.t <= t) lo = mid; else hi = mid; }
  const a = pts[lo]!, b = pts[hi]!, k = (t - a.t) / Math.max(1, b.t - a.t);
  const dh = ((b.hdg - a.hdg + 540) % 360) - 180;
  return { i: lo, p: { t, lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, alt: a.alt + (b.alt - a.alt) * k, gs: a.gs + (b.gs - a.gs) * k, vs: a.vs, hdg: (a.hdg + dh * k + 360) % 360, ground: a.ground } };
}

const SPEEDS = [1, 10, 30, 60, 120];
const clock = (t: number) => new Date(t).toISOString().slice(11, 19) + "Z";

export function Replay({ points, plan, airports, events }: { points: Pt[]; plan: FlightPlan | null; airports: Array<{ code: string; lat: number; lon: number; role: "dep" | "arr" }>; events: FlightEvent[] }) {
  const start = points[0]?.t ?? 0, end = points.at(-1)?.t ?? 0;
  const [t, setT] = useState(end);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [threeD, setThreeD] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const next = tRef.current + (now - last) * speed;
      last = now;
      if (next >= end) { setT(end); setPlaying(false); } else setT(next);
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  const cur = points.length ? at(points, t) : null;
  const trail: TrailPoint[] = useMemo(() => {
    if (!cur) return [];
    const step = Math.max(1, Math.floor(cur.i / 1500));
    const out: TrailPoint[] = [];
    for (let i = 0; i <= cur.i; i += step) { const p = points[i]!; out.push({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, gs: p.gs }); }
    out.push({ t: cur.p.t, lat: cur.p.lat, lon: cur.p.lon, alt: cur.p.alt, gs: cur.p.gs });
    return out;
  }, [cur?.i, Math.round(t / 2000), points]);

  if (!cur) return null;
  const evAt = (types: string[]) => events.find((e) => types.includes(e.type))?.t ?? null;
  const takeoff = evAt(["TAKEOFF_ROLL", "WHEELS_UP"]);
  const landing = evAt(["TOUCHDOWN"]);
  const jump = (to: number | null, lead: number) => { if (to == null) return; setT(Math.max(start, to - lead)); setPlaying(true); if (speed > 10) setSpeed(10); };
  const play = () => { if (t >= end) setT(start); setPlaying(!playing); };
  const onGround = cur.p.ground ?? (cur.p.gs < 40 && (t - start < 30 * 60_000 || end - t < 30 * 60_000));

  return (
    <section className="glass replay" aria-label="Flight replay">
      <div className="replay-map">
        <MapView trail={trail} plan={plan} airports={airports} aircraft={{ lat: cur.p.lat, lon: cur.p.lon, hdg: cur.p.hdg }} follow={playing || threeD} threeD={threeD} onGround={onGround} agl={null} interactive />
        <div className="replay-read glass strong">
          <span><small>TIME</small>{clock(t)}</span>
          <span><small>ALT</small>{fmt(Math.round(cur.p.alt))}</span>
          <span><small>GS</small>{fmt(Math.round(cur.p.gs))}</span>
          {cur.p.vs != null && <span><small>V/S</small>{fmt(Math.round(cur.p.vs))}</span>}
          <span><small>HDG</small>{String(Math.round(cur.p.hdg) % 360).padStart(3, "0")}</span>
        </div>
      </div>
      <div className="replay-bar">
        <button className="btn primary round-lg" onClick={play} aria-label={playing ? "Pause" : "Play"}>{playing ? <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg> : <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>}</button>
        <input className="replay-scrub" type="range" min={start} max={end} step={1000} value={t} aria-label="Replay position" onChange={(e) => setT(Number(e.target.value))} />
        <div className="seg replay-speed" role="group" aria-label="Replay speed">
          {SPEEDS.map((s) => <button key={s} className={s === speed ? "on" : ""} aria-pressed={s === speed} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
      </div>
      <div className="replay-jumps">
        <button className="btn small" disabled={takeoff == null} onClick={() => jump(takeoff, 20_000)}>Watch the take-off</button>
        <button className="btn small" disabled={landing == null} onClick={() => jump(landing, 90_000)}>Watch the landing</button>
        <button className={`btn small${threeD ? " on" : ""}`} aria-pressed={threeD} onClick={() => setThreeD(!threeD)}>3D follow</button>
        <span className="faint" style={{ fontSize: 12.5, marginLeft: "auto" }}>Recorded by your Bridge, {points.length.toLocaleString()} positions</span>
      </div>
    </section>
  );
}
