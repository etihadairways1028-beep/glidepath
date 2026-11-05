import { useEffect, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { LiveCard } from "../components/LiveCard";
import { TimingsStrip } from "../components/Timings";
import { useCopilot } from "../data/copilot";
import { ConnPill, Grade, Icon, Notice } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { startDemo } from "../data/demo";
import { altText, dur, fmt, fuel, useLive } from "../data/derive";
import { useApp, useSettings } from "../data/store";

export function Home() {
  const mode = useApp((s) => s.mode);
  const flight = useApp((s) => s.lastFlight ?? s.flight);
  const sim = useApp((s) => s.status?.simState);
  const conn = useApp((s) => s.conn);
  const msg = useApp((s) => s.connMessage);

  return (
    <div className="stack">
      <FlightHeading />
      {mode === "none" && <Onboarding />}
      {mode === "bridge" && conn !== "live" && msg && <Notice>{msg} <a href="#/settings">Connection settings</a></Notice>}
      {mode !== "none" && flight && <LiveCard />}
      {mode !== "none" && flight && <Instruments />}
      {mode !== "none" && flight && <HomeTimings />}
      {mode !== "none" && flight && <CopilotLine />}
      {mode === "bridge" && conn === "live" && !flight && (
        <section className="glass pad empty">
          <div className="h2">{sim === "connected" ? "Ready when you are" : "Start the sim"}</div>
          <p className="muted">{sim === "connected" ? "Recording starts when you push back." : "The Bridge picks it up on its own."}</p>
        </section>
      )}
      <Totals />
    </div>
  );
}

/** The flight is the headline. */
function FlightHeading() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const f = L.flight;
  const from = f?.departureName ?? L.plan?.origin.name ?? f?.departureIcao ?? null;
  const to = f?.arrivalName ?? L.plan?.destination.name ?? f?.arrivalIcao ?? null;
  const short = (n: string | null) => (n ? n.replace(/ (International )?Airport$/i, "") : null);
  const title = !f ? (mode === "none" ? "Glidepath" : "No flight yet") : from && to ? `${short(from)} to ${short(to)}` : from ? `From ${short(from)}` : "Flight in progress";
  return (
    <header className="home-head">
      <div>
        <h1 className="title">{title}</h1>
      </div>
      <ConnPill />
    </header>
  );
}

function Onboarding() {
  return (
    <section className="glass strong onboard">
      <div>
        <h2 className="onboard-h">Your sim flight, on this screen.</h2>
        <p className="muted" style={{ margin: "10px 0 0", maxWidth: 46 + "ch" }}>Run the Bridge on your simulator PC, then open the link it shows on this device.</p>
        <div className="row wrap" style={{ marginTop: 20 }}>
          <a className="btn primary" href="#/settings">Connect my Bridge</a>
          <button className="btn" onClick={() => startDemo()}>Watch a demo flight</button>
        </div>
      </div>
      <ol className="onboard-steps">
        <li><b>Start Bridge</b> on the PC you fly on.</li>
        <li>It opens a page with your pairing link.</li>
        <li>Open the link here. No account needed.</li>
      </ol>
    </section>
  );
}

/** One instrument strip instead of four boxes. */
function Instruments() {
  const L = useLive();
  const { fuelUnit } = useSettings();
  const f = L.frame;
  if (!f) return null;
  const vs = f.speed.vsFpm ?? 0;
  const hdg = f.attitude.headingMagDeg;
  return (
    <section className="glass instruments" aria-label="Instruments">
      <div><span className="k">Altitude</span><span className="v data">{altText(f.position.altMslFt)}</span></div>
      <div><span className="k">Ground speed</span><span className="v data">{fmt(f.speed.gsKt)}<small> kt</small></span></div>
      <div><span className="k">Vertical speed</span><span className="v data">{Math.abs(vs) < 100 ? "Level" : <>{vs > 0 ? "↑" : "↓"} {fmt(Math.abs(vs))}<small> fpm</small></>}</span></div>
      <div><span className="k">Heading</span><span className="v data">{hdg === null ? "—" : String(Math.round(hdg) % 360).padStart(3, "0")}<small>°</small></span></div>
      <div><span className="k">{L.fuelAtDestinationKg !== null ? "Fuel at landing" : "Fuel"}</span><span className="v data">{fuel(L.fuelAtDestinationKg ?? f.fuel.totalKg, fuelUnit)}</span></div>
    </section>
  );
}

function Totals() {
  const mode = useApp((s) => s.mode);
  const current = useApp((s) => s.lastFlight);
  const [flights, setFlights] = useState<FlightSummary[] | null>(null);
  useEffect(() => {
    const b = activeBridge();
    if (mode !== "bridge" || !b) { setFlights(null); return; }
    b.get<FlightSummary[]>("/api/flights?limit=500").then(setFlights).catch(() => setFlights([]));
  }, [mode, current?.id]);
  if (mode === "none") return null;
  const list = mode === "demo" ? (current ? [current] : []) : flights ?? [];
  const done = list.filter((f) => f.status === "completed");
  if (done.length === 0) return null;
  const block = done.reduce((s, f) => s + ((f.onBlockAt ?? 0) - (f.offBlockAt ?? 0)), 0);
  const nm = done.reduce((s, f) => s + f.distanceNm, 0);
  const airports = new Set(done.flatMap((f) => [f.departureIcao, f.arrivalIcao]).filter(Boolean));
  const scores = done.flatMap((f) => f.landings.map((l) => l.score));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return (
    <a className="totals" href="#/logbook" aria-label="Open logbook">
      <span><b className="data">{fmt(done.length)}</b> {done.length === 1 ? "flight" : "flights"}</span>
      <span><b className="data">{dur(block)}</b> block</span>
      <span><b className="data">{fmt(nm)}</b> nm</span>
      <span><b className="data">{airports.size}</b> {airports.size === 1 ? "airport" : "airports"}</span>
      {avg !== null && <span className="row" style={{ gap: 8 }}><Grade grade={gradeOf(avg)} /> average landing</span>}
      <span className="go">Logbook {Icon.back()}</span>
    </a>
  );
}

export function gradeOf(score: number): string {
  return score >= 95 ? "A+" : score >= 88 ? "A" : score >= 78 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

function HomeTimings() {
  const L = useLive();
  return L.timings ? <TimingsStrip t={L.timings} /> : null;
}

/** The copilot speaks up only when something is worth saying. */
function CopilotLine() {
  const { alerts } = useCopilot();
  const top = alerts[0];
  return (
    <a className={`glass copilot-line${top ? ` ${top.level}` : ""}`} href="#/copilot">
      <span className="ic" aria-hidden="true">{Icon.headset()}</span>
      <span className="txt">
        <b>{top ? top.title : "Copilot"}</b>
        <span>{top ? top.detail : "Nothing to flag. Ask me about descent, fuel or the runway."}</span>
      </span>
      {alerts.length > 1 ? <span className="pill" style={{ marginLeft: "auto" }}>{alerts.length - 1} more</span> : null}
    </a>
  );
}
