/**
 * The flight plan, the way an OFP shows it: route, every waypoint with airway, altitude,
 * distance and planned time, where you are along it right now, then fuel and weights.
 * Everything comes from the SimBrief plan; live columns are worked out from your position.
 */
import { useMemo, useState } from "react";
import type { FlightPlan, TelemetryFrame } from "@glidepath/protocol";
import { distanceNm, routeProgress, type LatLon } from "@glidepath/flight-engine";
import { Kv, Section } from "./ui";
import { fmt, fuel } from "../data/derive";
import { loadLatestPlan as loadPlan } from "../data/plan";
import { settingsStore, useApp, useSettings } from "../data/store";

const fl = (ft: number | null | undefined) => ft == null ? "—" : ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${Math.round(ft).toLocaleString("en-US")} ft`;
const hm = (s: number | null | undefined) => { if (s == null || !Number.isFinite(s)) return "—"; const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const clock = (unixS: number) => { const d = new Date(unixS * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

export function FlightPlanCard({ plan, frame, completed }: { plan: FlightPlan; frame: TelemetryFrame | null; completed: boolean }) {
  const { fuelUnit } = useSettings();
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const dest: LatLon = { lat: plan.destination.lat, lon: plan.destination.lon };
  const route = useMemo<LatLon[]>(() => [{ lat: plan.origin.lat, lon: plan.origin.lon }, ...plan.fixes, dest], [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  // Distance along the route to each point (route index), and the whole length.
  const cum = useMemo(() => { const c = [0]; for (let i = 1; i < route.length; i++) c.push(c[i - 1]! + distanceNm(route[i - 1]!, route[i]!)); return c; }, [route]);
  const total = cum[cum.length - 1] ?? 0;
  const pos = frame?.position ?? null;
  const prog = pos && !completed ? routeProgress(route, pos) : null;
  const onGroundAtStart = !!frame?.position.onGround && prog !== null && prog.distanceFlownNm < 3;
  const flown = completed ? total : onGroundAtStart ? 0 : prog?.distanceFlownNm ?? null;
  const nextIdx = completed ? plan.fixes.length : prog ? (onGroundAtStart ? 0 : prog.legIndex) : -1; // index into plan.fixes
  const gs = frame?.speed.gsKt ?? 0;

  const rows = plan.fixes.map((f, i) => {
    const at = cum[i + 1]!;
    const leg = f.legNm ?? (cum[i + 1]! - cum[i]!);
    const toFix = flown === null ? null : at - flown;
    return { f, i, leg, toGoAfter: total - at, toFix, passed: nextIdx > i, next: nextIdx === i };
  });
  // Long plans: show a window around where you are, with the rest behind "Show all".
  const LIMIT = 14;
  const startAt = all || rows.length <= LIMIT ? 0 : Math.max(0, Math.min(rows.length - LIMIT, (nextIdx < 0 ? 0 : nextIdx) - 3));
  const shown = all || rows.length <= LIMIT ? rows : rows.slice(startAt, startAt + LIMIT);
  const next = rows.find((r) => r.next) ?? null;

  const copy = async () => { try { await navigator.clipboard.writeText(plan.route); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ } };
  const head = [plan.origin.icao + (plan.origin.runway ? `/${plan.origin.runway}` : ""), plan.sid, plan.star, plan.destination.icao + (plan.destination.runway ? `/${plan.destination.runway}` : "")];
  const w = (k: keyof FlightPlan) => plan[k] as number | null | undefined;
  const hasWeights = [w("zfwKg"), w("towKg"), w("ldwKg"), w("payloadKg")].some((v) => v != null);

  return (
    <Section title="Flight plan" className="fp-card" right={<span className="row" style={{ gap: 8 }}>
      {plan.ofpUrl && <a className="btn small" href={plan.ofpUrl} target="_blank" rel="noreferrer">Full OFP</a>}
      <button className="btn small" onClick={() => void copy()}>{copied ? "Copied" : "Copy route"}</button>
    </span>}>
      <div className="fp-head">
        <div className="fp-od"><b className="data">{head[0]}</b>{head[1] && <span className="fp-proc">{head[1]}</span>}</div>
        <div className="fp-line" aria-hidden="true"><i style={{ width: `${total > 0 && flown !== null ? Math.max(0, Math.min(100, (flown / total) * 100)) : 0}%` }} /></div>
        <div className="fp-od end">{head[2] && <span className="fp-proc">{head[2]}</span>}<b className="data">{head[3]}</b></div>
      </div>
      <p className="fp-names faint">{[plan.origin.name, plan.destination.name].filter(Boolean).join(" to ")}</p>

      <div className="fp-stats">
        <div><span>Distance</span><b className="data">{fmt(plan.distanceNm ?? total)} nm</b></div>
        <div><span>Cruise</span><b className="data">{fl(plan.cruiseAltitudeFt)}</b></div>
        <div><span>Air time</span><b className="data">{hm(plan.airTimeS)}</b></div>
        <div><span>Block</span><b className="data">{hm(plan.blockTimeS)}</b></div>
        <div><span>Departs</span><b className="data">{plan.scheduledOut ? clock(plan.scheduledOut) : "—"}</b></div>
        <div><span>Arrives</span><b className="data">{plan.scheduledIn ? clock(plan.scheduledIn) : "—"}</b></div>
        <div><span>Alternate</span><b className="data">{plan.alternate ?? "—"}</b></div>
        {plan.costIndex != null && <div><span>Cost index</span><b className="data">{plan.costIndex}</b></div>}
        {plan.avgWindKt != null && <div><span>Avg wind</span><b className="data">{plan.avgWindKt > 0 ? "+" : ""}{fmt(plan.avgWindKt)} kt</b></div>}
      </div>

      <div className="fp-route data" title="ATC route">{plan.route || "No route string in this plan."}</div>

      {next && (
        <p className="fp-next">Next: <b className="data">{next.f.ident}</b>{next.toFix !== null && next.toFix >= 0 ? <> in <b className="data">{fmt(next.toFix)} nm</b>{gs > 40 ? <>, about <b className="data">{Math.max(1, Math.round((next.toFix / gs) * 60))} min</b></> : null}</> : null}{next.f.altitudeFt != null ? <>, planned {fl(next.f.altitudeFt)}</> : null}</p>
      )}

      {rows.length > 0 ? (
        <div className="scroll-x fp-table-wrap">
          <table className="t fp-table">
            <thead><tr><th>Waypoint</th><th>Via</th><th className="r">Altitude</th><th className="r">Leg</th><th className="r">To go</th><th className="r">Time</th><th className="r">Fuel</th><th className="r">Wind</th></tr></thead>
            <tbody>
              <tr className="fp-apt"><td><b className="data">{plan.origin.icao}</b><small>{plan.origin.runway ? `Runway ${plan.origin.runway}` : plan.origin.name ?? ""}</small></td><td /><td className="r data">{plan.origin.elevationFt != null ? `${fmt(plan.origin.elevationFt)} ft` : "—"}</td><td /><td className="r data">{fmt(total)}</td><td className="r data">0:00</td><td className="r data">{plan.fuelTakeoffKg != null ? fuel(plan.fuelTakeoffKg, fuelUnit) : "—"}</td><td /></tr>
              {startAt > 0 && <tr className="fp-more"><td colSpan={8}><button className="link" onClick={() => setAll(true)}>{startAt} earlier waypoints</button></td></tr>}
              {shown.map((r) => (
                <tr key={r.i} className={r.next ? "next" : r.passed ? "passed" : ""}>
                  <td><b className="data">{r.f.ident}</b>{r.f.name && r.f.name !== r.f.ident ? <small>{r.f.name}</small> : r.f.proc ? <small>{r.f.proc === "sid" ? "Departure" : "Arrival"}</small> : null}</td>
                  <td className="data">{r.f.via ?? (r.f.proc === "sid" ? plan.sid : r.f.proc === "star" ? plan.star : null) ?? "DCT"}</td>
                  <td className="r data">{fl(r.f.altitudeFt)}</td>
                  <td className="r data">{fmt(r.leg)}</td>
                  <td className="r data">{r.next && r.toFix !== null ? <span className="fp-live">{fmt(Math.max(0, r.toFix))} away</span> : fmt(r.toGoAfter)}</td>
                  <td className="r data">{hm(r.f.timeS)}</td>
                  <td className="r data">{r.f.fuelKg != null ? fuel(r.f.fuelKg, fuelUnit) : "—"}</td>
                  <td className="r data">{r.f.windDirDeg != null && r.f.windKt != null ? `${String(Math.round(r.f.windDirDeg)).padStart(3, "0")}/${Math.round(r.f.windKt)}` : "—"}</td>
                </tr>
              ))}
              {!all && startAt + LIMIT < rows.length && <tr className="fp-more"><td colSpan={8}><button className="link" onClick={() => setAll(true)}>{rows.length - startAt - LIMIT} more waypoints</button></td></tr>}
              <tr className={`fp-apt${completed ? " passed" : ""}`}><td><b className="data">{plan.destination.icao}</b><small>{plan.destination.runway ? `Runway ${plan.destination.runway}` : plan.destination.name ?? ""}</small></td><td /><td className="r data">{plan.destination.elevationFt != null ? `${fmt(plan.destination.elevationFt)} ft` : "—"}</td><td className="r data">{fmt(total - (cum[cum.length - 2] ?? 0))}</td><td className="r data">0</td><td className="r data">{hm(plan.airTimeS)}</td><td className="r data">{fuel(plan.fuelLandingKg, fuelUnit)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      ) : <p className="muted">This plan has no waypoints.</p>}

      <div className={`fp-bottom${hasWeights ? "" : " one"}`}>
        <div>
          <p className="lp-h">Fuel</p>
          {plan.fuelTaxiKg != null && <Kv k="Taxi" v={fuel(plan.fuelTaxiKg, fuelUnit)} />}
          <Kv k="Trip" v={fuel(plan.fuelBurnKg, fuelUnit)} />
          {plan.fuelContKg != null && <Kv k="Contingency" v={fuel(plan.fuelContKg, fuelUnit)} />}
          {plan.fuelAltnKg != null && <Kv k={`Alternate${plan.alternate ? ` (${plan.alternate})` : ""}`} v={fuel(plan.fuelAltnKg, fuelUnit)} />}
          {plan.fuelReserveKg != null && <Kv k="Final reserve" v={fuel(plan.fuelReserveKg, fuelUnit)} />}
          {plan.fuelExtraKg != null && plan.fuelExtraKg > 0 && <Kv k="Extra" v={fuel(plan.fuelExtraKg, fuelUnit)} />}
          <Kv k="Block (ramp)" v={<b>{fuel(plan.fuelRampKg, fuelUnit)}</b>} />
          <Kv k="At landing" v={fuel(plan.fuelLandingKg, fuelUnit)} />
          {frame?.fuel.totalKg != null && plan.fuelRampKg != null && frame.position.onGround && !completed && (
            <Kv k="On board now" v={<span className={frame.fuel.totalKg + 50 >= plan.fuelRampKg ? "on-time" : "late"}>{fuel(frame.fuel.totalKg, fuelUnit)}{frame.fuel.totalKg + 50 < plan.fuelRampKg ? `, ${fuel(plan.fuelRampKg - frame.fuel.totalKg, fuelUnit)} short` : ""}</span>} />
          )}
        </div>
        {hasWeights && (
          <div>
            <p className="lp-h">Weights</p>
            {plan.paxCount != null && <Kv k="Passengers" v={fmt(plan.paxCount)} />}
            {plan.payloadKg != null && <Kv k="Payload" v={fuel(plan.payloadKg, fuelUnit)} />}
            {plan.zfwKg != null && <Kv k="Zero fuel weight" v={fuel(plan.zfwKg, fuelUnit)} />}
            {plan.towKg != null && <Kv k="Take-off weight" v={fuel(plan.towKg, fuelUnit)} />}
            {plan.ldwKg != null && <Kv k="Landing weight" v={fuel(plan.ldwKg, fuelUnit)} />}
          </div>
        )}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>From your SimBrief plan{plan.callsign ? ` (${plan.callsign})` : ""}, loaded {new Date(plan.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Not for real-world navigation.</p>
    </Section>
  );
}

/** No plan yet: load the latest SimBrief plan right here. */
export function LoadPlanCard() {
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const can = mode !== "demo";
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const p = await loadPlan(s.simbriefUser.trim()); setMsg({ ok: true, t: `Loaded ${p.origin.icao} to ${p.destination.icao}${p.callsign ? ` (${p.callsign})` : ""}.` }); }
    catch (e) { setMsg({ ok: false, t: (e as Error).message || "Couldn't load the plan." }); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Flight plan">
      <p className="muted" style={{ marginTop: 0 }}>Load your latest SimBrief plan to see the route, every waypoint, fuel and weights, and where you are along it.</p>
      <form className="fp-load" onSubmit={(e) => { e.preventDefault(); if (can && s.simbriefUser.trim() && !busy) void go(); }}>
        <input className="input" aria-label="SimBrief username or Pilot ID" value={s.simbriefUser} onChange={(e) => settingsStore.set({ simbriefUser: e.target.value })} placeholder="SimBrief username or Pilot ID" autoComplete="username" />
        <button className="btn primary" type="submit" disabled={!can || !s.simbriefUser.trim() || busy}>{busy ? "Loading…" : "Load my latest plan"}</button>
      </form>
      {!can && <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Stop the demo to load your own plan.</p>}
      {msg && <p className={msg.ok ? "on-time" : "late"} style={{ fontSize: 13, margin: "8px 0 0" }} role="status">{msg.t}</p>}
    </Section>
  );
}
