/**
 * Home while you fly: a dashboard of the things you glance at. Live map, the four numbers that
 * matter with their trend, the next waypoint, the weather where you're going, and what just happened.
 */
import { MiniApproach } from "../screens/Approach";
import { useEffect, useState } from "react";
import type { Metar } from "@glidepath/protocol";
import { routeProgress } from "@glidepath/flight-engine";
import { MapView } from "./MapView";
import { FlightFeed } from "./LiveCard";
import { Roll } from "./ui";
import { sparkPath, useSeries } from "../data/history";
import { fmt, fuel, useLive } from "../data/derive";
import { nm } from "../data/trafficTracks";
import { getMetar } from "../data/external";
import { useApp, useSettings } from "../data/store";

function Spark({ v, color }: { v: number[]; color: string }) {
  const p = sparkPath(v, 160, 44);
  if (!p) return <div className="bt-spark empty" />;
  const id = `sg${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg className="bt-spark" viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={p.area} fill={`url(#${id})`} />
      <path d={p.line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ k, v, unit, sub, spark, color, tone }: { k: string; v: string; unit?: string; sub?: string; spark: number[]; color: string; tone?: "up" | "down" | null }) {
  return (
    <div className="b-tile glass">
      <span className="bt-k">{k}</span>
      <span className="bt-v data"><Roll text={v} />{unit && <small>{unit}</small>}{tone && <i className={`bt-tone ${tone}`} aria-hidden="true">{tone === "up" ? "▲" : "▼"}</i>}</span>
      {sub && <span className="bt-sub">{sub}</span>}
      <Spark v={spark} color={color} />
    </div>
  );
}

function DestWeather({ icao }: { icao: string }) {
  const [m, setM] = useState<Metar | null | "none">(null);
  useEffect(() => {
    let off = false;
    const go = () => void getMetar([icao]).then((r) => { if (!off) setM(r[0] ?? "none"); }).catch(() => { if (!off) setM("none"); });
    go(); const t = window.setInterval(go, 5 * 60_000);
    return () => { off = true; clearInterval(t); };
  }, [icao]);
  const cat = m && m !== "none" ? m.category : null;
  return (
    <a className="b-card glass b-wx" href={`#/weather`}>
      <span className="bt-k">Weather at {icao}</span>
      {m === null ? <span className="bt-sub">Loading…</span> : m === "none" ? <span className="bt-sub">No report right now.</span> : (<>
        <div className="bw-row">
          <b className="data">{m.tempC != null ? `${Math.round(m.tempC)}°` : "—"}</b>
          {cat && <span className={`bw-cat ${cat.toLowerCase()}`}>{cat}</span>}
        </div>
        <span className="bw-wind data">{m.windDir == null ? "Wind —" : m.windKt === 0 ? "Calm" : `${m.windDir === "VRB" ? "Variable" : String(m.windDir).padStart(3, "0") + "°"} ${m.windKt} kt${m.gustKt ? ` G${m.gustKt}` : ""}`}{m.qnhHpa ? ` · Q${m.qnhHpa}` : ""}</span>
        <span className="bt-sub">{m.clouds.length ? m.clouds.slice(0, 2).map((c) => `${c.cover}${c.baseFt != null ? ` ${String(Math.round(c.baseFt / 100)).padStart(3, "0")}` : ""}`).join(" ") : "No cloud reported"}{m.visibility ? ` · vis ${m.visibility}` : ""}</span>
      </>)}
    </a>
  );
}

function NextWaypoint() {
  const L = useLive();
  const f = L.frame;
  if (!L.plan || !f || L.completed) return null;
  const route = [{ lat: L.plan.origin.lat, lon: L.plan.origin.lon }, ...L.plan.fixes, { lat: L.plan.destination.lat, lon: L.plan.destination.lon }];
  const idx = f.position.onGround ? 0 : routeProgress(route, f.position)?.legIndex ?? 0;
  const fx = idx < L.plan.fixes.length ? L.plan.fixes[idx]! : null;
  const to = fx ?? L.plan.destination;
  const d = nm(f.position, to), gs = f.speed.gsKt ?? 0;
  const ident = fx ? (/^TO?[CD]$|^T\/[CD]$/.test(fx.ident) ? (/C$/.test(fx.ident) ? "T/C" : "T/D") : fx.ident) : L.plan.destination.icao;
  const alt = fx?.altitudeFt;
  const pct = L.plan.fixes.length ? Math.round((idx / (L.plan.fixes.length + 1)) * 100) : 0;
  return (
    <a className="b-card glass b-next" href="#/flight">
      <span className="bt-k">Next waypoint</span>
      <b className="bn-id data">{ident}</b>
      <span className="bn-meta data">{fmt(d)} nm{gs > 40 ? ` · ${Math.max(1, Math.round((d / gs) * 60))} min` : ""}{alt != null ? ` · ${alt >= 10000 ? `FL${String(Math.round(alt / 100)).padStart(3, "0")}` : `${fmt(alt)} ft`}` : ""}</span>
      <span className="bn-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      <span className="bt-sub">{fx?.via && fx.via !== "DCT" ? `Via ${fx.via}` : `Waypoint ${Math.min(idx + 1, L.plan.fixes.length)} of ${L.plan.fixes.length}`}</span>
    </a>
  );
}

export function Bento() {
  const L = useLive();
  const S = useSeries();
  const { fuelUnit } = useSettings();
  const trail = useApp((s) => s.trail);
  const f = L.frame;
  if (!f || L.completed) return null;
  const aircraft = f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg, alt: f.position.altMslFt } : null;
  const vs = f.speed.vsFpm ?? 0;
  const alt = f.position.altMslFt;
  const dest = L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? null;
  // Burn over the last minute (30 samples, 2 s apart); ignore jumps such as a refuel or a demo skip.
  const fw = S.fuel.slice(-30);
  const burnRaw = fw.length >= 15 ? (fw[0]! - fw.at(-1)!) / (((fw.length - 1) * 2) / 3600) : null;
  const burn = burnRaw !== null && burnRaw > 50 && burnRaw < 20000 ? burnRaw : null;
  return (
    <>
    <div className="home-ap"><MiniApproach /></div>
    <div className="bento">
      {aircraft && (
        <a className="glass b-map" href="#/map" aria-label="Open the live map">
          <MapView trail={trail} plan={L.plan} aircraft={aircraft} follow interactive={false} agl={f.position.altAglFt ?? null} onGround={!!f.position.onGround} />
          <span className="home-map-tag">Live map<span aria-hidden> ›</span></span>
        </a>
      )}
      <Stat k="Altitude" v={alt == null ? "—" : alt >= 18000 ? `FL${String(Math.round(alt / 100)).padStart(3, "0")}` : fmt(alt)} unit={alt != null && alt < 18000 ? " ft" : undefined} sub={f.position.altAglFt != null && f.position.altAglFt < 5000 ? `${fmt(f.position.altAglFt)} ft above ground` : undefined} spark={S.alt} color="#64B5FF" />
      <Stat k="Ground speed" v={fmt(f.speed.gsKt)} unit=" kt" sub={[f.speed.iasKt != null ? `${fmt(f.speed.iasKt)} kt indicated` : null, f.attitude.headingMagDeg != null ? `heading ${String(Math.round(f.attitude.headingMagDeg) % 360).padStart(3, "0")}°` : null].filter(Boolean).join(", ") || undefined} spark={S.gs} color="#30D158" />
      <Stat k="Vertical speed" v={Math.abs(vs) < 100 ? "Level" : fmt(Math.abs(vs))} unit={Math.abs(vs) < 100 ? undefined : " fpm"} tone={Math.abs(vs) < 100 ? null : vs > 0 ? "up" : "down"} spark={S.vs} color="#FFD60A" />
      <Stat k={L.fuelAtDestinationKg !== null ? "Fuel at landing" : "Fuel"} v={fuel(L.fuelAtDestinationKg ?? f.fuel.totalKg, fuelUnit)} sub={burn ? `Burning ${fuel(burn, fuelUnit)}/h` : undefined} spark={S.fuel} color="#BF5AF2" />
      <NextWaypoint />
      {dest && <DestWeather icao={dest} />}
      <div className="b-feed"><FlightFeed /></div>
    </div>
    </>
  );
}
