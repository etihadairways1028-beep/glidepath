/**
 * Stream overlay: a transparent page for OBS (Browser source) or any streaming app.
 * Open it on the sim PC at http://localhost:4810/app/#/overlay (bar along the bottom)
 * or #/overlay/card (compact card). Everything shown is the live flight from the Bridge;
 * with no flight it shows nothing, so it never puts made-up numbers on stream.
 */
import { useEffect } from "react";
import { countdown, fmt, PHASE_LABEL, useLive } from "../data/derive";

export function Overlay({ layout }: { layout?: string }) {
  const L = useLive();
  useEffect(() => {
    document.documentElement.classList.add("ov-page");
    return () => document.documentElement.classList.remove("ov-page");
  }, []);
  const { frame: f, flight, plan, phase } = L;
  if (!flight || !f) return <div className="ov-empty" aria-hidden="true" />;
  const callsign = plan?.callsign ?? flight.callsign ?? flight.aircraft?.registration ?? "";
  const type = plan?.aircraftIcao ?? flight.aircraft?.icaoType ?? "";
  const dep = flight.departureIcao ?? plan?.origin.icao ?? "····";
  const arr = flight.arrivalIcao ?? plan?.destination.icao ?? "····";
  const pct = Math.round(Math.min(1, Math.max(0, L.completed ? 1 : L.progress)) * 100);
  const toGate = L.timings?.toGateMs ?? null;
  const card = layout === "card";
  const stats: [string, string][] = [
    ["ALT", f.position.onGround ? "GND" : `${fmt(f.position.altMslFt)} ft`],
    ["GS", `${fmt(f.speed.gsKt)} kt`],
    ["VS", `${f.speed.vsFpm !== null && f.speed.vsFpm > 0 ? "+" : ""}${fmt(f.speed.vsFpm)}`],
  ];
  if (L.toGoNm !== null) stats.push(["TO GO", `${fmt(L.toGoNm)} nm`]);
  if (toGate !== null) stats.push(["GATE IN", countdown(toGate)]);
  return (
    <div className={`ov ${card ? "ov-card" : "ov-bar"}`}>
      <div className="ov-id">
        <b>{callsign || "Live flight"}</b>
        {type && <span>{type}</span>}
      </div>
      <div className="ov-route">
        <b>{dep}</b>
        <div className="ov-track" aria-label={`${pct}% of the way`}>
          <i style={{ width: `${pct}%` }} />
          <svg style={{ left: `${pct}%` }} viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill="currentColor" transform="rotate(90 12 12)" /></svg>
        </div>
        <b>{arr}</b>
      </div>
      <span className={`ov-phase ph-${phase.toLowerCase()}`}>{PHASE_LABEL[phase]}</span>
      <div className="ov-stats">
        {stats.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <span className="ov-brand">glidepath</span>
    </div>
  );
}
