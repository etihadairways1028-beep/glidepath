import { useEffect, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { LiveCard } from "../components/LiveCard";
import { MapView } from "../components/MapView";
import { YourPcs } from "./Account";
import { InstallCard } from "../components/InstallCard";
import { useCloud } from "../data/cloud";
import { AircraftHero } from "../components/Imagery";
import { buildDebrief } from "@glidepath/flight-engine";
import { TimingsStrip } from "../components/Timings";
import { useCopilot } from "../data/copilot";
import { ConnPill, Grade, Icon, Notice } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { startDemo } from "../data/demo";
import { pairWithCode } from "../data/pair";
import { connectFromSettings } from "../App";
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
      {mode === "none" && <YourPcs />}
      <InstallCard />
      {mode === "none" && <Onboarding />}
      {mode === "bridge" && conn !== "live" && msg && <Notice>{msg} <a href="#/settings">Connection settings</a></Notice>}
      {mode !== "none" && flight?.status === "completed" && <DebriefTeaser />}
      {mode !== "none" && flight && <LiveCard />}
      {mode !== "none" && flight && flight.status !== "completed" && <HomeMap />}
      {mode !== "none" && flight && <HomeAircraft />}
      {mode !== "none" && flight && flight.status !== "completed" && <Instruments />}
      {mode !== "none" && flight && flight.status !== "completed" && <SoFar />}
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
  const cloud = useCloud();
  return (
    <section className="glass strong onboard">
      <div>
        <h2 className="onboard-h">Connect to your PC</h2>
        <PairWithCode />
        <div className="row wrap" style={{ marginTop: 18 }}>
          <button className="btn" onClick={() => startDemo()}>Watch a demo flight</button>
          {cloud.status === "ready" && !cloud.active && <a className="btn" href="#/account">Sign in</a>}
        </div>
      </div>
      <ol className="onboard-steps">
        <li><span>Open <b>Glidepath Bridge</b> on the PC you fly on, on the same Wi-Fi as this device.</span></li>
        <li><span>Find the <b>6-digit code</b>: it is in the black Bridge window, at the top of the Bridge page on your PC (localhost:4810), and in <b>Glidepath code.txt</b> on your PC Desktop.</span></li>
        <li><span>Type it here and tap <b>Connect</b>. Done.</span></li>
      </ol>
    </section>
  );
}

function PairWithCode() {
  const [code, setCode] = useState("");
  const [addr, setAddr] = useState("");
  const [showAddr, setShowAddr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await pairWithCode(code, showAddr ? addr : undefined);
      connectFromSettings();
      location.hash = "#/home";
    } catch (err) {
      setMsg((err as Error).message);
      if (/address below/.test((err as Error).message)) setShowAddr(true);
    }
    setBusy(false);
  };
  return (
    <form className="pair-form" onSubmit={go}>
      <p className="muted" style={{ margin: "10px 0 12px" }}>Type the 6-digit code from your PC: it is in the black Bridge window, at the top of localhost:4810, and in Glidepath code.txt on your Desktop.</p>
      <div className="row wrap">
        <input className="pair-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-label="Code from your PC" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />
        <button className="btn primary" disabled={busy || code.replace(/\D/g, "").length !== 6}>{busy ? "Connecting…" : "Connect"}</button>
      </div>
      {showAddr ? (
        <input className="pair-addr-in" inputMode="decimal" placeholder="PC address, e.g. 192.168.1.20" aria-label="PC address" value={addr} onChange={(e) => setAddr(e.target.value)} />
      ) : (
        <button type="button" className="linkish" onClick={() => setShowAddr(true)}>Type my PC's address instead</button>
      )}
      {msg && <p className="pair-msg">{msg}</p>}
    </form>
  );
}

/** Your flight on a small live map; tap for the full map. */
function HomeMap() {
  const L = useLive();
  const trail = useApp((s) => s.trail);
  const f = L.frame;
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg } : null;
  if (!aircraft) return null;
  return (
    <a className="glass home-map" href="#/map" aria-label="Open the live map">
      <MapView trail={trail} plan={L.plan} aircraft={aircraft} follow interactive={false} agl={f?.position.altAglFt ?? null} onGround={!!f?.position.onGround} />
      <span className="home-map-tag">Live map<span aria-hidden> ›</span></span>
    </a>
  );
}

function HomeAircraft() {
  const L = useLive();
  const f = L.flight;
  if (!f) return null;
  const type = f.aircraft?.icaoType ?? L.plan?.aircraftIcao ?? null;
  const reg = f.aircraft?.registration ?? L.plan?.registration ?? null;
  return (
    <AircraftHero icaoType={type} title={f.aircraft?.title} compact>
      <p className="fh-type">{type ?? "Your aircraft"}</p>
      <p className="fh-meta">{[L.plan?.callsign ?? f.callsign, reg].filter(Boolean).join(", ") || f.aircraft?.title}</p>
    </AircraftHero>
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

/** A single line of plain facts about the flight so far. */
function SoFar() {
  const L = useLive();
  const { fuelUnit } = useSettings();
  const f = L.flight;
  if (!f || !L.frame) return null;
  const bits: string[] = [];
  if (L.flownNm > 1) bits.push(`${fmt(L.flownNm)} nm flown`);
  if (f.wheelsUpAt) bits.push(`${dur(L.frame.t - f.wheelsUpAt)} in the air`);
  else if (f.offBlockAt) bits.push(`${dur(L.frame.t - f.offBlockAt)} since pushback`);
  if (f.fuelStartKg !== null && L.frame.fuel.totalKg !== null && f.fuelStartKg - L.frame.fuel.totalKg > 10) bits.push(`${fuel(f.fuelStartKg - L.frame.fuel.totalKg, fuelUnit)} burned`);
  const to = f.takeoff;
  return (
    <div className="sofar">
      {bits.length > 0 && <p>{bits.join(", ")}.</p>}
      {to && (
        <a href="#/flight" className="sofar-to">
          <b>{/takeoff/i.test(to.verdict) ? to.verdict : `Takeoff: ${to.verdict.charAt(0).toLowerCase()}${to.verdict.slice(1)}`}.</b>
          <span>{[to.rotationRateDegS !== null ? `${to.rotationRateDegS}°/s rotation` : null, to.maxPitchDeg !== null ? `${to.maxPitchDeg}° climb pitch` : null, to.liftoffIasKt !== null ? `airborne at ${to.liftoffIasKt} kt` : null].filter(Boolean).join(", ")}</span>
          <Grade grade={to.grade} />
        </a>
      )}
    </div>
  );
}

/** After the flight: the debrief in two lines, with the full thing a tap away. */
function DebriefTeaser() {
  const flight = useApp((s) => s.lastFlight ?? s.flight)!;
  const d = buildDebrief({ ...flight, takeoff: flight.takeoff ?? null, stats: flight.stats ?? null });
  if (!d.sections.length) return null;
  return (
    <a className="glass strong teaser" href={`#/logbook/${flight.id}`}>
      <p className="eyebrow">Debrief</p>
      <h2 className="debrief-h">{d.headline}</h2>
      <p className="debrief-sum">{d.summary}</p>
      {d.toImprove[0] ? <p className="teaser-next"><b>For next time:</b> {d.toImprove[0]}</p> : d.wentWell[0] ? <p className="teaser-next"><b>Best bit:</b> {d.wentWell[0]}</p> : null}
      <span className="go">Read the full debrief {Icon.back()}</span>
    </a>
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
