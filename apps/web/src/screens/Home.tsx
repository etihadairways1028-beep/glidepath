import { pendingUnload, queueUnload, unloadOnBridge } from "../data/unload";
import { useEffect, useState } from "react";
import { ClockPill } from "../components/Clock";
import type { FlightSummary } from "@glidepath/protocol";
import { FlightFeed, LiveCard } from "../components/LiveCard";
import { Bento } from "../components/Bento";
import { ThisWeek } from "../components/Missions";
import { RouteOverview, RouteProfile, SimbriefImport } from "../components/RouteOverview";
import { MapView } from "../components/MapView";
import { YourPcs } from "./Account";
import { InstallCard } from "../components/InstallCard";
import { CockpitReady } from "../components/CockpitReady";
import { relayStatus, useCloud, type RelayStatus } from "../data/cloud";
import { tryRelay } from "../data/connect";
import { AircraftHero } from "../components/Imagery";
import { buildDebrief } from "@glidepath/flight-engine";
import { TimingsStrip } from "../components/Timings";
import { useCopilot } from "../data/copilot";
import { ConnPill, Grade, Icon, Notice, Roll } from "../components/ui";
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
      {mode === "none" && <Onboarding />}
      <CockpitReady />
      {mode === "bridge" && conn !== "live" && msg && <Notice>{msg} <a href="#/settings">Connection settings</a></Notice>}
      {mode !== "none" && flight?.status === "completed" && <DebriefTeaser />}
      {/* One card for the flight: live status, the full profile, every time and the logbook in one place. */}
      {mode !== "none" && flight && <HomeFlightCard />}
      {mode !== "none" && flight && flight.status !== "completed" ? <Bento /> : mode !== "none" && flight ? <FlightFeed /> : null}
      {mode !== "none" && flight && <QuickActions />}
      {mode !== "none" && <ThisWeek />}
      {mode !== "none" && flight && <HomeAircraft />}
      {mode !== "none" && flight && flight.status !== "completed" && <SoFar />}
      {mode !== "none" && flight && <CopilotLine />}
      {mode !== "none" && !flight && <PreFlight />}
      {mode === "none" && <PlanSection />}
      <Totals />
      <InstallCard />
    </div>
  );
}

const hm = (ms: number | null) => (ms == null || ms < 0 ? "—" : `${Math.floor(ms / 3600000)}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0")}`);
const z = (t: number | null | undefined) => (t ? `${new Date(t).toISOString().slice(11, 16)}Z` : "—");

/**
 * The logbook, on Home: what's being logged during the flight, a button to finish it once you've
 * landed (block and air time worked out and saved), and a confirmation once it's in the logbook.
 */
function HomeFlightCard() {
  const L = useLive();
  return (
    <LiveCard
      profile={L.plan && !L.completed ? <RouteProfile plan={L.plan} frame={L.frame} live /> : undefined}
      below={<>{L.timings && <TimingsStrip t={L.timings} />}<LogCard inline /></>}
    />
  );
}

function LogCard({ inline = false }: { inline?: boolean }) {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(i); }, []);
  const f = L.flight;
  if (!f) return null;
  const clock = L.frame?.t ?? now;
  const done = f.status === "completed" || f.status === "incomplete";
  const blockEnd = f.onBlockAt ?? (done ? f.endedAt ?? null : clock);
  const airEnd = f.wheelsDownAt ?? (done ? null : clock);
  const block = f.offBlockAt && blockEnd ? blockEnd - f.offBlockAt : null;
  const air = f.wheelsUpAt && airEnd ? airEnd - f.wheelsUpAt : null;
  const landed = !!f.wheelsDownAt && !L.airborne && !done;
  const [ask, setAsk] = useState(false);
  const [queued, setQueued] = useState(() => pendingUnload());
  useEffect(() => { const u = () => setQueued(pendingUnload()); window.addEventListener("glidepath-unload", u); return () => window.removeEventListener("glidepath-unload", u); }, []);
  const conn = useApp((s) => s.conn);
  const unload = async () => {
    setAsk(false); setBusy(true); setErr(null);
    const at = Date.now();
    try {
      if (mode === "demo") { const d = (await import("../data/demo")).activeDemo(); d?.seek(1); }
      else if (mode === "bridge" && conn === "live") await unloadOnBridge(f!.id, at);
      else queueUnload({ id: f!.id, at });
    } catch { queueUnload({ id: f!.id, at }); }
    setBusy(false);
  };
  const finish = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === "bridge") await activeBridge()?.post("/api/flight/complete", {});
      else if (mode === "demo") { const d = (await import("../data/demo")).activeDemo(); d?.seek(1); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const route = `${f.departureIcao ?? "····"} → ${f.arrivalIcao ?? "····"}`;
  return (
    <section className={`${inline ? "" : "glass "}logc${inline ? " inline" : ""}${landed ? " landed" : done ? " done" : ""}`} aria-live="polite">
      <div className="logc-l">
        <span className="logc-k">{done ? (f.status === "completed" ? "Saved to your logbook" : "Saved as incomplete") : landed ? "You've landed" : f.offBlockAt ? "Logging this flight" : "Logging starts at pushback"}</span>
        {!inline && <b className="logc-t">{route}{f.aircraft?.icaoType ? <small> · {f.aircraft.icaoType}</small> : null}</b>}
        <div className="logc-times">
          {!inline && <span><em>Off block</em>{z(f.offBlockAt)}</span>}
          {!inline && <span><em>Takeoff</em>{z(f.wheelsUpAt)}</span>}
          {!inline && <span><em>Landing</em>{z(f.wheelsDownAt)}</span>}
          <span><em>Block time</em><b>{hm(block)}</b></span>
          <span><em>Flight time</em><b>{hm(air)}</b></span>
        </div>
        {err && <p className="logc-err">{err}</p>}
      </div>
      <div className="logc-r">
        {landed && <button className="btn primary logc-btn" onClick={() => void finish()} disabled={busy}>{busy ? "Saving…" : "Finish flight and save to logbook"}</button>}
        {landed && <small className="faint">Or just park: it saves by itself when the engines are off.</small>}
        {done && <a className="btn primary" href={`#/logbook/${f.id}`}>Open in logbook</a>}
        {!done && !landed && f.offBlockAt && <small className="faint">Saves itself when you park. If you close the sim after landing, it's still saved.</small>}
        {!done && queued?.id === f.id && <p className="logc-q">Unloaded. It goes to your logbook with the hours so far as soon as your PC is reachable. <button className="linkish" onClick={() => queueUnload(null)}>Undo</button></p>}
        {!done && queued?.id !== f.id && !ask && <button className="btn small logc-unload" onClick={() => setAsk(true)} disabled={busy}>Unload flight</button>}
        {ask && (
          <div className="logc-ask" role="alertdialog" aria-label="Unload this flight?">
            <b>Unload this flight?</b>
            <p>{route} goes to your logbook now{block ? ` with ${hm(block)} block time` : ""}{air ? ` and ${hm(air)} flight time` : ""}.{!f.wheelsDownAt ? " You haven't landed, so it's saved as incomplete." : ""}{mode === "bridge" && conn !== "live" ? " Your PC isn't reachable right now: it's sent as soon as it is." : ""}</p>
            <div className="row" style={{ gap: 8 }}><button className="btn small" autoFocus onClick={() => setAsk(false)}>Keep flying</button><button className="btn small danger" onClick={() => void unload()}>Unload and save</button></div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Your plan: the full route once loaded, or the SimBrief import. */
function PlanSection({ live }: { live?: boolean }) {
  const L = useLive();
  if (L.plan) return <RouteOverview plan={L.plan} frame={L.frame} live={!!live} />;
  if (live) return null;
  return (
    <section className="glass strong pf-plan">
      <div className="pf-plan-t">
        <span className="pf-plan-ic" aria-hidden>{Icon.flight()}</span>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>Import your flight plan</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>Your latest SimBrief plan: runways, SID, STAR, every waypoint, fuel and weights. It shows on the map, the navlog and the Performance page. A plan loaded in MSFS is picked up by the Bridge too.</p>
        </div>
      </div>
      <SimbriefImport />
    </section>
  );
}

/** Before a flight: where you stand, what to do next, and your plan. */
function PreFlight() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const sim = useApp((s) => s.status?.simState);
  const bridgeOk = mode === "demo" || conn === "live";
  const simOk = mode === "demo" || sim === "connected";
  const steps: Array<[boolean, string, string]> = [
    [bridgeOk, bridgeOk ? "Bridge connected" : conn === "connecting" || conn === "reconnecting" ? "Connecting to your PC…" : "Bridge not connected", bridgeOk ? "Live data from your PC" : "Open Glidepath on your PC"],
    [simOk, simOk ? "Sim connected" : "Start the sim", simOk ? "Recording starts when you push back" : "The Bridge picks it up on its own"],
    [!!L.plan, L.plan ? `Plan loaded: ${L.plan.origin.icao} to ${L.plan.destination.icao}` : "Import your plan", L.plan ? `${L.plan.fixes.filter((f) => !/^(TOC|TOD|T\/C|T\/D)$/i.test(f.ident)).length} waypoints${L.plan.sid ? `, ${L.plan.sid}` : ""}${L.plan.star ? `, ${L.plan.star}` : ""}` : "From SimBrief, below"],
  ];
  return (
    <>
      <section className="glass pre">
        <ol className="pre-steps">
          {steps.map(([ok, t, d], i) => (
            <li key={i} className={ok ? "ok" : ""}>
              <span className="pre-dot" aria-hidden>{ok ? "✓" : i + 1}</span>
              <div><b>{t}</b><small>{d}</small></div>
            </li>
          ))}
        </ol>
      </section>
      <PlanSection />
      <QuickActions />
    </>
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
  const title = !f ? (mode === "none" ? "Welcome aboard" : L.plan ? `Ready for ${L.plan.destination.icao}` : "Plan your next flight") : from && to ? `${short(from)} to ${short(to)}` : from ? `From ${short(from)}` : "Flight in progress";
  // The big number, as in the cockpit: flight level up high, feet down low, "Ready" at the gate.
  const alt = L.frame?.position.altMslFt ?? null;
  const gs = L.frame?.speed.gsKt ?? null;
  const big = !f || alt === null ? null : L.airborne ? (alt >= 10000 ? `FL${Math.round(alt / 100).toString().padStart(3, "0")}` : `${Math.round(alt / 10) * 10} ft`) : L.completed ? "Landed" : "Ready";
  const phaseWord: Record<string, string> = { CLIMB: "Climbing", CRUISE: "Cruising", DESCENT: "Descending", APPROACH: "On approach", TAKEOFF: "Taking off", LANDING: "Landing", TAXI_OUT: "Taxiing out", TAXI_IN: "Taxiing in", PUSHBACK: "Pushback" };
  const bits = [phaseWord[L.phase] ?? null, gs !== null && gs > 3 ? `${Math.round(gs)} kt` : null].filter(Boolean) as string[];
  const tod = L.tod && L.airborne && L.tod.distanceToTodNm > 0 ? `T/D in ${Math.round(L.tod.distanceToTodNm)} nm` : null;
  return (
    <header className={`home-head${big ? " v2-hero" : ""}`}>
      <div>
        <h1 className="title">{title}</h1>
        {big && <div className="v2-big" aria-label={`Altitude ${big}`}>{big}</div>}
        {big && (bits.length > 0 || tod) && <div className="v2-sub">{bits.join(" · ")}{tod && <>{bits.length ? " · " : ""}<b>{tod}</b></>}</div>}
      </div>
      <div className="row home-head-r" style={{ gap: 8 }}><ClockPill className="home-clock" /><ConnPill /></div>
    </header>
  );
}

function Onboarding() {
  const cloud = useCloud();
  const signedIn = cloud.status === "ready" && !!cloud.active;
  const email = cloud.accounts.find((a) => a.slot === cloud.active)?.email ?? null;
  const [pc, setPc] = useState<RelayStatus | null>(null);
  // Signed in: watch for the PC signing in too, and connect the moment it does.
  useEffect(() => {
    if (!signedIn) { setPc(null); return; }
    let stop = false;
    const look = () => void relayStatus().then((st) => {
      if (stop) return;
      setPc(st);
      if (st?.linked && !activeBridge()) void tryRelay();
    });
    look();
    const t = window.setInterval(look, 5000);
    return () => { stop = true; window.clearInterval(t); };
  }, [signedIn, cloud.active]);
  return (
    <section className="glass strong onboard">
      <div className="ob-main">
        <div className="ob-diagram" aria-hidden="true">
          <span className="obd-node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg><small>Your PC</small></span>
          <span className="obd-line"><i /></span>
          <span className="obd-node obd-acct"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z" /></svg><small>Your account</small></span>
          <span className="obd-line"><i /></span>
          <span className="obd-node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M11 18h2" /></svg><small>This device</small></span>
        </div>
        <span className="ob-tag">Easiest · any Wi-Fi or mobile data</span>
        <h2 className="onboard-h">Connect with your account</h2>
        <ol className="ob-steps">
          <li className={signedIn ? "done" : ""}>
            {signedIn
              ? <span>Signed in here as <b>{email}</b>.</span>
              : <span><a className="btn primary" href="#/account">Sign in or create a free account</a></span>}
          </li>
          <li className={pc?.linked ? "done" : ""}>
            <span>On your PC, open <b>Glidepath Bridge</b>. Its page opens by itself (or go to <b>localhost:4810</b>). Sign in there with the <b>same account</b>.</span>
          </li>
          <li className={pc?.online ? "done" : ""}><span>That's it. This device connects by itself, wherever you are.</span></li>
        </ol>
        {signedIn && pc && (
          <p className="ob-state">
            {pc.online ? <><span className="dot live" />Your PC{pc.name ? ` (${pc.name})` : ""} is online. Connecting…</>
              : pc.linked ? <><span className="dot warn" />Your PC is signed in but not online. Open Glidepath Bridge on it.</>
              : <><span className="dot" />Waiting for your PC to sign in…</>}
          </p>
        )}
        <div className="row wrap" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => startDemo()}>Watch a demo flight</button>
        </div>
      </div>
      <div className="ob-alt">
        <h3 className="ob-alt-h">Or use the code (same Wi-Fi)</h3>
        <PairWithCode />
      </div>
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
      <p className="muted" style={{ margin: "10px 0 12px" }}>Type the 6-digit code from your PC. It's in Glidepath on the PC (Settings), and in Glidepath code.txt on its Desktop.</p>
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
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg, alt: f.position.altMslFt } : null;
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
      <div><span className="k">Ground speed</span><span className="v data"><Roll text={fmt(f.speed.gsKt)} /><small> kt</small></span></div>
      <div><span className="k">Vertical speed</span><span className="v data">{Math.abs(vs) < 100 ? "Level" : <>{vs > 0 ? "↑" : "↓"} <Roll text={fmt(Math.abs(vs))} /><small> fpm</small></>}</span></div>
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

/** The things you reach for most during a flight, one tap away. */
function QuickActions() {
  const items: Array<[string, string, () => React.ReactElement, string]> = [
    ["remote", "Remote", Icon.remote, "ic-remote"], ["map", "Live map", Icon.map, "ic-map"], ["performance", "Performance", Icon.perf, "ic-performance"],
    ["approach", "Landing helper", Icon.approach, "ic-approach"], ["charts", "Charts", Icon.chart, "ic-charts"], ["checklists", "Checklists", Icon.checklist, "ic-checklists"],
    ["cockpit", "EFB & GSX", Icon.panel, "ic-cockpit"], ["copilot", "Copilot", Icon.headset, "ic-copilot"],
  ];
  return (
    <nav className="quick" aria-label="Quick actions">
      {items.map(([id, label, ic, cls]) => (
        <a key={id} href={`#/${id}`} className="quick-a glass"><span className={`nav-ic ${cls}`} aria-hidden="true">{ic()}</span><span>{label}</span></a>
      ))}
    </nav>
  );
}
