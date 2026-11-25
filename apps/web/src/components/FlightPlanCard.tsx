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
import { undoDirect, useLastDirect } from "../data/direct";
import { RouteProfile } from "./RouteOverview";
import { settingsStore, useApp, useSettings } from "../data/store";

const fl = (ft: number | null | undefined) => ft == null ? "—" : ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${Math.round(ft).toLocaleString("en-US")} ft`;
const hm = (s: number | null | undefined) => { if (s == null || !Number.isFinite(s)) return "—"; const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const clock = (unixS: number) => { const d = new Date(unixS * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

const isTopFix = (id: string) => /^(TOC|TOD|T\/C|T\/D)$/i.test(id);

/** After a direct-to: which waypoints were dropped, with a way to put them back. */
export function DirectNote() {
  const d = useLastDirect();
  if (!d) return null;
  return (
    <p className="fp-direct" role="status">
      <span className="fp-direct-k">Direct to <b>{d.target}</b></span>
      <span className="fp-direct-v">Skipped {d.idents.slice(0, 6).join(", ")}{d.idents.length > 6 ? ` and ${d.idents.length - 6} more` : ""}</span>
      <button className="linkish" onClick={undoDirect}>Put back</button>
    </p>
  );
}

export function FlightPlanCard({ plan, frame, completed, merged = false }: { plan: FlightPlan; frame: TelemetryFrame | null; completed: boolean; merged?: boolean }) {
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
  const live = !completed && !!frame && !frame.position.onGround;
  const cruise = plan.cruiseAltitudeFt ?? Math.max(0, ...plan.fixes.map((f) => f.altitudeFt ?? 0));

  const rows = plan.fixes.map((f, i) => {
    const at = cum[i + 1]!;
    const leg = f.legNm ?? (cum[i + 1]! - cum[i]!);
    const toFix = flown === null ? null : at - flown;
    return { f, i, leg, toGoAfter: total - at, toFix, passed: nextIdx > i, next: nextIdx === i };
  });
  // Long plans: show a window around where you are, with the rest behind "Show all".
  const LIMIT = 16;
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
      {merged ? (
        <p className="fp-procs">{[plan.origin.runway && `Departure runway ${plan.origin.runway}`, plan.sid && `SID ${plan.sid}`, plan.star && `STAR ${plan.star}`, plan.destination.runway && `Arrival runway ${plan.destination.runway}`].filter(Boolean).map((t) => <span key={t as string} className="chip">{t}</span>)}</p>
      ) : (<>
      <div className="fp-head">
        <div className="fp-od"><b className="data">{head[0]}</b>{head[1] && <span className="fp-proc">{head[1]}</span>}</div>
        <div className="fp-line" aria-hidden="true"><i style={{ width: `${total > 0 && flown !== null ? Math.max(0, Math.min(100, (flown / total) * 100)) : 0}%` }} /></div>
        <div className="fp-od end">{head[2] && <span className="fp-proc">{head[2]}</span>}<b className="data">{head[3]}</b></div>
      </div>
      <p className="fp-names faint">{[plan.origin.name, plan.destination.name].filter(Boolean).join(" to ")}</p>
      <RouteProfile plan={plan} frame={frame} live={!completed} />
      </>)}

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
      {!completed && <DirectNote />}

      {rows.length > 0 ? (
        <div className="nl-wrap">
          <table className="nl">
            <thead><tr><th>Waypoint</th><th className="nl-via">Airway</th><th className="r">Altitude</th><th className="r nl-leg">Leg</th><th className="r">To go</th><th className="r">{live ? "ETA" : "Time"}</th><th className="r nl-fuel">Fuel</th><th className="r nl-wind">Wind</th></tr></thead>
            <tbody>
              <tr className="nl-apt"><td colSpan={8}><span className="nl-apt-i"><b className="data">{plan.origin.icao}</b>{plan.origin.runway && <span className="nl-rwy">RWY {plan.origin.runway}</span>}<span className="nl-apt-n">{plan.origin.name}</span></span></td></tr>
              {startAt > 0 && <tr className="nl-more"><td colSpan={8}><button className="link" onClick={() => setAll(true)}>Show {startAt} earlier waypoints</button></td></tr>}
              {shown.map((r, k) => {
                const prevProc = k === 0 ? (startAt > 0 ? rows[startAt - 1]!.f.proc ?? "en" : "start") : shown[k - 1]!.f.proc ?? "en";
                const proc = r.f.proc ?? "en";
                const head = proc !== prevProc && !isTopFix(r.f.ident)
                  ? <tr key={`h-${r.i}`} className={`nl-sec ${proc}`}><td colSpan={8}><span>{proc === "sid" ? "Departure" : proc === "star" ? "Arrival" : "En route"}</span>{proc === "sid" && plan.sid ? <b>{plan.sid}</b> : proc === "star" && plan.star ? <b>{plan.star}</b> : null}</td></tr>
                  : null;
                if (isTopFix(r.f.ident)) {
                  const toc = /C/i.test(r.f.ident.replace(/^T\/?/i, ""));
                  return [head, <tr key={r.i} className={`nl-top ${toc ? "toc" : "tod"}${r.passed ? " passed" : ""}${r.next ? " next" : ""}`}><td colSpan={8}><span className="nl-top-l" /><span className="nl-top-t">{toc ? "Top of climb" : "Top of descent"}{r.f.altitudeFt != null ? ` · ${fl(r.f.altitudeFt)}` : ""}{r.next && r.toFix !== null ? ` · in ${fmt(Math.max(0, r.toFix))} nm` : ""}</span><span className="nl-top-l" /></td></tr>];
                }
                const prog = r.next && r.toFix !== null && r.leg > 0 ? Math.max(0, Math.min(1, 1 - r.toFix / r.leg)) : null;
                const eta = live && r.toFix !== null && r.toFix > 0 && gs > 40 && frame ? clock(frame.t + (r.toFix / gs) * 3600_000) : null;
                return [head, (
                  <tr key={r.i} className={`nl-row ${proc}${r.next ? " next" : ""}${r.passed ? " passed" : ""}`}>
                    <td className="nl-id">
                      <span className="nl-mark" aria-hidden>{r.passed ? "✓" : ""}</span>
                      <span className="nl-idt"><b className="data">{r.f.ident}</b>{r.next && <em className="nl-next">Next</em>}{r.f.name && r.f.name !== r.f.ident ? <small>{r.f.name}</small> : null}</span>
                      {prog !== null && <span className="nl-prog" aria-hidden><i style={{ width: `${prog * 100}%` }} /></span>}
                    </td>
                    <td className="data nl-via">{r.f.via ?? (proc === "sid" ? plan.sid : proc === "star" ? plan.star : null) ?? "DCT"}</td>
                    <td className="r data nl-alt">{fl(r.f.altitudeFt)}</td>
                    <td className="r data nl-leg">{fmt(r.leg)}</td>
                    <td className="r data">{r.next && r.toFix !== null ? <b className="nl-live">{fmt(Math.max(0, r.toFix))}</b> : fmt(r.toGoAfter)}</td>
                    <td className="r data">{eta ?? hm(r.f.timeS)}</td>
                    <td className="r data nl-fuel">{r.f.fuelKg != null ? fuel(r.f.fuelKg, fuelUnit) : "—"}</td>
                    <td className="r data nl-wind">{r.f.windDirDeg != null && r.f.windKt != null ? `${String(Math.round(r.f.windDirDeg)).padStart(3, "0")}/${Math.round(r.f.windKt)}` : "—"}</td>
                  </tr>
                )];
              })}
              {!all && startAt + LIMIT < rows.length && <tr className="nl-more"><td colSpan={8}><button className="link" onClick={() => setAll(true)}>Show {rows.length - startAt - LIMIT} more waypoints</button></td></tr>}
              <tr className={`nl-apt end${completed ? " passed" : ""}`}><td colSpan={8}><span className="nl-apt-i"><b className="data">{plan.destination.icao}</b>{plan.destination.runway && <span className="nl-rwy">RWY {plan.destination.runway}</span>}<span className="nl-apt-n">{plan.destination.name}</span><span className="nl-apt-r data">{fuel(plan.fuelLandingKg, fuelUnit)} at landing · {hm(plan.airTimeS)}</span></span></td></tr>
            </tbody>
          </table>
          {all && rows.length > LIMIT && <button className="btn small ghost" onClick={() => setAll(false)} style={{ marginTop: 8 }}>Show fewer</button>}
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
