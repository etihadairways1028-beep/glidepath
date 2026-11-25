/**
 * Procedure charts (SID, STAR, approach) drawn from the simulator's navigation data, in the
 * conventions of a printed chart: title block, north arrow, scale, fix symbols, restrictions,
 * course and distance on every leg, holds, the missed approach and (for approaches) a profile.
 * Generated from MSFS navdata: for simulation use, not an official chart.
 */
import { useEffect, useMemo, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { airportDetail, type AirportDetail } from "../data/airports";
import { declination, holdShape, magToTrue, type Hold } from "../data/hold";
import { navCached, navKeep } from "./Procedures";
import { usePaths, type PubHold } from "./FlightSetup";

export interface Fix {
  ident: string; lat: number; lon: number; altFt: number | null; alt2Ft?: number | null;
  altDesc?: "at" | "above" | "below" | "between" | null; speedKt?: number | null;
  courseDeg?: number | null; trueCourse?: boolean; distNm?: number | null; flyOver?: boolean;
  role?: "IAF" | "IF" | "FAF" | "MAP" | null; vAngle?: number | null;
}
export interface SidStar { name: string; kind: "sid" | "star"; runways: Array<{ runway: string; legs: Fix[] }>; common: Fix[]; enroute: Array<{ name: string; legs: Fix[] }>; holds: PubHold[] }
type Approach = { name: string; runway: string; final: Fix[]; transitions: Array<{ name: string; legs: Fix[] }>; missed?: Fix[]; holds?: PubHold[] };

export function useSidStar(icao: string | null) {
  const mode = useApp((s) => s.mode);
  const [v, setV] = useState<SidStar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    setErr(null);
    if (!icao) { setV(null); return; }
    const c = navCached<SidStar[]>(icao, ".sidstar"); setV(c);
    const b = activeBridge();
    if (mode !== "bridge" || !b) { if (!c) setErr("Procedure charts are drawn from Microsoft Flight Simulator's navigation data through the Bridge on your PC. Connect it with the sim running once, and Glidepath keeps the airport."); return; }
    let stop = false;
    b.get<SidStar[]>(`/api/procedures/${icao}/sidstar`).then((r) => { if (!stop && Array.isArray(r)) { setV(r); navKeep(icao, r, ".sidstar"); } })
      .catch((e: Error) => { if (!stop && !c) setErr(`${e.message} Make sure the Bridge is updated and running and the sim is loaded, then try again.`); });
    return () => { stop = true; };
  }, [icao, mode, n]);
  return { data: v, err, retry: () => setN((x) => x + 1) };
}

/* ---------- formatting, as on a printed chart ---------- */
const ft = (v: number) => (v >= 18000 ? `FL${String(Math.round(v / 100)).padStart(3, "0")}` : String(Math.round(v)));
const deg = (d: number) => `${String(Math.round(d) % 360 || 360).padStart(3, "0")}°`;
const nmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 3440.065, r = Math.PI / 180, dφ = (b.lat - a.lat) * r, dλ = (b.lon - a.lon) * r;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const trueCourse = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
};

interface Line { fixes: Fix[]; style: "main" | "trans" | "missed" }

export function ProcChart({ icao, kind, name, trans }: { icao: string; kind: "app" | "sid" | "star"; name: string; trans?: string | null }) {
  const live = useApp((s) => s.mode) === "bridge";
  const paths = usePaths(icao, live) as unknown as Approach[] | null;
  const ss = useSidStar(kind === "app" ? null : icao);
  const [apt, setApt] = useState<AirportDetail | null>(null);
  useEffect(() => { let off = false; void airportDetail(icao).then((a) => { if (!off) setApt(a); }).catch(() => undefined); return () => { off = true; }; }, [icao]);
  const [night, setNight] = useState(() => { try { return localStorage.getItem("glidepath.plateNight") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("glidepath.plateNight", night ? "1" : "0"); } catch { /* private */ } }, [night]);

  // The lines to draw, in flying order.
  const built = useMemo(() => {
    const lines: Line[] = []; let holds: PubHold[] = []; let title = name; let runway = ""; let final: Fix[] = []; let missed: Fix[] = [];
    if (kind === "app") {
      const a = paths?.find((p) => p.name === name);
      if (!a) return null;
      runway = a.runway; final = a.final; missed = a.missed ?? []; holds = a.holds ?? [];
      for (const t of a.transitions) if (!trans || t.name === trans) lines.push({ fixes: [...t.legs], style: "trans" });
      lines.push({ fixes: a.final, style: "main" });
      if (missed.length) lines.push({ fixes: [a.final[a.final.length - 1]!, ...missed], style: "missed" });
      title = `${a.name.replace(/^RNAV/, "RNAV (GNSS)").replace(/ (\d\d[LRC]?)$/, " RWY $1")}`;
    } else {
      const p = ss.data?.find((x) => x.name === name && x.kind === kind);
      if (!p) return null;
      holds = p.holds;
      const rws = p.runways.filter((r) => !trans || r.runway === trans || p.runways.length === 1);
      runway = rws.map((r) => r.runway).join(", ");
      if (kind === "sid") {
        for (const r of rws) lines.push({ fixes: r.legs, style: "main" });
        const join = rws[0]?.legs.at(-1);
        lines.push({ fixes: join && p.common[0]?.ident !== join.ident ? [join, ...p.common] : p.common, style: "main" });
        const last = p.common.at(-1) ?? rws[0]?.legs.at(-1);
        for (const e of p.enroute) lines.push({ fixes: last && e.legs[0]?.ident !== last.ident ? [last, ...e.legs] : e.legs, style: "trans" });
      } else {
        const first = p.common[0] ?? rws[0]?.legs[0];
        for (const e of p.enroute) lines.push({ fixes: first && e.legs.at(-1)?.ident !== first.ident ? [...e.legs, first] : e.legs, style: "trans" });
        lines.push({ fixes: p.common, style: "main" });
        const end = p.common.at(-1);
        for (const r of rws) lines.push({ fixes: end && r.legs[0]?.ident !== end.ident ? [end, ...r.legs] : r.legs, style: "main" });
      }
      title = `${p.name} ${kind === "sid" ? "DEPARTURE" : "ARRIVAL"}`;
    }
    return { lines: lines.filter((l) => l.fixes.length), holds, title, runway, final, missed };
  }, [kind, name, trans, paths, ss.data]);

  const minKey = `glidepath.mins.${icao}.${name}`;
  const [da, setDa] = useState<string>(() => { try { return localStorage.getItem(minKey) ?? ""; } catch { return ""; } });
  useEffect(() => { try { setDa(localStorage.getItem(minKey) ?? ""); } catch { /* private */ } }, [minKey]);
  if (!built) return <div className="pc-empty"><p>{kind !== "app" && ss.err ? ss.err : `Reading ${name} from the simulator…`}</p>{kind !== "app" && ss.err && <button className="btn small" onClick={ss.retry}>Try again</button>}</div>;

  // ---------- plan view geometry (nm, north up) ----------
  const all = built.lines.flatMap((l) => l.fixes);
  const ends = (apt?.runways ?? []).flatMap((r) => r.ends);
  const lat0 = all.reduce((s, f) => s + f.lat, 0) / all.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const P = (lat: number, lon: number): [number, number] => [lon * 60 * cos, -lat * 60];
  const holdPolys = built.holds.map((h) => {
    const hold: Hold = { ident: h.ident, lat: h.lat, lon: h.lon, inboundDeg: h.trueCourse ? h.courseDeg : magToTrue(h.courseDeg, h.lat, h.lon), right: h.right, legMin: h.legMin ?? 1, legNm: h.legNm, kt: Math.min(230, h.speedKt ?? 230) };
    return { h, pts: holdShape(hold).map(([lon, lat]) => P(lat!, lon!)) };
  });
  const xs: number[] = [], ys: number[] = [];
  for (const f of all) { const [x, y] = P(f.lat, f.lon); xs.push(x); ys.push(y); }
  for (const hp of holdPolys) for (const [x, y] of hp.pts) { xs.push(x); ys.push(y); }
  if (apt) { const [x, y] = P(apt.lat, apt.lon); xs.push(x); ys.push(y); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const narrow = typeof innerWidth !== "undefined" && innerWidth < 700;
  const W = narrow ? 560 : 1000, H = narrow ? 640 : 720, pad = narrow ? 56 : 70;
  const sc = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
  const T = (lat: number, lon: number): [number, number] => { const [x, y] = P(lat, lon); return [pad + (x - x0) * sc + ((W - pad * 2) - (x1 - x0) * sc) / 2, pad + (y - y0) * sc + ((H - pad * 2) - (y1 - y0) * sc) / 2]; };
  const varDeg = apt ? declination(apt.lat, apt.lon) : declination(lat0, all[0]!.lon);
  const scaleNm = [1, 2, 5, 10, 20, 50].find((n) => n * sc > 90) ?? 50;

  // Every fix once, with what's published there
  const fixes = new Map<string, Fix>();
  for (const l of built.lines) for (const f of l.fixes) { const k = `${f.ident}${f.lat.toFixed(4)}`; const prev = fixes.get(k); if (!prev || (f.altFt && !prev.altFt) || f.role) fixes.set(k, { ...prev, ...f, altFt: f.altFt ?? prev?.altFt ?? null, role: f.role ?? prev?.role ?? null }); }
  const rwEnds = ends.filter((e) => built.runway.split(", ").includes(e.ident));
  const rwRect = (apt?.runways ?? []).filter((r) => r.ends.some((e) => rwEnds.some((x) => x.ident === e.ident) || built.runway === "")).map((r) => r.ends.map((e) => T(e.threshold.lat, e.threshold.lon)));


  // ---------- profile (approaches) ----------
  const prof = (() => {
    if (kind !== "app" || built.final.length < 2) return null;
    const fin = built.final; const thr = fin[fin.length - 1]!;
    const pts = fin.map((x) => ({ f: x, d: nmBetween(x, thr) }));
    const maxD = Math.max(...pts.map((p) => p.d)), maxA = Math.max(...pts.map((p) => p.f.altFt ?? 0), 1500);
    const faf = fin.find((x) => x.role === "FAF") ?? fin[Math.max(0, fin.length - 3)];
    const ang = fin.find((x) => x.vAngle)?.vAngle ?? null;
    return { pts, maxD, maxA, faf, ang, thr };
  })();

  const altText = (fx: Fix) => {
    if (!fx.altFt) return null;
    if (fx.altDesc === "between" && fx.alt2Ft) return [{ t: ft(Math.max(fx.altFt, fx.alt2Ft)), bar: "over" }, { t: ft(Math.min(fx.altFt, fx.alt2Ft)), bar: "under" }]; // maximum: bar above; minimum: bar below
    return [{ t: ft(fx.altFt), bar: fx.altDesc === "above" ? "under" : fx.altDesc === "below" ? "over" : fx.altDesc === "at" ? "both" : "none" }];
  };
  const finCourse = built.final.length >= 2 ? (built.final.at(-1)!.courseDeg ?? Math.round(trueCourse(built.final.at(-2)!, built.final.at(-1)!) - varDeg)) : null;
  const fafAlt = prof?.faf?.altFt ?? null;
  // Threshold and glidepath: threshold elevation is the airport's (OurAirports); TCH from the runway fix's altitude in the sim's data when it gives one.
  const thrElev = apt?.elevationFt != null ? Math.round(apt.elevationFt) : null;
  const rwAlt = prof?.thr.altFt ?? null;
  const tch = thrElev != null && rwAlt != null && rwAlt - thrElev >= 20 && rwAlt - thrElev <= 120 ? rwAlt - thrElev : 50;
  const tchStd = !(thrElev != null && rwAlt != null && rwAlt - thrElev >= 20 && rwAlt - thrElev <= 120);
  // Altitude at each whole NM to the threshold on the glidepath (calculated, like a chart's CDFA table).
  const fafD = prof && prof.faf ? prof.pts.find((p) => p.f === prof.faf)?.d ?? prof.maxD : 0;
  const table = prof?.ang && thrElev != null ? Array.from({ length: Math.min(10, Math.floor(fafD + 0.001)) }, (_, i) => fafD >= i + 1 ? i + 1 : 0).filter(Boolean).reverse().map((d) => ({ d, a: Math.round((thrElev + tch + d * 6076.12 * Math.tan((prof.ang! * Math.PI) / 180)) / 10) * 10 })) : [];
  // Your baro minimum: not in the sim's data, so you set it from your official chart; saved per approach.
  const daFt = /^\d{2,5}$/.test(da) ? Number(da) : null;
  const missedTop = built.missed.length ? Math.max(...built.missed.map((x) => x.altFt ?? 0)) : 0;

  return (
    <div className={`pc ${night ? "night" : "day"}`}>
      <div className="pc-tools">
        <button className="btn small" onClick={() => setNight(!night)}>{night ? "Day" : "Night"}</button>
        <button className="btn small" onClick={() => window.print()}>Print</button>
      </div>
      <div className="pc-sheet">
        {/* title block */}
        <header className="pc-head">
          <div className="pc-h-l"><b>{icao}</b><span>{apt?.name?.toUpperCase() ?? ""}{apt?.city ? `, ${apt.city.toUpperCase()}` : ""}</span></div>
          <div className="pc-h-c"><b>{built.title}</b>{built.runway && !built.title.includes(`RWY ${built.runway}`) && <span>RWY {built.runway}</span>}</div>
          <div className="pc-h-r"><span>GLIDEPATH</span><span>FROM MSFS NAVDATA</span></div>
        </header>
        <div className="pc-strip">
          <span><em>VAR</em>{Math.abs(varDeg).toFixed(0)}°{varDeg >= 0 ? "E" : "W"}</span>
          {kind === "app" && finCourse !== null && <span><em>FINAL CRS</em>{deg(finCourse)}</span>}
          {kind === "app" && fafAlt && <span><em>FAF</em>{prof?.faf?.ident} {ft(fafAlt)}</span>}
          {prof?.ang && <span><em>GP</em>{prof.ang.toFixed(2)}°</span>}
          {apt?.elevationFt != null && <span><em>ELEV</em>{Math.round(apt.elevationFt)}</span>}
          {kind === "app" && prof && <span><em>TCH</em>{tch}{tchStd ? " (std)" : ""}</span>}
          {kind === "app" && missedTop > 0 && <span><em>MISSED ALT</em>{ft(missedTop)}</span>}
          {trans && <span><em>TRANS</em>{trans}</span>}
        </div>
        {/* plan view */}
        <svg className="pc-plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${built.title} plan view`}>
          <defs>
            <marker id="pc-arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" className="pc-ink-f" /></marker>
          </defs>
          <rect x="0" y="0" width={W} height={H} className="pc-paper" />
          {/* holds */}
          {holdPolys.map((hp, i) => <polyline key={i} points={hp.pts.map((p) => { const [x, y] = [pad + (p[0] - x0) * sc + ((W - pad * 2) - (x1 - x0) * sc) / 2, pad + (p[1] - y0) * sc + ((H - pad * 2) - (y1 - y0) * sc) / 2]; return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ")} className="pc-hold" />)}
          {holdPolys.map((hp, i) => {
            const pts = hp.pts.map((p) => [pad + (p[0] - x0) * sc + ((W - pad * 2) - (x1 - x0) * sc) / 2, pad + (p[1] - y0) * sc + ((H - pad * 2) - (y1 - y0) * sc) / 2]);
            const cx = pts.reduce((a, p) => a + p[0]!, 0) / pts.length, cy = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
            const [fx, fy] = T(hp.h.lat, hp.h.lon); const away = Math.hypot(cx - fx, cy - fy) || 1;
            const lx = cx + ((cx - fx) / away) * 26, ly = cy + ((cy - fy) / away) * 26;
            const inb = hp.h.trueCourse ? hp.h.courseDeg - varDeg : hp.h.courseDeg;
            return <text key={`t${i}`} x={lx} y={ly} className="pc-small pc-halo" textAnchor="middle"><tspan x={lx}>{deg(inb)}</tspan><tspan x={lx} dy={13}>{hp.h.legNm ? `${hp.h.legNm} NM` : `${hp.h.legMin ?? 1} MIN`}</tspan></text>;
          })}
          {/* runway */}
          {rwRect.map((r, i) => r.length === 2 && <line key={i} x1={r[0]![0]} y1={r[0]![1]} x2={r[1]![0]} y2={r[1]![1]} className="pc-rwy" />)}
          {/* legs */}
          {built.lines.map((l, li) => l.fixes.slice(1).map((b, i) => {
            const a = l.fixes[i]!; const [ax, ay] = T(a.lat, a.lon), [bx, by] = T(b.lat, b.lon);
            const len = Math.hypot(bx - ax, by - ay); if (len < 2) return null;
            const mx = (ax + bx) / 2, my = (ay + by) / 2; let ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI; const flip = ang > 90 || ang < -90; if (flip) ang += 180;
            const crs = b.courseDeg ?? Math.round(trueCourse(a, b) - varDeg); const dist = b.distNm ?? Math.round(nmBetween(a, b) * 10) / 10;
            return (
              <g key={`${li}-${i}`}>
                <line x1={ax} y1={ay} x2={bx} y2={by} className={`pc-leg ${l.style}`} markerEnd={l.style !== "missed" && len > 70 ? "url(#pc-arr)" : undefined} />
                {len > 58 && l.style !== "missed" && <text transform={`translate(${mx} ${my}) rotate(${ang})`} y={-7} textAnchor="middle" className="pc-crs pc-halo">{deg(crs)}<tspan dx="8" className="pc-dist">{dist.toFixed(1)}</tspan></text>}
              </g>
            );
          }))}
          {/* fixes */}
          {[...fixes.values()].map((fx, i) => {
            const [x, y] = T(fx.lat, fx.lon); const al = altText(fx); const rw = /^RW\d/.test(fx.ident);
            return (
              <g key={i} transform={`translate(${x} ${y})`}>
                {rw ? <circle r={3} className="pc-ink-f" /> : fx.role === "FAF" ? <path d="M-7,-7 L7,7 M-7,7 L7,-7" className="pc-sym" /> : <path d="M0,-8 L2,-2 L8,0 L2,2 L0,8 L-2,2 L-8,0 L-2,-2 Z" className="pc-wpt" />}
                {fx.flyOver && !rw && <circle r={10} className="pc-sym" />}
                {!rw && <text x={11} y={-6} className="pc-id pc-halo">{fx.ident}{fx.role && fx.role !== "MAP" ? <tspan className="pc-role"> ({fx.role})</tspan> : null}</text>}
                {al?.map((a, j) => (
                  <g key={j}>
                    <text x={11} y={10 + j * 14} className="pc-alt pc-halo">{a.t}</text>
                    {(a.bar === "over" || a.bar === "both") && <line x1={11} x2={11 + a.t.length * 7.6} y1={10 + j * 14 - 11} y2={10 + j * 14 - 11} className="pc-bar" />}
                    {(a.bar === "under" || a.bar === "both") && <line x1={11} x2={11 + a.t.length * 7.6} y1={10 + j * 14 + 3} y2={10 + j * 14 + 3} className="pc-bar" />}
                  </g>
                ))}
                {fx.speedKt && <text x={11} y={10 + (al?.length ?? 0) * 14 + (al ? 2 : 0)} className="pc-small pc-halo">MAX {fx.speedKt}K</text>}
              </g>
            );
          })}
          {rwEnds.map((e, i) => { const [x, y] = T(e.threshold.lat, e.threshold.lon); return <text key={i} x={x + 8} y={y + 16} className="pc-id pc-halo">RWY {e.ident}</text>; })}
          {/* north arrow and scale */}
          <g transform={`translate(${W - 50} 60)`} className="pc-north"><path d="M0,-26 L9,10 L0,4 L-9,10 Z" className="pc-ink-f" /><text y={26} textAnchor="middle" className="pc-small">N</text></g>
          <g transform={`translate(${pad} ${H - 30})`}><line x1={0} x2={scaleNm * sc} y1={0} y2={0} className="pc-scale" /><line x1={0} x2={0} y1={-5} y2={5} className="pc-scale" /><line x1={scaleNm * sc} x2={scaleNm * sc} y1={-5} y2={5} className="pc-scale" /><text x={scaleNm * sc + 8} y={4} className="pc-small">{scaleNm} NM</text></g>
          <PlateMe T={T} W={W} H={H} />
        </svg>
        {/* profile */}
        {prof && (() => {
          const PW = narrow ? 560 : 1000, PH = 230, l = 52, r = 34, t = 44, b = 46;
          const X = (d: number) => PW - r - (d / Math.max(0.1, prof.maxD)) * (PW - l - r), Y = (a: number) => PH - b - (a / prof.maxA) * (PH - t - b);
          const pts = prof.pts.filter((p) => p.f.altFt || /^RW/.test(p.f.ident));
          const thrAlt = (apt?.elevationFt ?? 0) + 50;
          return (
            <svg className="pc-prof" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Approach profile">
              <rect x="0" y="0" width={PW} height={PH} className="pc-paper" />
              <line x1={l} x2={PW - r} y1={PH - b} y2={PH - b} className="pc-ground" />
              <polyline points={pts.map((p) => `${X(p.d)},${Y(/^RW/.test(p.f.ident) ? thrAlt : p.f.altFt!)}`).join(" ")} className="pc-leg main" />
              {pts.map((p, i) => (
                <g key={i}>
                  <line x1={X(p.d)} x2={X(p.d)} y1={Y(/^RW/.test(p.f.ident) ? thrAlt : p.f.altFt!)} y2={PH - b} className="pc-drop" />
                  <text x={X(p.d)} y={PH - b + 16} textAnchor="middle" className="pc-id">{p.f.ident}</text>
                  <text x={X(p.d)} y={PH - b + 30} textAnchor="middle" className="pc-small">{p.d.toFixed(1)} NM</text>
                  {p.f.altFt && <text x={X(p.d)} y={Y(p.f.altFt) - 8} textAnchor="middle" className="pc-alt">{ft(p.f.altFt)}</text>}
                  {p.f.role === "FAF" && <path transform={`translate(${X(p.d)} ${Y(p.f.altFt ?? 0)})`} d="M-6,-6 L6,6 M-6,6 L6,-6" className="pc-sym" />}
                </g>
              ))}
              {prof.ang && <text x={(X(prof.pts[0]!.d) + X(0)) / 2} y={t + 6} textAnchor="middle" className="pc-small">GP {prof.ang.toFixed(2)}° · TCH {tch}{tchStd ? " (std)" : ""}</text>}
              {daFt && daFt < prof.maxA && <g><line x1={l} x2={PW - r} y1={Y(daFt)} y2={Y(daFt)} className="pc-da" /><text x={l + 4} y={Y(daFt) - 5} className="pc-alt">BARO MIN {daFt}</text></g>}
              <text x={PW - r} y={18} textAnchor="end" className="pc-small">PROFILE · ALTITUDES IN FT AMSL</text>
            </svg>
          );
        })()}
        {kind === "app" && prof && (
          <div className="pc-mins">
            <div className="pc-mins-h">MINIMUMS</div>
            <label className="pc-da-in"><span>BARO DA / MDA</span>
              <input className="pc-plain" inputMode="numeric" style={{ width: 84, height: 32, border: "1.5px solid currentColor", borderRadius: 4, background: "transparent", boxShadow: "none", padding: "0 6px", color: "inherit", font: "800 15px var(--mono, ui-monospace, monospace)", textAlign: "center" }} value={da} placeholder="ft" maxLength={5} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setDa(v); try { if (v) localStorage.setItem(minKey, v); else localStorage.removeItem(minKey); } catch { /* private */ } }} aria-label="Your baro minimum in feet" />
            </label>
            {daFt && thrElev != null && <span className="pc-hat"><em>HAT</em>{daFt - thrElev} ft</span>}
            <span className="pc-mins-note">{daFt ? "Your value, from your official chart." : "Not in the simulator's data. Enter the DA or MDA from your official chart; Glidepath keeps it for this approach."}</span>
          </div>
        )}
        {table.length > 1 && (
          <div className="pc-table-w"><table className="pc-table">
            <caption>ALTITUDE ON THE GLIDEPATH · CALCULATED FROM GP {prof!.ang!.toFixed(2)}°, THR {thrElev} + TCH {tch}</caption>
            <tbody>
              <tr><th>NM TO THR</th>{table.map((r) => <td key={r.d}>{r.d}</td>)}</tr>
              <tr><th>ALT (FT)</th>{table.map((r) => <td key={r.d}>{r.a.toLocaleString("en-US")}</td>)}</tr>
            </tbody>
          </table></div>
        )}
        {kind === "app" && built.missed.length > 0 && (
          <p className="pc-missed"><b>MISSED APPROACH:</b> {(() => { const m = built.missed; const top = Math.max(...m.map((x) => x.altFt ?? 0)); const last = m.at(-1)!; const held = built.holds.some((h) => h.ident === last.ident); return `Climb${top ? ` to ${ft(top)}` : ""}, proceed ${m.filter((x) => !/^RW/.test(x.ident)).map((x) => x.ident).join(" – ")}${held ? ` and hold at ${last.ident}` : ""}.`; })()}</p>
        )}
        <footer className="pc-foot">Generated by Glidepath from your simulator's navigation data. For simulation use only. Not for real-world navigation. Check against official charts.</footer>
      </div>
    </div>
  );
}

/** Your aircraft on the plate: only this redraws with each sim update, not the whole chart. */
function PlateMe({ T, W, H }: { T: (lat: number, lon: number) => [number, number]; W: number; H: number }) {
  const f = useApp((s) => s.frame);
  if (!f) return null;
  const me = T(f.position.lat, f.position.lon);
  if (!(me[0] > -50 && me[0] < W + 50 && me[1] > -50 && me[1] < H + 50)) return null;
  return <g transform={`translate(${me[0]} ${me[1]}) rotate(${(f.attitude.headingTrueDeg ?? 0) - 90})`} className="pc-me"><path d="M16 0C16-1.4 14.3-2.4 12.3-2.4H3.2L-5.9-15h-3.2l4.3 12.6H-11.8L-15.5-7.5h-2.1l1.7 5.1v4.8l-1.7 5.1h2.1l3.7-5.1h7l-4.3 12.6h3.2L3.2 2.4h9.1C14.3 2.4 16 1.4 16 0z" /></g>;
}
