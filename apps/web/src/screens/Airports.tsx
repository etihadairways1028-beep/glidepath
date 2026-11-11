import { AirportBoard } from "../components/AirportBoard";
import { useEffect, useState } from "react";
import type { Airport } from "@glidepath/aviation-data";
import { AirportHero, RunwayDiagram } from "../components/Imagery";
import { Icon, Kv, Notice, Section } from "../components/ui";
import { airportDetail, searchAirports, type AirportDetail } from "../data/airports";
import { getMetar, getNetwork, getStands, getTaf, NeedsBridge, usePoll, type Metar } from "../data/external";
import { MapView } from "../components/MapView";
import { fmt, useLive } from "../data/derive";
import { useApp } from "../data/store";

export function Airports() {
  const L = useLive();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Airport[]>([]);
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) searchAirports(q).then(setRes).catch(() => setRes([])); else setRes([]); }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const quick = [L.flight?.departureIcao ?? L.plan?.origin.icao, L.flight?.arrivalIcao ?? L.plan?.destination.icao].filter((x): x is string => !!x);
  return (
    <div className="stack">
      <h1 className="title">Airports</h1>
      <section className="glass pad">
        <input className="input" autoFocus placeholder="ICAO, IATA, airport or city, for example EGLL, DXB or Manchester" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search airports" />
        {quick.length > 0 && !q && (
          <div className="row wrap" style={{ marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>This flight:</span>
            {quick.map((c) => <a key={c} className="chip" href={`#/airports/${c}`}>{c}</a>)}
          </div>
        )}
        {res.length > 0 && (
          <div className="list" style={{ marginTop: 8 }}>
            {res.map((a) => (
              <a key={a.code} className="li" href={`#/airports/${a.code}`}>
                <span><span className="data" style={{ fontWeight: 700 }}>{a.code}</span>{a.iata ? <span className="faint data"> {a.iata}</span> : null} <span>{a.name}</span>
                  <span className="muted" style={{ display: "block", fontSize: 13 }}>{[a.city, a.country].filter(Boolean).join(", ")}</span></span>
                <span className="faint" style={{ fontSize: 12 }}>{a.size}</span>
              </a>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && res.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>No airport found for “{q}”.</p>}
      </section>
      <p className="faint" style={{ fontSize: 12.5 }}>Airport, runway and frequency data: OurAirports (public domain). Without a Bridge, search covers large and medium airports; with one, every airport.</p>
    </div>
  );
}

export function AirportPage({ code }: { code: string }) {
  const mode = useApp((s) => s.mode);
  const [apt, setApt] = useState<AirportDetail | null | undefined>(undefined);
  useEffect(() => { setApt(undefined); airportDetail(code).then(setApt).catch(() => setApt(null)); }, [code, mode]);
  const bridge = mode === "bridge";
  const metar = usePoll(bridge ? () => getMetar([code]) : null, 300_000, [code, bridge]);
  const taf = usePoll(bridge ? () => getTaf([code]) : null, 600_000, [code, bridge]);
  const net = usePoll(bridge ? () => getNetwork("vatsim") : null, 30_000, [bridge]);
  const stands = usePoll(bridge && apt ? () => getStands(apt.lat, apt.lon) : null, 3_600_000, [bridge, apt?.code]);

  if (apt === undefined) return <div className="skeleton" style={{ height: 300 }} />;
  if (apt === null) return <div className="stack"><a className="btn small" href="#/airports" style={{ alignSelf: "flex-start" }}>Back</a><Notice>No airport with the code {code}.</Notice></div>;
  const m = metar.data?.[0];
  const ctl = (net.data?.controllers ?? []).filter((c) => c.callsign.startsWith(apt.code + "_") || (apt.iata && c.callsign.startsWith(`K${apt.iata}_`)));
  const pilots = net.data?.pilots ?? [];
  const deps = pilots.filter((p) => p.dep === apt.code);
  const arrs = pilots.filter((p) => p.arr === apt.code);
  const need = new NeedsBridge().message;

  return (
    <div className="stack">
      <a className="btn small" href="#/airports" style={{ alignSelf: "flex-start" }}><span style={{ width: 16, height: 16 }}>{Icon.back()}</span>Airports</a>
      <AirportHero code={apt.iata ? `${apt.code} / ${apt.iata}` : apt.code} name={apt.name} city={apt.city} country={apt.country} />
      <section className="glass apt-map" aria-label="Airport map">
        <MapView key={apt.code} trail={[]} center={[apt.lon, apt.lat]} zoom={apt.size === "small" ? 14.6 : apt.size === "medium" ? 14 : 13.4} stands={stands.data ?? []} interactive />
        <span className="apt-map-tag">Runways, taxiways and gates from OpenStreetMap{bridge ? "" : ". Connect your Bridge for stand numbers"}</span>
      </section>
      <AirportBoard code={apt.code} lat={apt.lat} lon={apt.lon} />
      <div className="grid cols-3">
        <Section title="Airport">
          <Kv k="Elevation" v={`${fmt(apt.elevationFt)} ft`} />
          <Kv k="Position" v={`${apt.lat.toFixed(4)}, ${apt.lon.toFixed(4)}`} />
          <Kv k="Type" v={apt.size[0]!.toUpperCase() + apt.size.slice(1)} />
          <Kv k="Local time" v={new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tzGuess(apt.lon) }).format(new Date())} />
          <p className="faint" style={{ fontSize: 12, margin: "6px 0 0" }}>Local time is approximate (from longitude).</p>
        </Section>
        <Section title="Weather" right={m?.category ? <span className={`pill ${m.category === "VFR" ? "live" : m.category === "MVFR" ? "wait" : "bad"}`}><span className="dot" />{m.category}</span> : undefined}>
          {!bridge ? <p className="muted">{need}</p> : metar.loading ? <div className="skeleton" style={{ height: 90 }} /> : metar.error ? <Notice>{metar.error}</Notice> : !m ? <p className="muted">No METAR published for {apt.code}.</p> : <MetarView m={m} />}
        </Section>
        <Section title="Online ATC" right={<span className="faint" style={{ fontSize: 12 }}>VATSIM</span>}>
          {!bridge ? <p className="muted">{need}</p> : ctl.length === 0 ? <p className="muted">No controllers online here right now.</p> : ctl.map((c) => <Kv key={c.callsign} k={c.callsign} v={c.frequency ?? "—"} />)}
        </Section>
      </div>
      {taf.data?.[0] && <Section title="TAF"><pre className="data" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13, color: "var(--mist)" }}>{taf.data[0].raw}</pre></Section>}
      <Section title={`Runways (${apt.runways.length})`} right={apt.runways.length ? <span className="faint" style={{ fontSize: 12 }}>drawn to scale from OurAirports</span> : undefined}>
        {apt.runways.length === 0 ? <p className="muted">No runway data for this airport.</p> : (
          <div className="rwy-layout">
          <div className="rwy-pic"><RunwayDiagram runways={apt.runways} windDir={m && typeof m.windDir === "number" ? m.windDir : null} windKt={m?.windKt ?? null} label={apt.code} /></div>
          <div className="scroll-x"><table className="t">
            <thead><tr><th>Runway</th><th>Length</th><th>Width</th><th>Heading (true)</th><th>Surface</th><th>Lights</th></tr></thead>
            <tbody>{apt.runways.map((r) => (
              <tr key={r.ends[0].ident + r.ends[1].ident}>
                <td className="n">{r.ends[0].ident} / {r.ends[1].ident}</td><td className="n">{fmt(r.lengthFt)} ft</td><td className="n">{fmt(r.widthFt)} ft</td>
                <td className="n">{fmt(r.ends[0].headingTrueDeg)}° / {fmt(r.ends[1].headingTrueDeg)}°</td><td>{r.surface || "—"}</td><td>{r.lighted ? "Yes" : "No"}</td>
              </tr>
            ))}</tbody>
          </table></div>
          </div>
        )}
        {m && m.windDir !== null && m.windDir !== "VRB" && apt.runways.length > 0 && <BestRunway apt={apt} m={m} />}
      </Section>
      <div className="grid cols-2">
        <Section title={`Departures (${deps.length})`} right={<span className="faint" style={{ fontSize: 12 }}>VATSIM, filed flight plans</span>}><Board rows={deps} other="arr" bridge={bridge} /></Section>
        <Section title={`Arrivals (${arrs.length})`} right={<span className="faint" style={{ fontSize: 12 }}>VATSIM, filed flight plans</span>}><Board rows={arrs} other="dep" bridge={bridge} /></Section>
      </div>
      {apt.frequencies.length > 0 && (
        <Section title="Frequencies"><div className="grid cols-3" style={{ gap: 0, columnGap: 24 }}>{apt.frequencies.map((f, i) => <Kv key={i} k={`${f.type} ${f.description && f.description !== f.type ? `(${f.description})` : ""}`} v={f.mhz.toFixed(3)} />)}</div></Section>
      )}
    </div>
  );
}

export function MetarView({ m }: { m: Metar }) {
  return (
    <>
      <Kv k="Wind" v={m.windDir === null ? "—" : `${m.windDir === "VRB" ? "Variable" : `${String(m.windDir).padStart(3, "0")}°`} ${fmt(m.windKt)} kt${m.gustKt ? ` gusting ${m.gustKt}` : ""}`} />
      <Kv k="Visibility" v={m.visibility ?? "—"} />
      <Kv k="Cloud" v={m.clouds.length ? m.clouds.map((c) => `${c.cover}${c.baseFt ? ` ${fmt(c.baseFt)}` : ""}`).join(", ") : "None reported"} />
      <Kv k="Temp / dew" v={`${fmt(m.tempC)} / ${fmt(m.dewC)} °C`} />
      <Kv k="QNH" v={`${fmt(m.qnhHpa)} hPa`} />
      <p className="data faint" style={{ fontSize: 12, margin: "8px 0 0" }}>{m.raw}</p>
    </>
  );
}

function BestRunway({ apt, m }: { apt: AirportDetail; m: Metar }) {
  const ends = apt.runways.flatMap((r) => r.ends);
  const wd = m.windDir as number;
  const best = ends.map((e) => ({ e, head: Math.cos(((wd - e.headingTrueDeg) * Math.PI) / 180) * (m.windKt ?? 0) })).sort((a, b) => b.head - a.head)[0];
  if (!best) return null;
  return <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>Most into wind: runway <b className="data" style={{ color: "var(--ink)" }}>{best.e.ident}</b> ({fmt(best.head)} kt headwind). The runway in use is set by ATC or the ATIS.</p>;
}

function Board({ rows, other, bridge }: { rows: Array<{ callsign: string; type: string | null; dep: string | null; arr: string | null; altFt: number; gsKt: number }>; other: "dep" | "arr"; bridge: boolean }) {
  if (!bridge) return <p className="muted">{new NeedsBridge().message}</p>;
  if (!rows.length) return <p className="muted">None right now.</p>;
  return (
    <div className="scroll-x"><table className="t">
      <thead><tr><th>Callsign</th><th>{other === "arr" ? "To" : "From"}</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>{rows.slice(0, 30).map((p) => <tr key={p.callsign}><td className="n">{p.callsign}</td><td className="n">{p[other] ?? "—"}</td><td className="n">{p.type ?? "—"}</td><td className="muted">{p.gsKt < 40 ? "On the ground" : `${fmt(p.altFt)} ft`}</td></tr>)}</tbody>
    </table></div>
  );
}

function tzGuess(lon: number): string {
  const off = Math.round(lon / 15);
  return off === 0 ? "UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}
