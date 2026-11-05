import { useEffect, useMemo, useState } from "react";
import type { FlightEvent, FlightSummary, TelemetryFrame } from "@glidepath/protocol";
import { MapView } from "../components/MapView";
import { ProfileChart } from "../components/ProfileChart";
import { Grade, Icon, Kv, Notice, Section, Tile } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { dur, EVENT_LABEL, fmt, fuel, zulu } from "../data/derive";
import { framesToTrail, useApp, useSettings, type TrailPoint } from "../data/store";
import { LandingSummary } from "./Flight";
import { gradeOf } from "./Home";

function useFlights(): { flights: FlightSummary[] | null; error: string | null } {
  const mode = useApp((s) => s.mode);
  const current = useApp((s) => s.lastFlight ?? s.flight);
  const [flights, setFlights] = useState<FlightSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode === "demo") { setFlights(current ? [current] : []); return; }
    const b = activeBridge();
    if (!b) { setFlights(null); return; }
    b.get<FlightSummary[]>("/api/flights?limit=500").then((f) => { setFlights(f); setError(null); }).catch((e) => setError(e.message));
  }, [mode, current?.id, current?.status]);
  return { flights, error };
}

export function Logbook() {
  const { flights, error } = useFlights();
  const mode = useApp((s) => s.mode);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "completed" | "incomplete">("all");
  const [sort, setSort] = useState<"new" | "long" | "best">("new");
  const list = useMemo(() => {
    let l = (flights ?? []).filter((f) => f.status !== "active" || f.offBlockAt);
    if (status !== "all") l = l.filter((f) => f.status === status);
    const qq = q.trim().toUpperCase();
    if (qq) l = l.filter((f) => [f.departureIcao, f.arrivalIcao, f.callsign, f.aircraft?.icaoType, f.aircraft?.title, f.simulator.name].some((v) => v?.toUpperCase().includes(qq)));
    const block = (f: FlightSummary) => (f.onBlockAt ?? f.endedAt ?? 0) - (f.offBlockAt ?? f.startedAt);
    if (sort === "new") l.sort((a, b) => b.startedAt - a.startedAt);
    if (sort === "long") l.sort((a, b) => block(b) - block(a));
    if (sort === "best") l.sort((a, b) => (b.landings[0]?.score ?? -1) - (a.landings[0]?.score ?? -1));
    return l;
  }, [flights, q, status, sort]);

  const done = (flights ?? []).filter((f) => f.status === "completed");
  return (
    <div className="stack">
      <div className="between wrap">
        <h1 className="title">Logbook</h1>
        <button className="btn small" disabled={!list.length} onClick={() => exportCsv(list)}><span style={{ width: 16, height: 16 }}>{Icon.download()}</span>Export CSV</button>
      </div>
      {mode === "none" && <Notice info>Your logbook lives on your Bridge, so it keeps every flight even when this device is off. <a href="#/settings">Connect your Bridge</a> to see it.</Notice>}
      {error && <Notice>{error}</Notice>}
      {mode !== "none" && (
        <div className="grid cols-4">
          <Tile k="Flights" v={fmt(done.length)} />
          <Tile k="Block time" v={dur(done.reduce((s, f) => s + ((f.onBlockAt ?? 0) - (f.offBlockAt ?? 0)), 0))} />
          <Tile k="Distance" v={fmt(done.reduce((s, f) => s + f.distanceNm, 0))} unit="nm" />
          <Tile k="Best landing" v={(() => { const b = done.flatMap((f) => f.landings).sort((a, b) => b.score - a.score)[0]; return b ? `${b.grade} · ${fmt(b.touchdownVsFpm)} fpm` : "—"; })()} />
        </div>
      )}
      <section className="glass pad">
        <div className="row wrap" style={{ marginBottom: 10 }}>
          <input className="input" style={{ flex: "1 1 220px", maxWidth: 360 }} placeholder="Search airport, aircraft or callsign" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search flights" />
          <div className="seg" role="group" aria-label="Status">{(["all", "completed", "incomplete"] as const).map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s[0]!.toUpperCase() + s.slice(1)}</button>)}</div>
          <div className="seg" role="group" aria-label="Sort">{([["new", "Newest"], ["long", "Longest"], ["best", "Best landing"]] as const).map(([k, l]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}</div>
        </div>
        {flights === null && mode === "bridge" ? <div className="skeleton" style={{ height: 120 }} /> : list.length === 0 ? (
          <div className="empty"><div className="h2">{q ? "No flights match" : "No flights yet"}</div><p className="muted">{q ? "Try another airport code or aircraft." : "Fly gate to gate and the flight is logged by itself."}</p></div>
        ) : (
          <div className="list">
            {list.map((f) => {
              const l = f.landings.at(-1);
              return (
                <a className="li" key={f.id} href={`#/logbook/${f.id}`}>
                  <span>
                    <span className="data" style={{ fontWeight: 700, fontSize: 16 }}>{f.departureIcao ?? "····"} → {f.arrivalIcao ?? "····"}</span>
                    <span className="muted" style={{ display: "block", fontSize: 13 }}>
                      {new Date(f.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {f.aircraft?.icaoType ?? f.aircraft?.title ?? "Aircraft"} · {fmt(f.distanceNm)} nm · {dur((f.onBlockAt ?? f.endedAt ?? f.startedAt) - (f.offBlockAt ?? f.startedAt))}
                      {f.status === "incomplete" ? " · incomplete" : ""}{f.simulator.source === "replay" ? " · demo" : ""}
                    </span>
                  </span>
                  {l ? <Grade grade={l.grade} score={l.score} /> : <span className="faint" style={{ fontSize: 12 }}>no landing</span>}
                </a>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export function FlightDetail({ id }: { id: string }) {
  const mode = useApp((s) => s.mode);
  const liveFlight = useApp((s) => s.lastFlight ?? s.flight);
  const liveTrail = useApp((s) => s.trail);
  const liveEvents = useApp((s) => s.events);
  const { fuelUnit } = useSettings();
  const [flight, setFlight] = useState<FlightSummary | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [events, setEvents] = useState<FlightEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode === "demo" && liveFlight?.id === id) { setFlight(liveFlight); setTrail(liveTrail); setEvents(liveEvents); return; }
    const b = activeBridge();
    if (!b) return;
    Promise.all([b.get<FlightSummary>(`/api/flights/${id}`), b.get<TelemetryFrame[]>(`/api/flights/${id}/frames`), b.get<FlightEvent[]>(`/api/flights/${id}/events`)])
      .then(([f, fr, ev]) => { setFlight(f); setTrail(framesToTrail(fr)); setEvents(ev); })
      .catch((e) => setError(e.message));
  }, [id, mode]);

  if (error) return <div className="stack"><a href="#/logbook" className="btn small" style={{ alignSelf: "flex-start" }}>Back</a><Notice>{error}</Notice></div>;
  if (!flight) return <div className="stack"><div className="skeleton" style={{ height: 320 }} /></div>;
  const block = (flight.onBlockAt ?? flight.endedAt ?? 0) - (flight.offBlockAt ?? flight.startedAt);
  const air = flight.wheelsDownAt && flight.wheelsUpAt ? flight.wheelsDownAt - flight.wheelsUpAt : null;
  const marks = events.filter((e) => ["TOP_OF_CLIMB", "TOP_OF_DESCENT", "TOUCHDOWN"].includes(e.type)).map((e) => ({ t: e.t, label: ({ TOP_OF_CLIMB: "TOC", TOP_OF_DESCENT: "TOD", TOUCHDOWN: "TD" } as Record<string, string>)[e.type]! }));
  const airports = [] as Array<{ code: string; lat: number; lon: number; role: "dep" | "arr" }>;
  if (trail.length && flight.departureIcao) airports.push({ code: flight.departureIcao, lat: trail[0]!.lat, lon: trail[0]!.lon, role: "dep" });
  if (trail.length && flight.arrivalIcao) airports.push({ code: flight.arrivalIcao, lat: trail.at(-1)!.lat, lon: trail.at(-1)!.lon, role: "arr" });

  return (
    <div className="stack">
      <a href="#/logbook" className="btn small" style={{ alignSelf: "flex-start" }}><span style={{ width: 16, height: 16 }}>{Icon.back()}</span>Logbook</a>
      <div className="between wrap">
        <div>
          <h1 className="title data">{flight.departureIcao ?? "····"} → {flight.arrivalIcao ?? "····"}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{flight.departureName ?? ""}{flight.arrivalName ? ` to ${flight.arrivalName}` : ""} · {new Date(flight.startedAt).toLocaleString()}</p>
        </div>
        <div className="row">
          {flight.simulator.source === "replay" && <span className="pill demo"><span className="dot" />Demo</span>}
          <span className="pill">{flight.status === "completed" ? "Completed" : flight.status === "incomplete" ? "Incomplete" : "In progress"}</span>
        </div>
      </div>
      <section className="glass" style={{ height: 380, overflow: "hidden", position: "relative" }}>
        <MapView trail={trail} plan={flight.plan} airports={airports} interactive />
      </section>
      <div className="grid cols-4">
        <Tile k="Block time" v={dur(block)} />
        <Tile k="Air time" v={dur(air)} />
        <Tile k="Distance" v={fmt(flight.distanceNm)} unit="nm" />
        <Tile k="Max altitude" v={fmt(flight.maxAltitudeFt)} unit="ft" />
        <Tile k="Fuel used" v={flight.fuelStartKg !== null && flight.fuelEndKg !== null ? fuel(flight.fuelStartKg - flight.fuelEndKg, fuelUnit) : "—"} />
        <Tile k="Max ground speed" v={fmt(flight.maxGsKt)} unit="kt" />
        <Tile k="Aircraft" v={flight.aircraft?.icaoType ?? "—"} />
        <Tile k="Simulator" v={flight.simulator.name.replace("Microsoft Flight Simulator", "MSFS")} />
      </div>
      <Section title="Profile"><ProfileChart trail={trail} showSpeed marks={marks} height={200} /></Section>
      <div className="grid cols-2">
        <Section title="Times">
          <Kv k="Off block" v={`${zulu(flight.offBlockAt)}${flight.departureStand ? ` · stand ${flight.departureStand}` : ""}`} />
          <Kv k="Wheels up" v={`${zulu(flight.wheelsUpAt)}${flight.departureRunway ? ` · runway ${flight.departureRunway}` : ""}`} />
          <Kv k="Wheels down" v={`${zulu(flight.wheelsDownAt)}${flight.arrivalRunway ? ` · runway ${flight.arrivalRunway}` : ""}`} />
          <Kv k="On block" v={`${zulu(flight.onBlockAt)}${flight.arrivalStand ? ` · stand ${flight.arrivalStand}` : ""}`} />
          {flight.plan && <Kv k="Planned block" v={dur((flight.plan.blockTimeS ?? 0) * 1000)} />}
          <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Times are actual, from telemetry, in UTC. Stands come from OpenStreetMap when one is mapped there.</p>
        </Section>
        <Section title="Landing" right={flight.landings.length ? <Grade grade={flight.landings.at(-1)!.grade} /> : undefined}>
          {flight.landings.length ? <LandingSummary l={flight.landings.at(-1)!} /> : <p className="muted">No landing was recorded on this flight.</p>}
        </Section>
      </div>
      {flight.landings.at(-1) && (
        <Section title="How the landing was graded">
          <div className="scroll-x">
            <table className="t">
              <thead><tr><th>Factor</th><th>Value</th><th>Score</th><th>Weight</th><th>Notes</th></tr></thead>
              <tbody>
                {flight.landings.at(-1)!.components.map((c) => (
                  <tr key={c.id}><td>{c.label}</td><td className="n">{c.value === null ? "—" : `${fmt(c.value, c.id === "gLoad" ? 2 : 0)}${c.unit === "°" ? "°" : c.unit ? ` ${c.unit}` : ""}`}</td><td className="n">{c.score ?? "not used"}</td><td className="n">{c.weight}%</td><td className="muted">{c.note}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section title="Events">
        <div className="timeline">{events.filter((e) => e.type !== "SIM_RESUMED").map((e, i) => <div className="tl" key={i}><span className="t">{zulu(e.t)}</span><span className="d" /><span>{EVENT_LABEL[e.type] ?? e.type}</span></div>)}</div>
      </Section>
    </div>
  );
}

function exportCsv(list: FlightSummary[]) {
  const head = ["date_utc", "departure", "arrival", "aircraft", "callsign", "off_block_utc", "wheels_up_utc", "wheels_down_utc", "on_block_utc", "block_minutes", "distance_nm", "max_altitude_ft", "fuel_used_kg", "landing_fpm", "landing_g", "landing_grade", "landing_score", "simulator", "status"];
  const iso = (t: number | null) => (t ? new Date(t).toISOString() : "");
  const rows = list.map((f) => {
    const l = f.landings.at(-1);
    return [iso(f.startedAt).slice(0, 10), f.departureIcao, f.arrivalIcao, f.aircraft?.icaoType ?? f.aircraft?.title, f.callsign, iso(f.offBlockAt), iso(f.wheelsUpAt), iso(f.wheelsDownAt), iso(f.onBlockAt),
      f.offBlockAt && f.onBlockAt ? Math.round((f.onBlockAt - f.offBlockAt) / 60000) : "", Math.round(f.distanceNm), f.maxAltitudeFt, f.fuelStartKg !== null && f.fuelEndKg !== null ? f.fuelStartKg - f.fuelEndKg : "",
      l?.touchdownVsFpm, l?.peakG, l?.grade, l?.score, f.simulator.name, f.status];
  });
  const csv = [head, ...rows].map((r) => r.map((v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `glidepath-logbook-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export { gradeOf };
