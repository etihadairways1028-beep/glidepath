/**
 * Weather centre: METAR, TAF and runway wind components for your departure,
 * destination and alternate (from the flight plan), any airports you add, and
 * the rain radar. Every report shows when it was observed and where it came from.
 */
import { useRadarFrames } from "../data/radar";
import { useEffect, useState } from "react";
import { Icon, Notice, Section } from "../components/ui";
import { MapView } from "../components/MapView";
import { MetarView } from "./Airports";
import { airportDetail, type AirportDetail } from "../data/airports";
import { getMetar, getTaf, usePoll, type Metar } from "../data/external";
import { activeBridge } from "../data/bridge";
import { fmt, useLive } from "../data/derive";

const KEY = "glidepath.wxAirports";
const loadExtra = (): string[] => { try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).slice(0, 8); } catch { return []; } };

function ago(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min)) return "";
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

export function WeatherScreen() {
  const L = useLive();
  const bridge = !!activeBridge();
  const [extra, setExtra] = useState<string[]>(loadExtra);
  const [add, setAdd] = useState("");
  const roles: Array<{ code: string; role: string }> = [];
  if (L.plan) {
    roles.push({ code: L.plan.origin.icao, role: "Departure" }, { code: L.plan.destination.icao, role: "Destination" });
    if (L.plan.alternate) roles.push({ code: L.plan.alternate, role: "Alternate" });
  } else if (L.flight?.departureIcao || L.flight?.arrivalIcao) {
    if (L.flight.departureIcao) roles.push({ code: L.flight.departureIcao, role: "Departure" });
    if (L.flight.arrivalIcao) roles.push({ code: L.flight.arrivalIcao, role: "Destination" });
  }
  for (const c of extra) if (!roles.some((r) => r.code === c)) roles.push({ code: c, role: "Added by you" });
  const ids = roles.map((r) => r.code);
  // Live: METARs every two minutes, TAFs every fifteen, on any device (the Glidepath service passes them through).
  const metars = usePoll(ids.length ? () => getMetar(ids) : null, 2 * 60_000, [bridge, ids.join(",")]);
  const tafs = usePoll(ids.length ? () => getTaf(ids) : null, 15 * 60_000, [bridge, ids.join(",")]);
  const radar = useRadarFrames();
  const frames = radar.data ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false); // opens on the latest (live) frame; play shows the last two hours
  const cur = idx ?? frames.length - 1;
  // Play through the last two hours, holding a moment on the latest frame before going round again.
  // Back to live when playback stops at the end.
  useEffect(() => { if (!playing && idx === frames.length - 1) setIdx(null); }, [playing, idx, frames.length]);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const atLatest = cur === frames.length - 1;
    const t = window.setTimeout(() => setIdx(atLatest ? 0 : cur + 1), atLatest ? 2200 : 600);
    return () => window.clearTimeout(t);
  }, [playing, frames.length, cur]);
  const [strength, setStrength] = useState(1);
  const STRENGTH = [{ label: "Light", v: 0.45 }, { label: "Normal", v: 0.72 }, { label: "Strong", v: 0.92 }];
  const step = (d: number) => { setPlaying(false); setIdx(((cur + d) % frames.length + frames.length) % frames.length); };
  // Your airports on the radar, coloured by flight category (VFR, MVFR, IFR, LIFR).
  const [coords, setCoords] = useState<Record<string, [number, number]>>({});
  useEffect(() => {
    let off = false;
    for (const c of ids) if (!coords[c]) void airportDetail(c).then((a) => { if (!off && a) setCoords((x) => ({ ...x, [c]: [a.lon, a.lat] })); });
    return () => { off = true; };
  }, [ids.join(",")]);
  const dots = (metars.data ?? []).filter((m) => coords[m.icao] && m.category).map((m) => ({ icao: m.icao, lon: coords[m.icao]![0], lat: coords[m.icao]![1], category: m.category!, raw: m.raw, wind: m.windDir !== null && m.windKt !== null ? `${m.windDir === "VRB" ? "VRB" : String(m.windDir).padStart(3, "0")}/${m.windKt} kt` : "", temp: m.tempC !== null ? `${m.tempC}°C` : "" }));
  const save = (list: string[]) => { setExtra(list); try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } };
  const center: [number, number] | undefined = L.plan ? [L.plan.destination.lon, L.plan.destination.lat] : L.frame ? [L.frame.position.lon, L.frame.position.lat] : undefined;

  return (
    <div className="stack wx">
      <div className="between wrap">
        <div>
          <h1 className="title">Weather</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Live METAR and TAF from aviationweather.gov, refreshed every few minutes. Radar from RainViewer.</p>
        </div>
        <form className="wx-add" onSubmit={(e) => { e.preventDefault(); const c = add.trim().toUpperCase(); if (/^[A-Z0-9]{3,4}$/.test(c) && !extra.includes(c)) save([...extra, c]); setAdd(""); }}>
          <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="ICAO, e.g. EGKK" aria-label="Add an airport by ICAO code" maxLength={4} />
          <button className="btn small primary" disabled={!add.trim()}>Add</button>
        </form>
      </div>

      <section className="glass wx-radar" aria-label="Rain radar">
        <MapView trail={[]} plan={L.plan} center={center ?? [20, 28]} zoom={center ? 6 : 2.5} radarFrames={frames} radarIndex={cur} radarOpacity={STRENGTH[strength]!.v} metars={dots} aircraft={L.frame && L.frame.attitude.headingTrueDeg !== null ? { lat: L.frame.position.lat, lon: L.frame.position.lon, hdg: L.frame.attitude.headingTrueDeg, alt: L.frame.position.altMslFt } : null} interactive />
        <div className="radar-key" aria-label="Rain intensity">
          <span className="rk-bar" aria-hidden="true" />
          <span className="rk-l"><b>Light</b><b>Moderate</b><b>Heavy</b><b>Storm</b></span>
        </div>
        <div className="glass radar-bar">
          {frames.length > 1 ? (<>
            <button className="radar-btn" onClick={() => step(-1)} aria-label="Earlier frame"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            <button className="radar-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause radar" : "Play radar"}>
              {playing ? <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
            </button>
            <button className="radar-btn" onClick={() => step(1)} aria-label="Later frame"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            <div className="radar-track">
              <input type="range" min={0} max={frames.length - 1} value={cur} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Radar time" style={{ ["--p" as string]: `${(cur / (frames.length - 1)) * 100}%` }} />
              <div className="radar-ticks" aria-hidden="true">{frames.map((f, i) => <i key={f.time} className={i === cur ? "on" : i === frames.length - 1 ? "now" : ""} />)}</div>
            </div>
            <span className="radar-time data">{new Date(frames[cur]!.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>{cur === frames.length - 1 ? <b className="live-dot">Live</b> : `−${Math.round((frames[frames.length - 1]!.time - frames[cur]!.time) / 60)} min`}</small></span>
            {cur !== frames.length - 1 && <button className="radar-str" onClick={() => { setPlaying(false); setIdx(null); }} aria-label="Back to live radar">Live</button>}
            <button className="radar-str" onClick={() => setStrength((x) => (x + 1) % STRENGTH.length)} aria-label="Radar strength">{STRENGTH[strength]!.label}</button>
          </>) : <span className="radar-time">{radar.error ? "Radar unavailable right now" : "Loading radar…"}</span>}
        </div>
      </section>

      {metars.error && ids.length > 0 && <Notice info>Live reports couldn't be loaded just now. Glidepath tries again in a moment.</Notice>}
      {roles.length === 0 && (
        <div className="glass wx-empty">
          <b>See the weather at any airport</b>
          <p className="muted">Your departure, destination and alternate appear here by themselves when you load a flight plan or start a flight. Or add airports:</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {["EGLL", "KJFK", "OMDB", "EDDF", "LFPG", "WSSS", "YSSY", "KLAX"].map((c) => <button key={c} className="btn small" onClick={() => save([...extra, c])}>{c}</button>)}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {roles.map((r) => (
          <AirportWx key={r.code} code={r.code} role={r.role} m={metars.data?.find((x) => x.icao === r.code) ?? null} taf={tafs.data?.find((x) => x.icao === r.code)?.raw ?? null}
            loading={metars.loading} onRemove={extra.includes(r.code) ? () => save(extra.filter((c) => c !== r.code)) : undefined} />
        ))}
      </div>
    </div>
  );
}

function AirportWx({ code, role, m, taf, loading, onRemove }: { code: string; role: string; m: Metar | null; taf: string | null; loading: boolean; onRemove?: () => void }) {
  const [apt, setApt] = useState<AirportDetail | null>(null);
  useEffect(() => { let off = false; void airportDetail(code).then((a) => { if (!off) setApt(a); }); return () => { off = true; }; }, [code]);
  const cat = m?.category;
  return (
    <Section title={`${code}${apt ? ` · ${apt.name}` : ""}`} right={<span className="row" style={{ gap: 6 }}>
      <span className="pill">{role}</span>
      {cat && <span className={`pill wx-${cat}`}>{cat}</span>}
      {onRemove && <button className="btn small round" aria-label={`Remove ${code}`} onClick={onRemove}>{Icon.close()}</button>}
    </span>}>
      {loading && !m ? <div className="skeleton" style={{ height: 120 }} /> : !m ? <p className="muted">No METAR published for {code}.</p> : (
        <>
          <p className="faint" style={{ fontSize: 12, margin: "0 0 6px" }}>Observed {ago(m.observed)}{m.observed ? ` (${new Date(m.observed).toISOString().slice(11, 16)}Z)` : ""} · aviationweather.gov</p>
          <MetarView m={m} />
          {apt && apt.runways.length > 0 && typeof m.windDir === "number" && m.windKt !== null && <WindTable apt={apt} dir={m.windDir} kt={m.windKt} gust={m.gustKt} />}
        </>
      )}
      {taf && <details className="wx-taf"><summary>TAF</summary><pre className="data">{taf}</pre></details>}
    </Section>
  );
}

/** Headwind and crosswind for every runway direction (METAR winds are true, as are the runway headings). */
function WindTable({ apt, dir, kt, gust }: { apt: AirportDetail; dir: number; kt: number; gust: number | null }) {
  const rows = apt.runways.flatMap((r) => r.ends).map((e) => {
    const a = ((dir - e.headingTrueDeg) * Math.PI) / 180;
    return { id: e.ident, head: Math.cos(a) * kt, cross: Math.sin(a) * kt, gustCross: gust ? Math.abs(Math.sin(a) * gust) : null };
  }).sort((x, y) => y.head - x.head);
  return (
    <div className="scroll-x" style={{ marginTop: 10 }}>
      <table className="t wx-wind">
        <thead><tr><th>Runway</th><th>Head / tail</th><th>Crosswind</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} className={i === 0 ? "best" : ""}>
            <td className="n">{r.id}{i === 0 ? " ★" : ""}</td>
            <td className="n">{r.head >= 0 ? `${fmt(r.head)} kt head` : `${fmt(-r.head)} kt tail`}</td>
            <td className="n">{fmt(Math.abs(r.cross))} kt {Math.abs(r.cross) < 0.5 ? "" : r.cross > 0 ? "from right" : "from left"}{r.gustCross ? ` (gusts ${fmt(r.gustCross)})` : ""}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>★ most into wind. The runway in use is set by ATC or the ATIS.</p>
    </div>
  );
}
