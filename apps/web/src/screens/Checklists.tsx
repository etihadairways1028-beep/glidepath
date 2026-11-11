/**
 * Checklists: simplified normal checklists for sim flying, Airbus or Boeing
 * style. The one for the current phase opens by itself. Items the simulator
 * reports (parking brake, beacon, strobes, landing lights, gear, flaps) tick
 * themselves from live data and say so; everything else you tick by tapping.
 * These are written for Glidepath, not copied from any manufacturer's manual.
 */
import { useEffect, useMemo, useState } from "react";
import type { FlightPhase, TelemetryFrame } from "@glidepath/protocol";
import { useLive } from "../data/derive";

type Auto = (f: TelemetryFrame) => boolean | null;
interface Item { text: string; value: string; auto?: Auto }
interface List { id: string; title: string; when: string; phases: FlightPhase[]; items: Item[] }
type Family = "airbus" | "boeing";

const pb: Auto = (f) => f.controls.parkingBrake;
const pbOff: Auto = (f) => (f.controls.parkingBrake == null ? null : !f.controls.parkingBrake);
const beacon: Auto = (f) => f.lights.beacon;
const strobe: Auto = (f) => f.lights.strobe;
const landing: Auto = (f) => f.lights.landing;
const gearDown: Auto = (f) => f.controls.gearDown;
const gearUp: Auto = (f) => (f.controls.gearDown == null ? null : !f.controls.gearDown);
const flapsSet: Auto = (f) => (f.controls.flapsIndex == null ? null : f.controls.flapsIndex > 0);
const flapsUp: Auto = (f) => (f.controls.flapsIndex == null ? null : f.controls.flapsIndex === 0);
const enginesOff: Auto = (f) => (f.engines.length ? f.engines.every((e) => e.running === false) : null);

function lists(family: Family): List[] {
  const ab = family === "airbus";
  return [
    { id: "cockpit", title: "Cockpit preparation", when: "At the gate, before boarding", phases: ["PREFLIGHT"], items: [
      { text: "Battery / external power", value: "On" },
      { text: ab ? "ADIRS" : "IRS", value: "Nav, aligning" },
      { text: "Flight plan", value: ab ? "Loaded in the MCDU" : "Loaded in the FMC" },
      { text: "Fuel", value: "Checked against the plan" },
      { text: "Altimeters", value: "Set to QNH" },
      { text: "Parking brake", value: "Set", auto: pb },
    ] },
    { id: "beforestart", title: "Before start", when: "Doors closed, ready to push", phases: ["PREFLIGHT"], items: [
      { text: "Take-off speeds", value: ab ? "Entered (V1, VR, V2, FLEX)" : "Set (V1, VR, V2)" },
      { text: "Take-off briefing", value: "Done" },
      { text: "Seat belt signs", value: "On" },
      { text: "Beacon", value: "On", auto: beacon },
      { text: "Doors", value: "Closed" },
      { text: "Pushback clearance", value: "Received" },
    ] },
    { id: "beforetaxi", title: "Before taxi", when: "Engines running, tug clear", phases: ["PUSHBACK"], items: [
      { text: ab ? "APU bleed / APU" : "APU", value: "Off" },
      { text: "Flaps", value: "Set for take-off", auto: flapsSet },
      { text: "Flight controls", value: "Checked" },
      { text: "Trim", value: "Set for take-off" },
      { text: "Taxi clearance", value: "Received" },
    ] },
    { id: "beforeto", title: "Before take-off", when: "Holding short of the runway", phases: ["TAXI_OUT"], items: [
      { text: "Flaps", value: "Set", auto: flapsSet },
      { text: ab ? "Auto brake" : "Autobrake", value: "RTO / MAX" },
      { text: "Transponder", value: "TA/RA" },
      { text: "Cabin", value: "Ready" },
      { text: "Strobes", value: "On", auto: strobe },
      { text: "Landing lights", value: "On", auto: landing },
      { text: "Take-off clearance", value: "Received" },
    ] },
    { id: "afterto", title: "After take-off", when: "Positive climb", phases: ["TAKEOFF", "CLIMB"], items: [
      { text: "Gear", value: "Up", auto: gearUp },
      { text: "Flaps", value: "Up on schedule", auto: flapsUp },
      { text: ab ? "Thrust" : "Thrust", value: ab ? "CL detent" : "Climb" },
      { text: "Altimeters", value: "Standard above transition" },
      { text: "Landing lights (passing 10,000 ft)", value: "Off" },
    ] },
    { id: "descent", title: "Descent and approach", when: "Before top of descent", phases: ["CRUISE", "DESCENT"], items: [
      { text: "Arrival weather (ATIS)", value: "Received" },
      { text: "Approach", value: ab ? "Set in the MCDU" : "Set in the FMC" },
      { text: "Landing speeds", value: "Set" },
      { text: "Approach briefing", value: "Done" },
      { text: "Altimeters", value: "Set to QNH at transition" },
      { text: "Landing lights (passing 10,000 ft)", value: "On", auto: landing },
    ] },
    { id: "landing", title: "Landing", when: "Established on the approach", phases: ["APPROACH"], items: [
      { text: "Gear", value: "Down, three green", auto: gearDown },
      { text: "Flaps", value: "Landing setting", auto: flapsSet },
      { text: ab ? "Ground spoilers" : "Speedbrake", value: "Armed" },
      { text: ab ? "Auto brake" : "Autobrake", value: "Set" },
      { text: "Cabin", value: "Secure" },
      { text: "Landing clearance", value: "Received" },
    ] },
    { id: "afterlanding", title: "After landing", when: "Clear of the runway", phases: ["LANDING", "TAXI_IN"], items: [
      { text: ab ? "Ground spoilers" : "Speedbrake", value: "Retracted" },
      { text: "Flaps", value: "Up", auto: flapsUp },
      { text: "Strobes", value: "Off", auto: (f) => (f.lights.strobe == null ? null : !f.lights.strobe) },
      { text: "Landing lights", value: "Off", auto: (f) => (f.lights.landing == null ? null : !f.lights.landing) },
      { text: "Transponder", value: "Standby or as required" },
      { text: "APU", value: "Start if needed" },
    ] },
    { id: "parking", title: "Parking", when: "On stand", phases: ["COMPLETED"], items: [
      { text: "Parking brake", value: "Set", auto: pb },
      { text: "Engines", value: "Off", auto: enginesOff },
      { text: "Seat belt signs", value: "Off" },
      { text: "Beacon", value: "Off", auto: (f) => (f.lights.beacon == null ? null : !f.lights.beacon) },
      { text: "Fuel pumps", value: "Off" },
    ] },
  ];
}

const KEY = "glidepath.checklists";
type Ticks = Record<string, boolean>;
const load = (): { family: Family; ticks: Ticks; flight: string | null } => {
  try { return { family: "airbus", ticks: {}, flight: null, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { family: "airbus", ticks: {}, flight: null }; }
};

/** A guess from the aircraft type, so the right style opens first. */
function familyFor(type: string | null | undefined): Family | null {
  if (!type) return null;
  const t = type.toUpperCase();
  if (/^A3|AIRBUS|^A2|^BCS/.test(t)) return "airbus";
  if (/^B7|BOEING|^B3/.test(t)) return "boeing";
  return null;
}

export function ChecklistsScreen() {
  const L = useLive();
  const saved = useMemo(load, []);
  const guess = familyFor(L.flight?.aircraft?.icaoType ?? L.plan?.aircraftIcao ?? L.flight?.aircraft?.title);
  const [family, setFamily] = useState<Family>(guess ?? saved.family);
  const flightId = L.flight?.id ?? null;
  // A new flight starts with clean checklists.
  const [ticks, setTicks] = useState<Ticks>(saved.flight === flightId ? saved.ticks : {});
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ family, ticks, flight: flightId })); } catch { /* private mode */ } }, [family, ticks, flightId]);
  useEffect(() => { if (saved.flight !== flightId) setTicks({}); }, [flightId]);

  const all = useMemo(() => lists(family), [family]);
  const current = L.frame ? all.find((l) => l.phases.includes(L.phase))?.id ?? null : null;
  const [open, setOpen] = useState<string | null>(null);
  const shown = open ?? current ?? all[0]!.id;

  const status = (l: List) => {
    let done = 0;
    for (const [i, it] of l.items.entries()) {
      const a = it.auto && L.frame ? it.auto(L.frame) : null;
      if (ticks[`${l.id}:${i}`] || a === true) done++;
    }
    return done;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title">Checklists</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Simplified for sim flying. Your aircraft's own checklist comes first.</p>
        </div>
        <div className="seg" role="group" aria-label="Aircraft style">
          <button className={family === "airbus" ? "on" : ""} onClick={() => setFamily("airbus")}>Airbus</button>
          <button className={family === "boeing" ? "on" : ""} onClick={() => setFamily("boeing")}>Boeing</button>
        </div>
      </div>
      <div className="cl-layout">
        <nav className="glass cl-index" aria-label="Checklists">
          {all.map((l) => {
            const d = status(l);
            const full = d === l.items.length;
            return (
              <button key={l.id} className={`cl-link${shown === l.id ? " on" : ""}${full ? " full" : ""}`} onClick={() => setOpen(l.id)}>
                <span className="cl-ring" style={{ ["--p" as string]: `${(d / l.items.length) * 100}%` }}>{full ? "✓" : ""}</span>
                <span className="cl-name">{l.title}{current === l.id && <em className="cl-now">Now</em>}</span>
                <span className="cl-count">{d}/{l.items.length}</span>
              </button>
            );
          })}
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setTicks({})}>Reset all</button>
        </nav>
        {all.filter((l) => l.id === shown).map((l) => (
          <section key={l.id} className="glass strong cl-card page-enter">
            <div className="between">
              <div><h2 className="h2" style={{ margin: 0 }}>{l.title}</h2><span className="faint" style={{ fontSize: 13 }}>{l.when}</span></div>
              <span className="pill">{status(l)} of {l.items.length}</span>
            </div>
            <ol className="cl-items">
              {l.items.map((it, i) => {
                const k = `${l.id}:${i}`;
                const a = it.auto && L.frame ? it.auto(L.frame) : null;
                const on = !!ticks[k] || a === true;
                return (
                  <li key={k} className={on ? "on" : ""}>
                    <button onClick={() => setTicks((t) => ({ ...t, [k]: !t[k] }))} aria-pressed={on}>
                      <span className="cl-box">{on ? "✓" : ""}</span>
                      <span className="cl-text">{it.text}</span>
                      <span className="cl-dots" />
                      <span className="cl-val">{it.value}</span>
                    </button>
                    {it.auto && L.frame && a !== null && <span className={`cl-sim${a ? " ok" : ""}`}>{a ? "Sim says done" : "Sim says not yet"}</span>}
                  </li>
                );
              })}
            </ol>
            {L.isDemo && <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Demo flight: the "sim says" ticks come from synthetic data.</p>}
          </section>
        ))}
      </div>
    </>
  );
}
