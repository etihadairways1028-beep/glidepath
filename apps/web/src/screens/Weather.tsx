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
  const metars = usePoll(bridge && ids.length ? () => getMetar(ids) : null, 5 * 60_000, [bridge, ids.join(",")]);
  const tafs = usePoll(bridge && ids.length ? () => getTaf(ids) : null, 20 * 60_000, [bridge, ids.join(",")]);
  const radar = useRadarFrames();
  const frames = radar.data ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const cur = idx ?? frames.length - 1;
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = window.setInterval(() => setIdx((i) => { const n = (i ?? frames.length - 1) + 1; return n >= frames.length ? 0 : n; }), 650);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);
  const save = (list: string[]) => { setExtra(list); try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } };
  const center: [number, number] | undefined = L.plan ? [L.plan.destination.lon, L.plan.destination.lat] : L.frame ? [L.frame.position.lon, L.frame.position.lat] : undefined;

  return (
    <div className="stack wx">
      <div className="between wrap">
        <div>
          <h1 className="title">Weather</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Live reports from aviationweather.gov{bridge ? ", through your Bridge" : ""}. Radar from RainViewer.</p>
        </div>
        <form className="wx-add" onSubmit={(e) => { e.preventDefault(); const c = add.trim().toUpperCase(); if (/^[A-Z0-9]{3,4}$/.test(c) && !extra.includes(c)) save([...extra, c]); setAdd(""); }}>
          <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="ICAO, e.g. EGKK" aria-label="Add an airport by ICAO code" maxLength={4} />
          <button className="btn small primary" disabled={!add.trim()}>Add</button>
        </form>
      </div>

      <section className="glass wx-radar" aria-label="Rain radar">
        <MapView trail={[]} plan={L.plan} center={center ?? [0, 30]} zoom={center ? 6 : 1.8} radarFrames={frames} radarIndex={cur} aircraft={L.frame && L.frame.attitude.headingTrueDeg !== null ? { lat: L.frame.position.lat, lon: L.frame.position.lon, hdg: L.frame.attitude.headingTrueDeg } : null} interactive />
        <div className="glass radar-bar">
          {frames.length > 1 ? (<>
            <button className="radar-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause radar" : "Play radar"}>{playing ? "❚❚" : "▶"}</button>
            <input type="range" min={0} max={frames.length - 1} value={cur} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} aria-label="Radar time" />
            <span className="radar-time data">{new Date(frames[cur]!.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{cur === frames.length - 1 ? " · latest" : ` · ${Math.round((frames[frames.length - 1]!.time - frames[cur]!.time) / 60)} min ago`}</span>
          </>) : <span className="radar-time">{radar.error ? "Radar unavailable right now" : "Loading radar…"}</span>}
        </div>
      </section>

      {!bridge && <Notice info>METAR and TAF come through your Bridge (the weather service doesn't allow direct requests from browsers). Connect your PC to see them; the radar works anywhere.</Notice>}
      {roles.length === 0 && <p className="muted">Load a flight plan, start a flight, or add an airport above to see its weather.</p>}

      <div className="grid cols-2">
        {roles.map((r) => (
          <AirportWx key={r.code} code={r.code} role={r.role} m={metars.data?.find((x) => x.icao === r.code) ?? null} taf={tafs.data?.find((x) => x.icao === r.code)?.raw ?? null}
            loading={metars.loading} bridge={bridge} onRemove={extra.includes(r.code) ? () => save(extra.filter((c) => c !== r.code)) : undefined} />
        ))}
      </div>
    </div>
  );
}

function AirportWx({ code, role, m, taf, loading, bridge, onRemove }: { code: string; role: string; m: Metar | null; taf: string | null; loading: boolean; bridge: boolean; onRemove?: () => void }) {
  const [apt, setApt] = useState<AirportDetail | null>(null);
  useEffect(() => { let off = false; void airportDetail(code).then((a) => { if (!off) setApt(a); }); return () => { off = true; }; }, [code]);
  const cat = m?.category;
  return (
    <Section title={`${code}${apt ? ` · ${apt.name}` : ""}`} right={<span className="row" style={{ gap: 6 }}>
      <span className="pill">{role}</span>
      {cat && <span className={`pill wx-${cat}`}>{cat}</span>}
      {onRemove && <button className="btn small round" aria-label={`Remove ${code}`} onClick={onRemove}>{Icon.close()}</button>}
    </span>}>
      {!bridge ? <p className="muted">Connect your Bridge for live reports.</p> : loading && !m ? <div className="skeleton" style={{ height: 120 }} /> : !m ? <p className="muted">No METAR published for {code}.</p> : (
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
