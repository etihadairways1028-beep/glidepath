/**
 * Taxi chart drawn from the simulator's own airport data: runways with their numbers,
 * every taxiway with its name, hold-short bars, gates and stands, and your aircraft moving
 * live. North up, pinch/scroll to zoom, drag to pan. Generated, not an official chart.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { activeBridge } from "../data/bridge";
import { store, useApp } from "../data/store";

type Pt = [number, number];
export interface AirportLayout {
  icao: string; lat: number; lon: number; magvar: number;
  runways: Array<{ lat: number; lon: number; hdg: number; lengthM: number; widthM: number; ends: [string, string]; surface: number }>;
  paths: Array<{ kind: "taxi" | "runway" | "parking" | "path" | "closed"; w: number; a: Pt; b: Pt; name: string }>;
  holds: Array<{ p: Pt; ils: boolean }>;
  parking: Array<{ p: Pt; hdg: number; r: number; kind: "gate" | "ramp" | "cargo" | "mil" | "fuel" | "other"; name: string }>;
}

const KEY = (icao: string) => `glidepath.layout.${icao}`;
function keep(icao: string, l: AirportLayout) {
  try {
    const s = JSON.stringify(l);
    if (s.length > 1_500_000) return;
    // keep a few airports on this device, newest first
    const idx: string[] = JSON.parse(localStorage.getItem("glidepath.layouts") ?? "[]");
    const next = [icao, ...idx.filter((x) => x !== icao)];
    for (const old of next.slice(6)) localStorage.removeItem(KEY(old));
    localStorage.setItem("glidepath.layouts", JSON.stringify(next.slice(0, 6)));
    localStorage.setItem(KEY(icao), s);
  } catch { /* storage full or private */ }
}
const saved = (icao: string): AirportLayout | null => { try { const r = localStorage.getItem(KEY(icao)); return r ? (JSON.parse(r) as AirportLayout) : null; } catch { return null; } };

export function useLayout(icao: string | null) {
  const mode = useApp((s) => s.mode);
  const [data, setData] = useState<AirportLayout | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    setErr(null);
    if (!icao) { setData(null); return; }
    const s = saved(icao); setData(s);
    const b = activeBridge();
    if (mode !== "bridge" || !b) { if (!s) setErr("Taxi charts are drawn from Microsoft Flight Simulator's airport data through the Bridge on your PC. Connect it with the sim running once, and Glidepath keeps the airport."); return; }
    let stop = false; setLoading(true);
    b.get<AirportLayout>(`/api/airport/${icao}/layout`).then((l) => { if (!stop) { setData(l); keep(icao, l); } })
      .catch((e: Error) => { if (!stop && !s) setErr(`${e.message} Make sure the Bridge is updated and running and the sim is loaded, then try again.`); })
      .finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [icao, mode, n]);
  return { data, err, loading, retry: () => setN((x) => x + 1) };
}

/** Local metres: x east, y south (SVG down), around the airport reference point. */
function projector(l: AirportLayout) {
  const k = 111_320, c = Math.cos((l.lat * Math.PI) / 180);
  return (p: Pt): [number, number] => [(p[1] - l.lon) * k * c, -(p[0] - l.lat) * k];
}

interface View { x: number; y: number; w: number; h: number }
const aspectNow = () => (typeof innerWidth !== "undefined" && innerWidth <= 700 ? 1.05 : 0.68);

export function TaxiChart({ icao }: { icao: string }) {
  const { data, err, loading, retry } = useLayout(icao);
  if (!data) return (
    <div className="tc-empty">
      <p>{loading ? `Reading ${icao} from the simulator…` : err ?? "No taxi chart yet."}</p>
      {!loading && err && <button className="btn small" onClick={retry}>Try again</button>}
    </div>
  );
  return <TaxiChartView l={data} stale={loading} />;
}

function TaxiChartView({ l, stale }: { l: AirportLayout; stale: boolean }) {
  const P = useMemo(() => projector(l), [l]);
  const theme = document.documentElement.dataset.theme ?? "dark";
  const [night, setNight] = useState(() => { try { const v = localStorage.getItem("glidepath.tcNight"); return v ? v === "1" : theme !== "light"; } catch { return true; } });
  const [follow, setFollow] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(900);

  const g = useMemo(() => buildGeo(l, P), [l, P]);

  const fit = (): View => {
    const { x0, x1, y0, y1 } = g.box; const pad = Math.max(x1 - x0, y1 - y0) * (aspectNow() > 1 ? 0.17 : 0.1) + 90; // room for the runway numbers outside the ends
    const w0 = x1 - x0 + pad * 2, h0 = y1 - y0 + pad * 2, a = aspectNow();
    const w = Math.max(w0, h0 / a), h = w * a; // the whole airport fits, whatever the screen's shape
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
  };
  const [view, setView] = useState<View>(fit);
  useEffect(() => { setView(fit()); }, [l.icao]);
  useEffect(() => { try { localStorage.setItem("glidepath.tcNight", night ? "1" : "0"); } catch { /* private */ } }, [night]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(() => setPx(el.clientWidth || 900)); ro.observe(el); setPx(el.clientWidth || 900);
    return () => ro.disconnect();
  }, []);

  // Your aircraft, when it's at this airport (only whether it's here re-renders the chart; its moves don't)
  const here = useApp((s) => { const f = s.frame; if (!f) return false; const [x, y] = P([f.position.lat, f.position.lon]); const { x0, x1, y0, y1 } = g.box; return x > x0 - 3000 && x < x1 + 3000 && y > y0 - 3000 && y < y1 + 3000; });
  useEffect(() => {
    if (!follow) return;
    let last: unknown = null;
    const go = () => { const f = store.get().frame; if (!f || f === last) return; last = f; const [x, y] = P([f.position.lat, f.position.lon]); setView((v) => ({ ...v, x: x - v.w / 2, y: y - v.h / 2 })); };
    go();
    const off = store.subscribe(go); return () => { off(); };
  }, [follow, P]);

  // Aspect: the SVG keeps the view's centre; the view's width drives the scale.
  const aspect = aspectNow();
  const vb = { x: view.x, y: view.y + (view.h - view.w * aspect) / 2, w: view.w, h: view.w * aspect };
  const scale = px / vb.w; // screen px per metre
  const u = 1 / scale; // one screen pixel in metres
  const zoomAt = (k: number, cx?: number, cy?: number) => setView((v) => {
    const w = Math.max(150, Math.min(fit().w * 2.5, v.w * k)), h = v.h * (w / v.w);
    const ox = cx ?? v.x + v.w / 2, oy = cy ?? v.y + v.h / 2;
    return { x: ox - (ox - v.x) * (w / v.w), y: oy - (oy - v.y) * (h / v.h), w, h };
  });

  // Drag and pinch
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const svgRef = useRef<SVGSVGElement>(null);
  const toWorld = (cx: number, cy: number) => { const r = svgRef.current!.getBoundingClientRect(); return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h }; };
  const down = (e: RPE<SVGSVGElement>) => { (e.target as Element).setPointerCapture?.(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); setFollow(false); };
  const move = (e: RPE<SVGSVGElement>) => {
    const prev = pts.current.get(e.pointerId); if (!prev) return;
    const r = svgRef.current!.getBoundingClientRect(); const mpp = vb.w / r.width;
    if (pts.current.size === 1) setView((v) => ({ ...v, x: v.x - (e.clientX - prev.x) * mpp, y: v.y - (e.clientY - prev.y) * mpp }));
    else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]; const other = a === prev ? b! : a!;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0 && d1 > 0) { const c = toWorld((e.clientX + other.x) / 2, (e.clientY + other.y) / 2); zoomAt(d0 / d1, c.x, c.y); }
    }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const up = (e: RPE<SVGSVGElement>) => { pts.current.delete(e.pointerId); };
  // Coalesce pointer moves into one update per screen frame (iPads send 120 a second).
  const pend = useRef<RPE<SVGSVGElement>[]>([]); const rafId = useRef(0);
  const moveQ = (e: RPE<SVGSVGElement>) => { pend.current.push(e); if (!rafId.current) rafId.current = requestAnimationFrame(() => { rafId.current = 0; const q = pend.current; pend.current = []; for (const x of q) move(x); }); };
  useEffect(() => () => cancelAnimationFrame(rafId.current), []);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const c = toWorld(e.clientX, e.clientY); zoomAt(Math.exp(e.deltaY * 0.0015), c.x, c.y); setFollow(false); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  // Everything drawn scales in steps (each about 20% of zoom), so panning and live updates
  // never redraw the thousands of taxiway lines at a big hub; only zooming a step does.
  const uq = Math.pow(1.2, Math.round(Math.log(u) / Math.log(1.2)));
  const layers = useMemo(() => <StaticLayers g={g} u={uq} />, [g, uq]);
  return (
    <div className={`tc ${night ? "night" : "day"}`} ref={host}>
      <div className="tc-bar">
        <b>{l.icao}</b><span className="tc-sub">Taxi chart · from your sim's scenery{stale ? " · updating…" : ""}</span>
        <div className="tc-tools">
          <button className="btn small" onClick={() => zoomAt(0.7)} aria-label="Zoom in">+</button>
          <button className="btn small" onClick={() => zoomAt(1.4)} aria-label="Zoom out">−</button>
          <button className="btn small" onClick={() => { setFollow(false); setView(fit()); }}>Whole airport</button>
          {here && <button className={`btn small${follow ? " primary" : ""}`} onClick={() => { setFollow(!follow); if (!follow) setView((v) => ({ ...v, w: Math.min(v.w, 1400), h: Math.min(v.w, 1400) })); }}>Follow me</button>}
          <button className="btn small" onClick={() => setNight(!night)}>{night ? "Day" : "Night"}</button>
        </div>
      </div>
      <svg ref={svgRef} className="tc-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onPointerDown={down} onPointerMove={moveQ} onPointerUp={up} onPointerCancel={up} role="img" aria-label={`Taxi chart of ${l.icao}`}>
        <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} className="tc-bg" />
        {layers}
        {here && <TaxiMe P={P} u={u} />}
      </svg>
      <div className="tc-key">
        <span><i className="k-twy" />Taxiway</span><span><i className="k-rwy" />Runway</span><span><i className="k-hold" />Hold short</span><span><i className="k-lbl">A</i>Taxiway name</span>
        <span className="tc-note">Drawn from MSFS scenery, not an official chart. Follow ATC and your official charts.</span>
      </div>
    </div>
  );
}

type Geo = ReturnType<typeof buildGeo>;

/** Your aircraft: subscribes to the sim on its own, so only this moves with each update. */
function TaxiMe({ P, u }: { P: (p: Pt) => [number, number]; u: number }) {
  const f = useApp((s) => s.frame);
  if (!f) return null;
  const [x, y] = P([f.position.lat, f.position.lon]);
  return (
    <g transform={`translate(${x} ${y}) rotate(${(f.attitude.headingTrueDeg ?? 0) - 90}) scale(${Math.max(1.1 * u, 0.9)})`} className="tc-me">
      <circle r={22} className="tc-me-halo" />
      <path d="M16 0C16-1.4 14.3-2.4 12.3-2.4H3.2L-5.9-15h-3.2l4.3 12.6H-11.8L-15.5-7.5h-2.1l1.7 5.1v4.8l-1.7 5.1h2.1l3.7-5.1h7l-4.3 12.6h3.2L3.2 2.4h9.1C14.3 2.4 16 1.4 16 0z" />
    </g>
  );
}

/** The chart itself, drawn for one zoom step. u = metres per screen pixel. */
function StaticLayers({ g, u }: { g: Geo; u: number }) {
  const fs = 12.5 * u; // label size in metres, so it reads the same at any zoom
  const scale = 1 / u;
  const showGates = scale > 0.45;
  // Taxiway names: spaced about 260 px apart on screen, so zooming in shows more of them.
  const labels: Array<{ x: number; y: number; t: string }> = [];
  const gap = 260 * u;
  for (const [t, list] of g.byName) {
    const placed: Array<[number, number]> = [];
    for (const [x, y] of list) {
      if (placed.every((q) => Math.hypot(q[0] - x, q[1] - y) > gap)) { placed.push([x, y]); labels.push({ x, y, t }); }
      if (placed.length >= 40) break;
    }
  }
  const rwLabel = (r: Geo["rw"][number], end: 0 | 1) => {
    const [x, y] = end ? r.e2 : r.e1; const dir = end ? 1 : -1;
    const ox = Math.sin(r.a) * dir * 26 * u, oy = -Math.cos(r.a) * dir * 26 * u;
    return { x: x + ox, y: y + oy, t: end ? r.ends[1] : r.ends[0] };
  };
  const ground = g.segs.filter((s) => s.kind !== "runway");
  return (<>
    {/* aprons and stands */}
    <g className="tc-apron">{g.gates.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={Math.max(8, p.r)} />)}</g>
    {/* taxiways: edge, surface, centre line (one path per layer and width: fast to draw at big hubs) */}
    <g className="tc-edge">{byWidth(ground).map(([w, d]) => <path key={w} d={d} strokeWidth={w + 3 * u} />)}</g>
    <g className="tc-twy">
      {byWidth(ground.filter((s) => s.kind !== "closed" && s.kind !== "parking")).map(([w, d]) => <path key={w} d={d} strokeWidth={w} />)}
      {byWidth(ground.filter((s) => s.kind === "parking")).map(([w, d]) => <path key={`p${w}`} d={d} strokeWidth={w} className="park" />)}
      {byWidth(ground.filter((s) => s.kind === "closed")).map(([w, d]) => <path key={`c${w}`} d={d} strokeWidth={w} className="closed" />)}
    </g>
    <g className="tc-cl"><path d={pathOf(g.segs.filter((s) => s.kind === "taxi"))} strokeWidth={1.2 * u} /></g>
    {/* runways */}
    <g className="tc-rwy">
      {g.rw.map((r, i) => (
        <g key={i}>
          <line x1={r.e1[0]} y1={r.e1[1]} x2={r.e2[0]} y2={r.e2[1]} strokeWidth={r.widthM + 3 * u} className="tc-rwy-e" />
          <line x1={r.e1[0]} y1={r.e1[1]} x2={r.e2[0]} y2={r.e2[1]} strokeWidth={Math.max(1, r.widthM - 1.5 * u)} className="tc-rwy-s" />
          <line x1={r.e1[0]} y1={r.e1[1]} x2={r.e2[0]} y2={r.e2[1]} strokeWidth={1.4 * u} strokeDasharray={`${12 * u} ${10 * u}`} className="tc-rwy-cl" />
        </g>
      ))}
    </g>
    {/* hold-short bars */}
    <g className="tc-hold">{g.holds.map((h, i) => <rect key={i} x={h.x - h.w * 0.6} y={h.y - 1.6 * u} width={h.w * 1.2} height={(h.ils ? 4.5 : 3.2) * u} transform={`rotate(${h.ang} ${h.x} ${h.y})`} className={h.ils ? "ils" : ""} />)}</g>
    {/* gate and stand names when zoomed in */}
    {showGates && <g className="tc-gate" style={{ fontSize: fs * 0.85 }}>{g.gates.filter((p) => p.name).map((p, i) => <text key={i} x={p.x} y={p.y + fs * 0.3} textAnchor="middle">{p.name}</text>)}</g>}
    {/* taxiway name boxes */}
    <g className="tc-lbl" style={{ fontSize: fs }}>
      {labels.map((b, i) => { const w = (b.t.length * 0.66 + 0.9) * fs, h = fs * 1.45; return <g key={i}><rect x={b.x - w / 2} y={b.y - h / 2} width={w} height={h} rx={fs * 0.22} /><text x={b.x} y={b.y + fs * 0.36} textAnchor="middle">{b.t}</text></g>; })}
    </g>
    {/* runway numbers */}
    <g className="tc-rwlbl" style={{ fontSize: fs * 1.15 }}>
      {g.rw.flatMap((r, i) => ([0, 1] as const).map((e) => { const p = rwLabel(r, e); const w = (p.t.length * 0.68 + 1) * fs * 1.15, h = fs * 1.7; return <g key={`${i}-${e}`}><rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={fs * 0.3} /><text x={p.x} y={p.y + fs * 0.42} textAnchor="middle">{p.t}</text></g>; }))}
    </g>
  </>);
}

type Seg = Geo["segs"][number];
const pathOf = (list: Seg[]) => list.map((s) => `M${s.A[0].toFixed(1)} ${s.A[1].toFixed(1)}L${s.B[0].toFixed(1)} ${s.B[1].toFixed(1)}`).join("");
/** Segments grouped by width (rounded to a metre), one path each. */
function byWidth(list: Seg[]): Array<[number, string]> {
  const m = new Map<number, Seg[]>();
  for (const s of list) { const w = Math.max(3, Math.round(s.w)); m.set(w, [...(m.get(w) ?? []), s]); }
  return [...m].sort((a, b) => b[0] - a[0]).map(([w, l]) => [w, pathOf(l)]);
}

/** Geometry in local metres. */
function buildGeo(l: AirportLayout, P: (p: Pt) => [number, number]) {
    const segs = l.paths.map((p) => ({ ...p, A: P(p.a), B: P(p.b) }));
    const rw = l.runways.map((r) => {
      const [cx, cy] = P([r.lat, r.lon]); const a = ((r.hdg) * Math.PI) / 180;
      const dx = Math.sin(a) * r.lengthM / 2, dy = -Math.cos(a) * r.lengthM / 2; // toward the primary end's heading
      return { ...r, cx, cy, a, e1: [cx - dx, cy - dy] as [number, number], e2: [cx + dx, cy + dy] as [number, number] };
    });
    const xs: number[] = [], ys: number[] = [];
    for (const s of segs) { xs.push(s.A[0], s.B[0]); ys.push(s.A[1], s.B[1]); }
    for (const r of rw) { xs.push(r.e1[0], r.e2[0]); ys.push(r.e1[1], r.e2[1]); }
    const box = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : { x0: -1000, x1: 1000, y0: -1000, y1: 1000 };
    // Taxiway label candidates: every named segment's midpoint, longest first (spaced out per zoom below).
    const byName = new Map<string, Array<[number, number, number]>>();
    for (const s of segs) if (s.name && s.kind === "taxi") byName.set(s.name, [...(byName.get(s.name) ?? []), [(s.A[0] + s.B[0]) / 2, (s.A[1] + s.B[1]) / 2, Math.hypot(s.B[0] - s.A[0], s.B[1] - s.A[1])]]);
    for (const list of byName.values()) list.sort((a, b) => b[2] - a[2]);
    // Hold-short bars across the taxiway they sit on
    const holds = l.holds.map((h) => {
      const [x, y] = P(h.p);
      let best: (typeof segs)[number] | null = null, bd = 60;
      for (const s of segs) {
        if (s.kind === "runway") continue;
        const vx = s.B[0] - s.A[0], vy = s.B[1] - s.A[1], len2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - s.A[0]) * vx + (y - s.A[1]) * vy) / len2));
        const d = Math.hypot(s.A[0] + t * vx - x, s.A[1] + t * vy - y);
        if (d < bd) { bd = d; best = s; }
      }
      const ang = best ? Math.atan2(best.B[1] - best.A[1], best.B[0] - best.A[0]) * 180 / Math.PI + 90 : 0;
      return { x, y, ang, w: best?.w ?? 20, ils: h.ils };
    });
    const gates = l.parking.map((p) => { const [x, y] = P(p.p); return { ...p, x, y }; });
    return { segs, rw, box, byName, holds, gates };
}
