import { useMemo, useState } from "react";
import type { LandingReport } from "@glidepath/protocol";
import { computeTopOfDescent } from "@glidepath/flight-engine";
import { LiveCard } from "../components/LiveCard";
import { DebriefPanel, HandlingCard, TakeoffCard } from "../components/Debrief";
import { touchdownWords } from "@glidepath/flight-engine";
import { AircraftHero } from "../components/Imagery";
import { TimingsTable } from "../components/Timings";
import { ProfileChart } from "../components/ProfileChart";
import { Grade, Kv, Notice, onOff, Section, Tile } from "../components/ui";
import { countdown, dur, EVENT_LABEL, fmt, fuel, useLive, zulu } from "../data/derive";
import { useApp, useSettings } from "../data/store";

export function FlightScreen() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const trail = useApp((s) => s.trail);
  const events = useApp((s) => s.events);
  const landing = useApp((s) => s.landing);
  const { fuelUnit } = useSettings();
  const f = L.frame;
  const profile = L.flight?.aircraft?.profileId ?? "generic";

  if (!L.flight || !f) {
    return (
      <div className="stack">
        <h1 className="title">Flight</h1>
        <section className="glass pad empty"><div className="h2">No live flight</div><p className="muted">{mode === "none" ? "Connect your Bridge in Settings, or start the demo from Home." : "Waiting for the simulator."}</p></section>
      </div>
    );
  }
  const marks = events.filter((e) => ["WHEELS_UP", "TOP_OF_CLIMB", "TOP_OF_DESCENT", "TOUCHDOWN"].includes(e.type))
    .map((e) => ({ t: e.t, label: { WHEELS_UP: "Airborne", TOP_OF_CLIMB: "TOC", TOP_OF_DESCENT: "TOD", TOUCHDOWN: "TD" }[e.type as "TOUCHDOWN"] }));
  const apUnavailable = f.autopilot.master === null;
  const eng = f.engines;

  return (
    <div className="stack">
      <div className="between wrap"><h1 className="title">Flight</h1>{mode === "demo" && <span className="pill demo"><span className="dot" />Demo flight: synthetic data</span>}</div>
      <AircraftHero icaoType={L.flight.aircraft?.icaoType ?? L.plan?.aircraftIcao} title={L.flight.aircraft?.title} tilt={Math.max(-5, Math.min(6, -(f.speed.vsFpm ?? 0) / 450))}>
          <p className="fh-type">{L.flight.aircraft?.icaoType ?? L.plan?.aircraftIcao ?? "Your aircraft"}</p>
          <p className="fh-meta">{[L.plan?.callsign ?? L.flight.callsign, L.flight.aircraft?.registration ?? L.plan?.registration, L.flight.aircraft?.title].filter(Boolean).join(", ") || "Waiting on aircraft details from the sim"}</p>
          <p className="fh-meta data" style={{ fontSize: 15, color: "var(--ink)", marginTop: 10 }}>{(L.flight.departureIcao ?? L.plan?.origin.icao ?? "····") + "  →  " + (L.flight.arrivalIcao ?? L.plan?.destination.icao ?? "····")}</p>
      </AircraftHero>
      {L.completed && <DebriefPanel flight={L.flight} />}
      <LiveCard />

      <div className="grid cols-4">
        <Tile k="Altitude" v={fmt(f.position.altMslFt)} unit="ft" />
        <Tile k="Indicated airspeed" v={fmt(f.speed.iasKt)} unit="kt" />
        <Tile k="Ground speed" v={fmt(f.speed.gsKt)} unit="kt" />
        <Tile k="Vertical speed" v={(f.speed.vsFpm ?? 0) > 0 ? `+${fmt(f.speed.vsFpm)}` : fmt(f.speed.vsFpm)} unit="fpm" />
        <Tile k="True airspeed" v={fmt(f.speed.tasKt)} unit="kt" na={f.speed.tasKt === null} />
        <Tile k="Mach" v={fmt(f.speed.mach, 3)} na={f.speed.mach === null} />
        <Tile k="Heading" v={f.attitude.headingMagDeg === null ? "—" : String(Math.round(f.attitude.headingMagDeg) % 360).padStart(3, "0")} unit="°M" />
        <Tile k="Above ground" v={fmt(f.position.altAglFt)} unit="ft" na={f.position.altAglFt === null} />
      </div>

      {L.timings && (
        <Section title="Timings" right={<span className="faint" style={{ fontSize: 12.5 }}>sched, est, actual</span>}>
          <TimingsTable t={L.timings} plan={L.plan} live={!L.completed} />
        </Section>
      )}

      <Section title="Profile" right={<span className="faint" style={{ fontSize: 12.5 }}>altitude, groundspeed dashed</span>}>
        <ProfileChart trail={trail} showSpeed marks={marks} />
      </Section>

      <div className="grid cols-3">
        <Section title="Progress">
          <Kv k="Flown" v={`${fmt(L.flownNm)} nm`} />
          <Kv k="To go" v={L.toGoNm === null ? "needs a plan" : `${fmt(L.toGoNm)} nm`} />
          <Kv k="Progress" v={`${Math.round(L.progress * 100)}%`} />
          <Kv k="Time to landing" v={L.timings?.toLandingMs != null ? <>{countdown(L.timings.toLandingMs)} <span className="est">est</span></> : "—"} />
          <Kv k="Time to gate" v={L.timings?.toGateMs != null ? <>{countdown(L.timings.toGateMs)} <span className="est">est</span></> : "—"} />
          <Kv k="Block time so far" v={L.timings?.blockMs != null ? dur(L.timings.blockMs) : "—"} />
        </Section>
        <Section title="Fuel">
          <Kv k="On board" v={fuel(f.fuel.totalKg, fuelUnit)} />
          <Kv k="Flow" v={f.fuel.totalFlowKgH === null ? "—" : `${fuel(f.fuel.totalFlowKgH, fuelUnit)}/h`} />
          <Kv k="Used" v={L.flight.fuelStartKg !== null && f.fuel.totalKg !== null ? fuel(L.flight.fuelStartKg - f.fuel.totalKg, fuelUnit) : "—"} />
          <Kv k="At destination" v={L.fuelAtDestinationKg === null ? "—" : <>{fuel(L.fuelAtDestinationKg, fuelUnit)} <span className="est">est</span></>} />
          <Kv k="Planned at landing" v={fuel(L.plan?.fuelLandingKg, fuelUnit)} />
          {L.fuelAtDestinationKg !== null && L.plan?.fuelLandingKg ? (
            <Kv k="Margin vs plan" v={<span className={L.fuelAtDestinationKg >= L.plan.fuelLandingKg ? "on-time" : "late"}>{fuel(L.fuelAtDestinationKg - L.plan.fuelLandingKg, fuelUnit)}</span>} />
          ) : null}
        </Section>
        <Section title="Environment">
          <Kv k="Wind" v={f.environment.windDirDeg === null ? "—" : `${String(Math.round(f.environment.windDirDeg)).padStart(3, "0")}° / ${fmt(f.environment.windKt)} kt`} />
          <Kv k="Outside air" v={f.environment.oatC === null ? "—" : `${fmt(f.environment.oatC)} °C`} />
          <Kv k="QNH" v={f.environment.qnhHpa === null ? "—" : `${fmt(f.environment.qnhHpa)} hPa`} />
          <Kv k="G load" v={fmt(f.loads.gForce, 2)} />
          <Kv k="Sim rate" v={f.sim.simRate === null ? "—" : `${fmt(f.sim.simRate, 1)}×`} />
          <Kv k="Paused" v={f.sim.paused ? "Yes" : "No"} />
        </Section>
      </div>

      <TodCalculator />

      <div className="grid cols-2">
        <Section title="Engines">
          {eng.length === 0 ? <p className="muted">Not available for this aircraft.</p> : (
            <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(eng.length, 4)}, minmax(0,1fr))`, gap: 12 }}>
              {eng.map((e, i) => (
                <div key={i} className="tile">
                  <div className="between"><span className="k">Engine {i + 1}</span><span className={e.running ? "on-time" : "faint"} style={{ fontSize: 12 }}>{e.running ? "Running" : e.running === false ? "Off" : "—"}</span></div>
                  <Bar label="N1" v={e.n1Pct} max={110} />
                  <Bar label="N2" v={e.n2Pct} max={110} />
                  <div className="kv"><span className="k">EGT</span><span className="v">{fmt(e.egtC)} °C</span></div>
                  <div className="kv"><span className="k">Flow</span><span className="v">{fuel(e.fuelFlowKgH, fuelUnit)}/h</span></div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Autopilot" right={<span className="faint" style={{ fontSize: 12.5 }}>read only</span>}>
          {apUnavailable ? (
            <Notice info>This aircraft runs its own autopilot ({profile}). Its values aren't exposed through standard simulator variables yet, so they're hidden rather than shown wrong.</Notice>
          ) : (
            <>
              <Kv k="Autopilot" v={onOff(f.autopilot.master)} />
              <Kv k="Flight director" v={onOff(f.autopilot.flightDirector)} />
              <Kv k="Autothrottle" v={onOff(f.autopilot.autothrottle)} />
              <Kv k="Selected altitude" v={`${fmt(f.autopilot.selectedAltitudeFt)} ft`} />
              <Kv k="Selected heading" v={`${fmt(f.autopilot.selectedHeadingDeg)}° ${f.autopilot.headingHold ? "(HDG hold)" : ""}`} />
              <Kv k="Selected speed" v={`${fmt(f.autopilot.selectedSpeedKt)} kt`} />
              <Kv k="Selected V/S" v={`${fmt(f.autopilot.selectedVsFpm)} fpm`} />
              <Kv k="Modes" v={[f.autopilot.navHold ? "NAV" : null, f.autopilot.approachHold ? "APPR" : null].filter(Boolean).join(", ") || "—"} />
            </>
          )}
        </Section>
      </div>

      <div className="grid cols-3">
        <Section title="Systems">
          <Kv k="Gear" v={f.controls.gearDown === null ? "—" : f.controls.gearDown ? "Down" : "Up"} />
          <Kv k="Flaps" v={f.controls.flapsIndex === null ? "—" : `${fmt(f.controls.flapsIndex)} (${fmt(f.controls.flapsPct)}%)`} />
          <Kv k="Spoilers" v={f.controls.spoilersPct === null ? "—" : `${fmt(f.controls.spoilersPct)}%`} />
          <Kv k="Parking brake" v={onOff(f.controls.parkingBrake)} />
          <Kv k="Battery" v={onOff(f.electrical.battery)} />
          <Kv k="External power" v={onOff(f.electrical.externalPower)} />
          <Kv k="APU" v={f.electrical.apuRpmPct === null ? "—" : `${fmt(f.electrical.apuRpmPct)}%`} />
        </Section>
        <Section title="Lights">
          {(["nav", "beacon", "strobe", "landing", "taxi", "logo", "wing"] as const).map((k) => <Kv key={k} k={k[0]!.toUpperCase() + k.slice(1)} v={onOff(f.lights[k])} />)}
        </Section>
        <Section title="Radios">
          <Kv k="COM 1" v={radio(f.radios.com1ActiveMhz, f.radios.com1StandbyMhz)} />
          <Kv k="COM 2" v={radio(f.radios.com2ActiveMhz, f.radios.com2StandbyMhz)} />
          <Kv k="NAV 1" v={radio(f.radios.nav1ActiveMhz, f.radios.nav1StandbyMhz)} />
          <Kv k="NAV 2" v={radio(f.radios.nav2ActiveMhz, f.radios.nav2StandbyMhz)} />
          <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Active / standby. Tuning from the app arrives with remote control.</p>
        </Section>
      </div>

      {(L.flight.takeoff || L.flight.stats) && (
        <div className="grid cols-2">
          {L.flight.takeoff ? <TakeoffCard t={L.flight.takeoff} runway={L.flight.departureRunway} /> : <Section title="Takeoff"><p className="muted" style={{ margin: 0 }}>Measured from the roll to 1,500 ft: rotation rate, lift-off attitude, climb pitch and tail clearance.</p></Section>}
          {L.flight.stats && <HandlingCard s={L.flight.stats} />}
        </div>
      )}

      <div className="grid cols-2">
        <Section title="Events">
          {events.length === 0 ? <p className="muted">Events appear as the flight progresses.</p> : (
            <div className="timeline">
              {events.filter((e) => e.type !== "SIM_RESUMED").map((e, i) => (
                <div className="tl" key={i}><span className="t">{zulu(e.t)}</span><span className="d" /><span>{EVENT_LABEL[e.type] ?? e.type}{e.altMslFt !== null && !["OFF_BLOCK", "PUSHBACK_START", "TAXI_START", "ON_BLOCK", "ENGINES_OFF"].includes(e.type) ? <span className="faint data" style={{ fontSize: 12.5 }}>, {fmt(e.altMslFt)} ft</span> : null}</span></div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Landing">
          {landing ? <LandingSummary l={landing} /> : <p className="muted">Your landing is graded about 12 seconds after touchdown.</p>}
        </Section>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }}>Block time so far: {L.flight.offBlockAt ? dur(f.t - L.flight.offBlockAt) : "—"}. Values your aircraft doesn't expose show as —.</p>
    </div>
  );
}

function radio(a: number | null, s: number | null) {
  return a === null ? "—" : `${a.toFixed(3)} / ${s === null ? "—" : s.toFixed(3)}`;
}

function Bar({ label, v, max }: { label: string; v: number | null; max: number }) {
  const pct = v === null ? 0 : Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div style={{ marginTop: 10 }}>
      <div className="between" style={{ fontSize: 12.5 }}><span className="muted">{label}</span><span className="data">{v === null ? "—" : `${v.toFixed(1)}%`}</span></div>
      <div style={{ height: 6, borderRadius: 6, background: "rgba(255,255,255,.07)", marginTop: 4, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 6, transition: "width .4s" }} /></div>
    </div>
  );
}

export function LandingSummary({ l }: { l: LandingReport }) {
  return (
    <div>
      <div className="row" style={{ gap: 14, marginBottom: 8 }}>
        <span style={{ transform: "scale(1.4)", transformOrigin: "left center", marginRight: 14 }}><Grade grade={l.grade} score={l.score} /></span>
        <div><div className="data">{fmt(l.score, 1)} / 100</div><div className="muted" style={{ fontSize: 13 }}>{l.verdict}</div></div>
      </div>
      <Kv k="Touchdown" v={l.touchdownVsFpm === null ? "—" : `${touchdownWords(l.touchdownVsFpm, l.profileId).word}, ${fmt(Math.abs(l.touchdownVsFpm))} fpm${l.touchdownVsSource === "derived" ? " (estimated)" : ""}`} />
      <Kv k="Peak load" v={`${fmt(l.peakG, 2)} g`} />
      <Kv k="Runway" v={l.runway ? `${l.runway.ident}, ${fmt(l.runway.distanceFromThresholdFt)} ft in, ${fmt(Math.abs(l.runway.centrelineOffsetFt))} ft ${l.runway.centrelineOffsetFt >= 0 ? "right" : "left"}` : "not identified"} />
      <Kv k="Speed" v={`${fmt(l.iasKt)} kt IAS`} />
      <Kv k="Pitch / bank" v={`${fmt(l.pitchDeg, 1)}° / ${fmt(l.bankDeg, 1)}°`} />
      <Kv k="Crosswind" v={l.crosswindKt === null ? "—" : `${fmt(Math.abs(l.crosswindKt), 1)} kt`} />
      <Kv k="Bounces" v={String(l.bounces)} />
    </div>
  );
}

function TodCalculator() {
  const L = useLive();
  const f = L.frame!;
  const [angle, setAngle] = useState(3);
  const [target, setTarget] = useState<string>("");
  const [distance, setDistance] = useState<string>("");
  const elev = L.destination?.elevationFt ?? 0;
  const tAlt = target === "" ? elev + 3000 : Number(target);
  const dist = distance === "" ? (L.toGoNm === null ? null : Math.max(0, L.toGoNm - 10)) : Number(distance);
  const r = useMemo(() => {
    if (dist === null || f.position.altMslFt === null) return null;
    return computeTopOfDescent({ currentAltitudeFt: f.position.altMslFt, groundSpeedKt: f.speed.gsKt ?? 0, trueAirspeedKt: f.speed.tasKt, descentHeadwindKt: f.speed.tasKt !== null && f.speed.gsKt !== null ? f.speed.tasKt - f.speed.gsKt : null, pathAngleDeg: angle, target: { distanceNm: dist, altitudeFt: tAlt } });
  }, [f.position.altMslFt, f.speed.gsKt, angle, tAlt, dist]);
  return (
    <Section title="Descent planner" right={<span className="est">Estimate, not simulator data</span>}>
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="grid cols-3" style={{ gap: 10 }}>
          <div className="field"><label htmlFor="tod-alt">Be at (ft)</label><input id="tod-alt" className="input data" inputMode="numeric" placeholder={String(elev + 3000)} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d]/g, ""))} /></div>
          <div className="field"><label htmlFor="tod-dist">In (nm)</label><input id="tod-dist" className="input data" inputMode="decimal" placeholder={L.toGoNm === null ? "distance" : String(Math.round(Math.max(0, L.toGoNm - 10)))} value={distance} onChange={(e) => setDistance(e.target.value.replace(/[^\d.]/g, ""))} /></div>
          <div className="field"><label htmlFor="tod-angle">Path</label><select id="tod-angle" className="input" value={angle} onChange={(e) => setAngle(Number(e.target.value))}>{[2.5, 3, 3.5].map((a) => <option key={a} value={a}>{a}°</option>)}</select></div>
          <p className="faint" style={{ gridColumn: "1 / -1", fontSize: 12.5, margin: 0 }}>Defaults: 3,000 ft above {L.destination?.icao ?? "the destination"}, 10 nm before it. Enter a crossing restriction to plan for it instead.</p>
        </div>
        {r ? (
          <div className="grid cols-2" style={{ gap: 10 }}>
            <Tile k={r.pastTod ? "Past top of descent by" : "Top of descent in"} v={fmt(Math.abs(r.distanceToTodNm))} unit="nm" />
            <Tile k="Time to descent" v={r.minutesToTod === null ? "—" : fmt(r.minutesToTod, 1)} unit={r.minutesToTod === null ? undefined : "min"} />
            <Tile k="Descent V/S on path" v={fmt(r.plannedVsFpm)} unit="fpm" />
            <Tile k={r.pastTod ? "V/S needed now" : "Altitude to lose"} v={r.pastTod ? fmt(r.requiredVsNowFpm) : fmt(r.altitudeToLoseFt)} unit={r.pastTod ? "fpm" : "ft"} />
            <p className="faint" style={{ gridColumn: "1 / -1", fontSize: 12, margin: 0 }}>Assumes {r.assumptions.join(", ")}.</p>
          </div>
        ) : <p className="muted">Enter a distance, or load a SimBrief plan so the distance to go is known.</p>}
      </div>
    </Section>
  );
}
