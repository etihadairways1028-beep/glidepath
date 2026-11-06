/** Logbook header: hours, landings, records and a year of flying, all from saved flights. */
import { useMemo, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { careerStats, flightsInMonth, hoursText, WORD_ORDER } from "@glidepath/flight-engine";
import { fmt } from "../data/derive";

const WORD_COLOR: Record<string, string> = { "Very soft": "#64D2FF", Smooth: "#30D158", Normal: "#34C7A0", Firm: "#FFD60A", Heavy: "#FF9F0A", Hard: "#FF453A" };
const gradeOf = (s: number) => (s >= 95 ? "A+" : s >= 88 ? "A" : s >= 78 ? "B" : s >= 65 ? "C" : s >= 50 ? "D" : "F");

export function Career({ flights }: { flights: FlightSummary[] }) {
  const [range, setRange] = useState<"all" | "month">("all");
  const now = new Date();
  const scoped = useMemo(() => (range === "month" ? flightsInMonth(flights, now.getUTCFullYear(), now.getUTCMonth() + 1) : flights), [flights, range]);
  const s = useMemo(() => careerStats(scoped), [scoped]);
  const year = useMemo(() => careerStats(flights).byMonth, [flights]);
  const maxMonth = Math.max(1, ...year.map((m) => m.blockMs));
  const monthName = now.toLocaleDateString(undefined, { month: "long" });

  return (
    <section className="career">
      <div className="career-top">
        <div className="seg" role="group" aria-label="Period">
          <button className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>All time</button>
          <button className={range === "month" ? "on" : ""} onClick={() => setRange("month")}>{monthName}</button>
        </div>
      </div>

      <div className="glass strong career-hero">
        <div className="ch-main">
          <span className="ch-k">Hours flown</span>
          <span className="ch-v data">{hoursText(s.blockMs)}</span>
          <span className="ch-sub">{s.flights === 0 ? (range === "month" ? "No flights yet this month." : "Your first flight will show up here.") : `${hoursText(s.airMs)} in the air, block to block across ${fmt(s.flights)} ${s.flights === 1 ? "flight" : "flights"}`}</span>
        </div>
        <div className="ch-stats">
          <div><span className="k">Flights</span><span className="v data">{fmt(s.flights)}</span></div>
          <div><span className="k">Distance</span><span className="v data">{fmt(s.distanceNm)}<small> nm</small></span></div>
          <div><span className="k">Average landing</span><span className="v data">{s.avgFpm === null ? "—" : <>{fmt(s.avgFpm)}<small> fpm</small></>}</span></div>
          <div><span className="k">Average grade</span><span className="v data">{s.avgScore === null ? "—" : gradeOf(s.avgScore)}</span></div>
          <div><span className="k">Airports</span><span className="v data">{fmt(s.airports)}</span></div>
          <div><span className="k">Fuel burned</span><span className="v data">{s.fuelBurnedKg ? <>{(s.fuelBurnedKg / 1000).toLocaleString(undefined, { maximumFractionDigits: s.fuelBurnedKg < 100_000 ? 1 : 0 })}<small> t</small></> : "—"}</span></div>
        </div>
      </div>

      <div className="career-grid">
        <div className="glass pad cg">
          <h3 className="cg-h">Landings</h3>
          {s.landings === 0 ? <p className="muted" style={{ margin: 0 }}>No landings yet.</p> : (
            <>
              <div className="wordbar" aria-label="Landings by feel">
                {WORD_ORDER.filter((w) => s.words[w]).map((w) => <span key={w} style={{ flex: s.words[w], background: WORD_COLOR[w] }} title={`${w}: ${s.words[w]}`} />)}
              </div>
              <ul className="wordlist">
                {WORD_ORDER.filter((w) => s.words[w]).map((w) => <li key={w}><i style={{ background: WORD_COLOR[w] }} />{w}<b className="data">{s.words[w]}</b></li>)}
              </ul>
              <div className="cg-rows">
                <div><span>Softest</span><b className="data">{fmt(s.softestFpm)} fpm</b></div>
                <div><span>Firmest</span><b className="data">{fmt(s.firmestFpm)} fpm</b></div>
                {s.avgRotationDegS !== null && <div><span>Average rotation</span><b className="data">{s.avgRotationDegS}°/s</b></div>}
              </div>
            </>
          )}
        </div>

        <div className="glass pad cg">
          <h3 className="cg-h">Records</h3>
          <div className="cg-rows">
            <a href={s.longest ? `#/logbook/${s.longest.id}` : undefined}><span>Longest flight</span><b className="data">{s.longest ? `${hoursText(s.longest.blockMs)}, ${s.longest.from ?? "?"} → ${s.longest.to ?? "?"}` : "—"}</b></a>
            <a href={s.furthest ? `#/logbook/${s.furthest.id}` : undefined}><span>Furthest</span><b className="data">{s.furthest ? `${fmt(s.furthest.nm)} nm, ${s.furthest.from ?? "?"} → ${s.furthest.to ?? "?"}` : "—"}</b></a>
            <a href={s.bestLanding ? `#/logbook/${s.bestLanding.id}` : undefined}><span>Best landing</span><b className="data">{s.bestLanding ? `${s.bestLanding.grade}, ${fmt(s.bestLanding.fpm)} fpm${s.bestLanding.at ? ` at ${s.bestLanding.at}` : ""}` : "—"}</b></a>
          </div>
          {s.topAircraft.length > 0 && (
            <>
              <h3 className="cg-h" style={{ marginTop: 18 }}>Most flown</h3>
              <div className="cg-rows">{s.topAircraft.slice(0, 3).map((a) => <div key={a.type}><span>{a.type}</span><b className="data">{hoursText(a.blockMs)}, {a.flights} {a.flights === 1 ? "flight" : "flights"}</b></div>)}</div>
            </>
          )}
        </div>

        <div className="glass pad cg">
          <h3 className="cg-h">Last 12 months</h3>
          <div className="months" role="img" aria-label="Hours flown per month for the last 12 months">
            {year.map((m) => (
              <div key={m.key} className="mcol" title={`${m.label}: ${hoursText(m.blockMs)}, ${m.flights} flights`}>
                <div className="mbar"><span style={{ height: `${Math.max(m.blockMs ? 6 : 0, (m.blockMs / maxMonth) * 100)}%` }} /></div>
                <span className="ml">{m.label.slice(0, 1)}</span>
              </div>
            ))}
          </div>
          {s.topAirports.length > 0 && (
            <>
              <h3 className="cg-h" style={{ marginTop: 18 }}>Favourite airports</h3>
              <div className="chips">{s.topAirports.map((a) => <span key={a.icao} className="chip data">{a.icao} <small>{a.visits}</small></span>)}</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
