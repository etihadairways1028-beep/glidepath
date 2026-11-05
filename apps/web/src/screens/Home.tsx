import { useEffect, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { LiveCard } from "../components/LiveCard";
import { TimingsStrip } from "../components/Timings";
import { useCopilot } from "../data/copilot";
import { ConnPill, Grade, Icon, Notice, Tile } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { startDemo } from "../data/demo";
import { dur, fmt, fuel, useLive } from "../data/derive";
import { useApp, useSettings } from "../data/store";

export function Home() {
  const mode = useApp((s) => s.mode);
  const flight = useApp((s) => s.lastFlight ?? s.flight);
  const sim = useApp((s) => s.status?.simState);
  const conn = useApp((s) => s.conn);
  const msg = useApp((s) => s.connMessage);

  return (
    <div className="stack">
      <header className="between wrap">
        <div>
          <h1 className="title">{greeting()}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{subtitle(mode, sim, !!flight)}</p>
        </div>
        <ConnPill />
      </header>

      {mode === "none" && <Onboarding />}
      {mode === "bridge" && conn !== "live" && msg && <Notice>{msg} <a href="#/settings">Connection settings</a></Notice>}
      {mode !== "none" && flight && <LiveCard />}
      {mode !== "none" && flight && <HomeTimings />}
      {mode !== "none" && flight && <HomeCopilot />}
      {mode === "bridge" && conn === "live" && !flight && (
        <section className="glass pad empty">
          <div className="h2">{sim === "connected" ? "Ready when you are" : "Waiting for Microsoft Flight Simulator"}</div>
          <p className="muted">{sim === "connected" ? "Your flight starts recording when the aircraft leaves the gate." : "Start a flight in the sim. The Bridge connects by itself."}</p>
        </section>
      )}
      {mode !== "none" && flight && <QuickFlight />}
      <QuickActions />
      <Stats />
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Night flying" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function subtitle(mode: string, sim: string | undefined, flying: boolean) {
  if (mode === "demo") return "You're watching a synthetic demo flight replayed through the real flight engine.";
  if (mode === "none") return "Connect the Bridge on your simulator PC to see your flight here.";
  if (flying) return "Live from your simulator.";
  return sim === "connected" ? "Simulator connected." : "Bridge connected.";
}

function Onboarding() {
  return (
    <section className="glass strong pad" style={{ padding: 26 }}>
      <div className="grid cols-2" style={{ gap: 28, alignItems: "center" }}>
        <div className="stack" style={{ gap: 12 }}>
          <h2 className="title" style={{ fontSize: 24 }}>See your sim flight here, live.</h2>
          <p className="muted" style={{ margin: 0 }}>The Glidepath Bridge runs on your simulator PC and sends your flight to this app over your home Wi-Fi.</p>
          <div className="row wrap">
            <a className="btn primary" href="#/settings">Connect my Bridge</a>
            <button className="btn" onClick={() => startDemo()}>Watch a demo flight</button>
          </div>
        </div>
        <ol className="timeline" style={{ margin: 0, paddingLeft: 18, color: "var(--mist)" }}>
          <li style={{ padding: "6px 0" }}>Download the Bridge for Windows and double-click <b style={{ color: "var(--ink)" }}>Start Bridge</b>.</li>
          <li style={{ padding: "6px 0" }}>It opens a page in your browser with a pairing link.</li>
          <li style={{ padding: "6px 0" }}>Open that link on this device. That's it: no account needed.</li>
        </ol>
      </div>
    </section>
  );
}

function QuickFlight() {
  const L = useLive();
  const { fuelUnit } = useSettings();
  const f = L.frame;
  if (!f) return null;
  return (
    <div className="grid cols-4">
      <Tile k="Altitude" v={fmt(f.position.altMslFt)} unit="ft" />
      <Tile k="Vertical speed" v={(f.speed.vsFpm ?? 0) > 0 ? `+${fmt(f.speed.vsFpm)}` : fmt(f.speed.vsFpm)} unit="fpm" />
      <Tile k="Heading" v={f.attitude.headingMagDeg === null ? "—" : String(Math.round(f.attitude.headingMagDeg) % 360).padStart(3, "0")} unit="°M" />
      <Tile k={L.fuelAtDestinationKg !== null ? "Fuel at destination (est.)" : "Fuel on board"} v={fuel(L.fuelAtDestinationKg ?? f.fuel.totalKg, fuelUnit)} />
    </div>
  );
}

function QuickActions() {
  const items = [
    { href: "#/map", icon: Icon.map, t: "Live map", s: "Trail, route and traffic" },
    { href: "#/flight", icon: Icon.flight, t: "Flight monitor", s: "Systems, fuel, descent" },
    { href: "#/glance", icon: Icon.expand, t: "Glance mode", s: "Big view for an iPad on a stand" },
    { href: "#/airports", icon: Icon.tower, t: "Airports", s: "Runways, weather, ATC" },
  ];
  return (
    <div className="grid cols-4">
      {items.map((i) => (
        <a key={i.href} href={i.href} className="glass pad" style={{ textDecoration: "none", color: "var(--ink)", display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(111,182,255,.12)", color: "var(--accent)", flex: "none" }}>
            <span style={{ width: 22, height: 22, display: "block" }}>{i.icon()}</span>
          </span>
          <span><span style={{ display: "block", fontWeight: 650 }}>{i.t}</span><span className="muted" style={{ fontSize: 13 }}>{i.s}</span></span>
        </a>
      ))}
    </div>
  );
}

function Stats() {
  const mode = useApp((s) => s.mode);
  const current = useApp((s) => s.lastFlight);
  const [flights, setFlights] = useState<FlightSummary[] | null>(null);
  useEffect(() => {
    const b = activeBridge();
    if (mode !== "bridge" || !b) { setFlights(null); return; }
    b.get<FlightSummary[]>("/api/flights?limit=500").then(setFlights).catch(() => setFlights([]));
  }, [mode, current?.id]);
  const list = mode === "demo" ? (current ? [current] : []) : flights ?? [];
  const done = list.filter((f) => f.status === "completed");
  if (mode === "none") return null;
  const hours = done.reduce((s, f) => s + ((f.onBlockAt ?? 0) - (f.offBlockAt ?? 0)), 0);
  const nm = done.reduce((s, f) => s + f.distanceNm, 0);
  const airports = new Set(done.flatMap((f) => [f.departureIcao, f.arrivalIcao]).filter(Boolean));
  const scores = done.flatMap((f) => f.landings.map((l) => l.score));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return (
    <section className="glass pad">
      <div className="between" style={{ marginBottom: 12 }}><h2 className="h2">Your flying</h2><a href="#/logbook" className="btn small">Open logbook</a></div>
      {done.length === 0 ? <p className="muted" style={{ margin: 0 }}>Completed flights appear here with your totals.</p> : (
        <div className="grid cols-4">
          <Tile k="Flights" v={fmt(done.length)} />
          <Tile k="Block time" v={dur(hours)} />
          <Tile k="Distance" v={fmt(nm)} unit="nm" />
          <Tile k="Average landing" v={avg === null ? "—" : <span className="row" style={{ gap: 8 }}><Grade grade={gradeOf(avg)} /> {fmt(avg)}</span>} />
        </div>
      )}
      {done.length > 0 && <p className="faint" style={{ margin: "10px 0 0", fontSize: 13 }}>{airports.size} airport{airports.size === 1 ? "" : "s"} visited</p>}
    </section>
  );
}

export function gradeOf(score: number): string {
  return score >= 95 ? "A+" : score >= 88 ? "A" : score >= 78 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

function HomeTimings() {
  const L = useLive();
  return L.timings ? <TimingsStrip t={L.timings} /> : null;
}

function HomeCopilot() {
  const { alerts } = useCopilot();
  const top = alerts[0];
  return (
    <a className="glass home-alert" href="#/copilot">
      <span className="orb" aria-hidden="true">{Icon.spark()}</span>
      <span className="txt">
        <b>{top ? top.title : "Copilot: all clear"}</b>
        <span>{top ? top.detail : "Ask about descent, fuel, weather or arrival time."}</span>
      </span>
      {alerts.length > 1 ? <span className="pill" style={{ marginLeft: "auto" }}>+{alerts.length - 1}</span> : null}
    </a>
  );
}
