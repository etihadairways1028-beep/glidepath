/** Career mode: rank, where you are, what to fly next, and type ratings. */
import { useEffect, useMemo, useState } from "react";
import { aircraftClass, CLASS_INFO, pilotCareer, simbriefLink, suggestFlights, type AircraftClass, type Place } from "@glidepath/flight-engine";
import { loadAirportDb } from "../data/airports";
import { useApp, useSettings } from "../data/store";
import { Notice } from "../components/ui";
import { MapView } from "../components/MapView";
import { useFlights } from "./Logbook";

const hrs = (h: number) => (h >= 100 ? Math.round(h).toLocaleString("en-US") : h.toFixed(1));
const mins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

function Stripes({ n }: { n: number }) {
  return (
    <div className="epaulette" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => <span key={i} className={i < n ? "on" : ""} />)}
    </div>
  );
}

export function CareerScreen() {
  const { flights, error, fromCloud } = useFlights();
  const mode = useApp((s) => s.mode);
  const { simbriefUser } = useSettings();
  // Demo flights never count; in the demo, preview the screen with the demo flight.
  const counted = useMemo(() => (mode === "demo" ? (flights ?? []).map((f) => ({ ...f, simulator: { ...f.simulator, source: "live" as const } })) : flights ?? []), [flights, mode]);
  const c = useMemo(() => pilotCareer(counted), [counted]);
  const [cls, setCls] = useState<AircraftClass | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [from, setFrom] = useState<Place | null>(null);
  const klass: AircraftClass = cls ?? aircraftClass(c.lastType);

  useEffect(() => {
    let alive = true;
    void loadAirportDb().then((db) => {
      if (!alive) return;
      setPlaces(db.list(["large", "medium", "small"]));
      setFrom(c.location ? db.get(c.location) : null);
    }).catch(() => setPlaces([]));
    return () => { alive = false; };
  }, [c.location]);

  const [db, setDb] = useState<Awaited<ReturnType<typeof loadAirportDb>> | null>(null);
  useEffect(() => { void loadAirportDb().then(setDb).catch(() => undefined); }, []);
  const been = useMemo(() => {
    if (!db || !flights) return null;
    const lines: Array<Array<[number, number]>> = [];
    const seen = new Map<string, { code: string; lat: number; lon: number; country: string }>();
    const pairs = new Set<string>();
    for (const f of flights) {
      if (f.status !== "completed" || (f.simulator?.source === "replay" && mode !== "demo")) continue;
      const a = f.departureIcao ? db.get(f.departureIcao) : null, b = f.arrivalIcao ? db.get(f.arrivalIcao) : null;
      for (const x of [a, b]) if (x) seen.set(x.code, { code: x.code, lat: x.lat, lon: x.lon, country: x.country });
      if (!a || !b || a.code === b.code) continue;
      const key = [a.code, b.code].sort().join("-");
      if (pairs.has(key)) continue;
      pairs.add(key);
      lines.push(arc(a, b));
    }
    return { lines, airports: [...seen.values()], countries: new Set([...seen.values()].map((x) => x.country)).size, routes: pairs.size };
  }, [db, flights, mode]);

  const recent = useMemo(() => (flights ?? []).slice(-8).flatMap((f) => [f.arrivalIcao ?? "", f.departureIcao ?? ""]).filter(Boolean), [flights]);
  const ideas = useMemo(() => (from && places ? suggestFlights(from, places, klass, { recent, perBand: 2 }) : []), [from, places, klass, recent]);

  if (mode === "none" && !fromCloud && !flights) {
    return <div className="stack"><h1 className="title">Career</h1><Notice info>Your career is built from your logbook. <a href="#/settings">Connect your Bridge</a> or <a href="#/account">sign in</a> to see it.</Notice></div>;
  }
  return (
    <div className="stack">
      <h1 className="title">Career</h1>
      {error && <Notice>{error}</Notice>}
      {mode === "demo" && <Notice info>Preview with the demo flight. Demo flights don't count towards your real career.</Notice>}
      <section className="glass strong career-rank">
        <Stripes n={c.rank.stripes} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">Your rank</div>
          <h2 className="rank-title">{c.rank.title}</h2>
          <p className="muted" style={{ margin: "2px 0 12px" }}>{hrs(c.hours)} hours · {c.flights} {c.flights === 1 ? "flight" : "flights"}</p>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}><span style={{ width: `${Math.max(2, c.progress * 100)}%` }} /></div>
          <p className="faint" style={{ margin: "8px 0 0", fontSize: 13 }}>{c.next ? `${hrs(Math.max(0, c.next.minHours - c.hours))} more hours to ${c.next.title}` : "Top rank. Respect."}</p>
        </div>
      </section>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <section className="glass pad">
          <div className="eyebrow">Where you are</div>
          {c.location ? (
            <>
              <h2 className="h2" style={{ margin: "4px 0 2px" }}><span className="data">{c.location}</span>{from ? <span className="muted" style={{ fontWeight: 500 }}> · {from.name}</span> : null}</h2>
              <p className="muted" style={{ margin: 0 }}>Your last flight ended here. Start the next one from here to keep your streak going.</p>
            </>
          ) : <p className="muted" style={{ margin: "6px 0 0" }}>Finish a flight and your career starts where you land.</p>}
          <div className="row wrap" style={{ marginTop: 14, gap: 10 }}>
            <div className="stat-chip"><b className="data">{c.streak}</b><span>flights in a row</span></div>
            <div className="stat-chip"><b className="data">{c.bestStreak}</b><span>best streak</span></div>
          </div>
        </section>

        <section className="glass pad">
          <div className="eyebrow">Type ratings</div>
          {c.ratings.length === 0 ? <p className="muted" style={{ margin: "6px 0 0" }}>Fly 3 flights or 5 hours in an aircraft to earn its rating.</p> : (
            <div className="ratings">
              {c.ratings.slice(0, 8).map((r) => (
                <div key={r.type} className={`rating${r.rated ? " rated" : ""}`}>
                  <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="track" /><circle cx="18" cy="18" r="15" className="fill" style={{ strokeDasharray: `${r.progress * 94.2} 94.2` }} /></svg>
                  <b className="data">{r.type}</b>
                  <span>{r.rated ? "Rated" : `${r.flights}/3 flights`}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {been && been.lines.length > 0 && (
        <section className="glass" style={{ overflow: "hidden" }}>
          <div className="pad between wrap" style={{ gap: 10, paddingBottom: 0 }}>
            <div>
              <div className="eyebrow">Everywhere you've flown</div>
              <h2 className="h2" style={{ margin: "4px 0 0" }}>{been.airports.length} airports · {been.countries} {been.countries === 1 ? "country" : "countries"} · {been.routes} {been.routes === 1 ? "route" : "routes"}</h2>
            </div>
          </div>
          <div style={{ height: 360, position: "relative", marginTop: 12 }}>
            <MapView trail={[]} history={been.lines} airports={been.airports.slice(0, 80).map((a) => ({ code: a.code, lat: a.lat, lon: a.lon, role: "arr" as const }))} interactive />
          </div>
        </section>
      )}

      <section className="glass pad">
        <div className="between wrap" style={{ gap: 10 }}>
          <div>
            <div className="eyebrow">Fly this next</div>
            <h2 className="h2" style={{ margin: "4px 0 0" }}>{from ? `From ${from.code}` : "Pick up where you landed"}</h2>
          </div>
          <div className="seg" role="group" aria-label="Aircraft type">
            {(["ga", "turboprop", "regional", "jet", "heavy"] as AircraftClass[]).map((k) => <button key={k} className={klass === k ? "on" : ""} onClick={() => setCls(k)}>{CLASS_INFO[k].label.replace(" jet", "").replace("Light aircraft", "Light")}</button>)}
          </div>
        </div>
        {!from ? <p className="muted" style={{ margin: "10px 0 0" }}>{c.location ? "Loading airports…" : "Finish a flight and we'll suggest where to go next."}</p> : ideas.length === 0 ? <p className="muted" style={{ margin: "10px 0 0" }}>{places ? "No good matches nearby for this aircraft. Try another type above." : "Loading airports…"}</p> : (
          <div className="ideas">
            {ideas.map((s) => (
              <div key={s.to.code} className="idea">
                <div className="idea-band">{s.band}</div>
                <div className="idea-route data">{from.code} → {s.to.code}</div>
                <div className="muted idea-name">{s.to.name}, {s.to.country}</div>
                <div className="faint idea-meta">{s.distanceNm.toLocaleString("en-US")} nm · about {mins(s.minutes)}</div>
                <a className="btn small" href={simbriefLink(from.code, s.to.code, c.lastType && aircraftClass(c.lastType) === klass ? c.lastType : undefined)} target="_blank" rel="noreferrer">Plan in SimBrief</a>
              </div>
            ))}
          </div>
        )}
        <p className="faint" style={{ fontSize: 12.5, margin: "12px 0 0" }}>Suggestions change daily. SimBrief is free; {simbriefUser ? "after you generate the plan, load it on the Flight screen." : "add your SimBrief username in Settings to load plans straight into Glidepath."}</p>
      </section>
    </div>
  );
}

/** A great-circle arc as [lon, lat] points, unwrapped so it doesn't jump across the date line. */
function arc(a: { lat: number; lon: number }, b: { lat: number; lon: number }, n = 40): Array<[number, number]> {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!d) return [[a.lon, a.lat], [b.lon, b.lat]];
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lon = Math.atan2(y, x) / r;
    const prev = out.at(-1);
    if (prev) while (lon - prev[0] > 180) lon -= 360; while (prev && prev[0] - lon > 180) lon += 360;
    out.push([lon, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return out;
}
