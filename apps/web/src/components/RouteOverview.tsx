/**
 * Your whole plan at a glance: departure runway and SID, every waypoint with
 * its airway, STAR and arrival runway, plus the numbers you brief. Also the
 * SimBrief import, so you never need Settings to load a plan.
 */
import { useMemo, useState } from "react";
import type { FlightPlan, TelemetryFrame } from "@glidepath/protocol";
import { distanceNm, routeProgress } from "@glidepath/flight-engine";
import { MapView } from "./MapView";
import { DirectNote } from "./FlightPlanCard";
import { loadChoice } from "./Procedures";
import { fmt, fuel } from "../data/derive";
import { loadLatestPlan } from "../data/plan";
import { settingsStore, useApp, useSettings } from "../data/store";
import { Icon } from "./ui";

const fl = (ft: number | null | undefined) => (ft == null ? "—" : ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${fmt(ft)} ft`);
const hm = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const z = (unix: number | null | undefined) => (unix == null ? "—" : `${new Date(unix * 1000).toISOString().slice(11, 16)}Z`);
const isTop = (id: string) => /^(TOC|TOD|T\/C|T\/D)$/i.test(id);

/** SimBrief import, inline. */
export function SimbriefImport({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const can = mode !== "demo";
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const p = await loadLatestPlan(s.simbriefUser.trim()); setMsg({ ok: true, t: `Loaded ${p.origin.icao} to ${p.destination.icao}${p.callsign ? ` (${p.callsign})` : ""}.` }); }
    catch (e) { setMsg({ ok: false, t: (e as Error).message || "Couldn't load the plan." }); }
    finally { setBusy(false); }
  };
  return (
    <div className={`sb-imp${compact ? " compact" : ""}`}>
      <form className="sb-form" onSubmit={(e) => { e.preventDefault(); if (can && s.simbriefUser.trim() && !busy) void go(); }}>
        <input className="input" aria-label="SimBrief username or Pilot ID" value={s.simbriefUser} onChange={(e) => settingsStore.set({ simbriefUser: e.target.value })} placeholder="SimBrief username or Pilot ID" autoComplete="username" />
        <button className="btn primary" type="submit" disabled={!can || !s.simbriefUser.trim() || busy}>{busy ? "Loading…" : compact ? "Reload" : "Import from SimBrief"}</button>
      </form>
      {!can && <p className="faint sb-note">Stop the demo to load your own plan.</p>}
      {msg && <p className={`sb-note ${msg.ok ? "on-time" : "late"}`} role="status">{msg.t}</p>}
    </div>
  );
}

/** Every waypoint in order: origin and runway, SID, airways, STAR, destination and runway. */
export function RouteChips({ plan, nextIdx = null, onPick }: { plan: FlightPlan; nextIdx?: number | null; onPick?: (i: number) => void }) {
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway, arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null, star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const items = plan.fixes.map((f, i) => ({ f, i })).filter(({ f }) => !isTop(f.ident));
  const kind = (p: FlightPlan["fixes"][number]) => (p.proc === "sid" ? "sid" : p.proc === "star" ? "star" : "en");
  let sidShown = false, starShown = false;
  return (
    <ol className="rt-fixes" aria-label="Every waypoint">
      <li className="rt-fix ap"><b>{plan.origin.icao}{depRwy ? `/${depRwy}` : ""}</b></li>
      {items.map(({ f, i }) => {
        const k = kind(f);
        const head = k === "sid" && !sidShown ? (sidShown = true, <li key={`sid-${i}`} className="rt-proc sid">{sid ?? "SID"}</li>)
          : k === "star" && !starShown ? (starShown = true, <li key={`star-${i}`} className="rt-proc star">{star ?? "STAR"}</li>) : null;
        const cls = `rt-fix ${k}${nextIdx !== null && i < nextIdx ? " passed" : ""}${nextIdx === i ? " next" : ""}`;
        const inner = <>{k === "en" && f.via && f.via !== "DCT" && <span className="rt-via">{f.via}</span>}<b>{f.ident}</b></>;
        return [head, (
          <li key={`${f.ident}-${i}`} className={cls} title={f.altitudeFt != null ? `${f.ident}, planned ${fl(f.altitudeFt)}` : f.ident}>
            {onPick ? <button type="button" onClick={() => onPick(i)}>{inner}</button> : inner}
          </li>
        )];
      })}
      <li className="rt-fix ap"><b>{plan.destination.icao}{arrRwy ? `/${arrRwy}` : ""}</b></li>
    </ol>
  );
}

/** The flight plan panel on the live map. */
export function MapRoutePanel({ plan, nextFix, onPick, onClose, onFit }: { plan: FlightPlan; nextFix: number | null; onPick: (i: number) => void; onClose: () => void; onFit: () => void }) {
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway, arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null, star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const dist = plan.distanceNm ?? Math.round(distanceNm(plan.origin, plan.destination));
  const n = plan.fixes.filter((f) => !isTop(f.ident)).length;
  return (
    <div className="map-sheet glass strong map-route" role="dialog" aria-label="Flight plan">
      <div className="mr-h">
        <div>
          <span className="rt-k">Flight plan{plan.callsign ? ` · ${plan.callsign}` : ""}</span>
          <b className="mr-t">{plan.origin.icao} <span aria-hidden>→</span> {plan.destination.icao}</b>
        </div>
        <button className="btn small" aria-label="Close" onClick={onClose}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button>
      </div>
      <div className="mr-ends">
        <span className="rt-tag rwy">RWY {depRwy ?? "—"}</span><span className="rt-tag sid">{sid ?? "No SID"}</span>
        <span className="mr-arrow" aria-hidden>→</span>
        <span className="rt-tag star">{star ?? "No STAR"}</span><span className="rt-tag rwy">RWY {arrRwy ?? "—"}</span>
      </div>
      <p className="mr-sub">{fmt(dist)} nm · {fl(plan.cruiseAltitudeFt)} · {n} waypoints · tap one to go there</p>
      <div className="mr-list"><RouteChips plan={plan} nextIdx={nextFix} onPick={onPick} /></div>
      <DirectNote />
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small primary" onClick={onFit}>Show whole route</button>
        <a className="btn small" href="#/flight">Navlog</a>
        <a className="btn small" href="#/performance">Performance</a>
        <a className="btn small" href="#/approach">Landing helper</a>
      </div>
    </div>
  );
}

export function RouteOverview({ plan, frame, live }: { plan: FlightPlan; frame: TelemetryFrame | null; live: boolean }) {
  const { fuelUnit } = useSettings();
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway;
  const arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null;
  const star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const fixes = plan.fixes.filter((f) => !isTop(f.ident));
  const route = useMemo(() => [{ lat: plan.origin.lat, lon: plan.origin.lon }, ...plan.fixes, { lat: plan.destination.lat, lon: plan.destination.lon }], [plan]);
  const prog = live && frame && !frame.position.onGround ? routeProgress(route, frame.position) : null;
  const nextIdent = prog ? (prog.legIndex < plan.fixes.length ? plan.fixes[prog.legIndex]!.ident : null) : null;
  const passed = new Set(prog ? plan.fixes.slice(0, prog.legIndex).map((f) => f.ident + f.lat) : []);
  const sidFix = fixes.filter((f) => f.proc === "sid");
  const starFix = fixes.filter((f) => f.proc === "star");
  const enroute = fixes.filter((f) => f.proc !== "sid" && f.proc !== "star");
  const firstEn = enroute[0]?.ident, lastEn = enroute.at(-1)?.ident;
  const dist = plan.distanceNm ?? Math.round(distanceNm(plan.origin, plan.destination));
  const center = { lat: (plan.origin.lat + plan.destination.lat) / 2, lon: (plan.origin.lon + plan.destination.lon) / 2 };
  const zoom = Math.max(3, Math.min(8.5, 8.6 - Math.log2(Math.max(20, dist) / 25)));
  const aircraft = frame && frame.attitude.headingTrueDeg !== null ? { lat: frame.position.lat, lon: frame.position.lon, hdg: frame.attitude.headingTrueDeg, alt: frame.position.altMslFt } : null;

  const chip = (f: FlightPlan["fixes"][number], i: number, kind: "sid" | "star" | "en") => {
    const k = f.ident + f.lat;
    return (
      <li key={`${k}-${i}`} className={`rt-fix ${kind}${passed.has(k) ? " passed" : ""}${nextIdent === f.ident ? " next" : ""}`} title={f.altitudeFt != null ? `${f.ident}, planned ${fl(f.altitudeFt)}` : f.ident}>
        {kind === "en" && f.via && f.via !== "DCT" && <span className="rt-via">{f.via}</span>}
        <b>{f.ident}</b>
      </li>
    );
  };

  return (
    <section className="glass rt">
      <div className="rt-h">
        <div>
          <span className="rt-k">{plan.source === "msfs" ? "Plan from the sim" : "SimBrief plan"}{plan.callsign ? ` · ${plan.callsign}` : ""}{plan.aircraftIcao ? ` · ${plan.aircraftIcao}` : ""}{plan.registration ? ` ${plan.registration}` : ""}</span>
          <h2 className="rt-title">{plan.origin.icao} <span aria-hidden>→</span> {plan.destination.icao}</h2>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn small" href="#/performance">Performance</a>
          <a className="btn small" href="#/flight">Navlog</a>
          <a className="btn small" href="#/map">Map</a>
        </div>
      </div>

      <div className="rt-ends">
        <div className="rt-end">
          <span className="rt-k">Departure</span>
          <b className="rt-ap">{plan.origin.icao}</b>
          <span className="rt-name">{plan.origin.name}</span>
          <div className="rt-tags">
            <span className="rt-tag rwy">RWY {depRwy ?? "—"}</span>
            <span className="rt-tag sid">{sid ?? "No SID"}</span>
            {sid && firstEn && <span className="rt-tag dim">to {firstEn}</span>}
          </div>
        </div>
        <div className="rt-mid" aria-hidden>
          <span className="rt-line" />
          <span className="rt-mid-v">{fmt(dist)} nm · {fl(plan.cruiseAltitudeFt)}</span>
        </div>
        <div className="rt-end right">
          <span className="rt-k">Arrival</span>
          <b className="rt-ap">{plan.destination.icao}</b>
          <span className="rt-name">{plan.destination.name}</span>
          <div className="rt-tags">
            {star && lastEn && <span className="rt-tag dim">from {lastEn}</span>}
            <span className="rt-tag star">{star ?? "No STAR"}</span>
            <span className="rt-tag rwy">RWY {arrRwy ?? "—"}</span>
          </div>
        </div>
      </div>

      <RouteChips plan={plan} nextIdx={prog ? prog.legIndex : null} />
      {live && <DirectNote />}

      <div className="rt-body">
        <div className="rt-map">
          <MapView trail={[]} plan={plan} aircraft={aircraft} follow={false} interactive={false} center={[center.lon, center.lat]} zoom={zoom} />
        </div>
        <dl className="rt-stats">
          <div><dt>Distance</dt><dd>{fmt(dist)} nm</dd></div>
          <div><dt>Cruise</dt><dd>{fl(plan.cruiseAltitudeFt)}</dd></div>
          <div><dt>Block</dt><dd>{hm(plan.blockTimeS)}</dd></div>
          <div><dt>Air time</dt><dd>{hm(plan.airTimeS)}</dd></div>
          <div><dt>Out / in</dt><dd>{z(plan.scheduledOut)} / {z(plan.scheduledIn)}</dd></div>
          <div><dt>Alternate</dt><dd>{plan.alternate ?? "—"}</dd></div>
          <div><dt>Block fuel</dt><dd>{fuel(plan.fuelRampKg, fuelUnit)}</dd></div>
          <div><dt>Trip burn</dt><dd>{fuel(plan.fuelBurnKg, fuelUnit)}</dd></div>
          {plan.towKg != null && <div><dt>Takeoff wt</dt><dd>{fuel(plan.towKg, fuelUnit)}</dd></div>}
          {plan.ldwKg != null && <div><dt>Landing wt</dt><dd>{fuel(plan.ldwKg, fuelUnit)}</dd></div>}
          {plan.costIndex != null && <div><dt>Cost index</dt><dd>{plan.costIndex}</dd></div>}
          {plan.paxCount != null && <div><dt>Passengers</dt><dd>{fmt(plan.paxCount)}</dd></div>}
        </dl>
      </div>
      <details className="rt-raw"><summary>ATC route</summary><p className="data">{plan.route || "No route string in this plan."}</p></details>
      {plan.source === "simbrief" && <SimbriefImport compact />}
    </section>
  );
}
