/**
 * The live flight card. Designed to read at a glance from across a desk:
 * route, where you are along it (an altitude profile that lights up as you
 * fly), times against plan, and the one number that matters right now.
 */
import { useMemo } from "react";
import type { TrailPoint } from "../data/store";
import { useApp } from "../data/store";
import { altText, countdown, dur, fmt, PHASE_LABEL, useLive, zulu } from "../data/derive";
import { useChoice, useChosenArrivalRunway } from "./Procedures";

const BARS = 34;

export function LiveCard({ big }: { big?: boolean }) {
  const L = useLive();
  const trail = useApp((s) => s.trail);
  const { frame, flight, plan, phase } = L;
  const est = phaseProgress(L.phase, L.progress, !!L.plan || L.toGoNm !== null, L.completed);
  const bars = useBars(L.plan, trail, est, L.completed);
  const choice = useChoice(flight?.departureIcao ?? plan?.origin.icao, flight?.arrivalIcao ?? plan?.destination.icao);
  const chosenArr = choice.arrRunway ?? null;
  // Where top of descent falls along the bars (from the time to TOD against the time to the gate).
  const T0 = L.timings;
  const todFrac = L.airborne && T0?.toTopOfDescentMs != null && T0.toGateMs != null && T0.toGateMs > 0
    ? Math.min(0.98, est + (T0.toTopOfDescentMs / T0.toGateMs) * (1 - est)) : null;

  if (!flight) return null;
  const callsign = plan?.callsign ?? flight.callsign ?? flight.aircraft?.registration ?? null;
  const type = plan?.aircraftIcao ?? flight.aircraft?.icaoType ?? flight.aircraft?.title ?? "";
  const dep = flight.departureIcao ?? plan?.origin.icao ?? "····";
  const arr = flight.arrivalIcao ?? plan?.destination.icao ?? choice.arr ?? "····";

  // Departure side: actual off-block vs schedule.
  const offDelta = flight.offBlockAt && plan?.scheduledOut ? Math.round((flight.offBlockAt - plan.scheduledOut * 1000) / 60000) : null;
  const depTime = flight.offBlockAt ? zulu(flight.offBlockAt) : plan?.scheduledOut ? zulu(plan.scheduledOut * 1000) : "—";
  const depNote = flight.offBlockAt ? (offDelta === null ? "Off block" : timing(offDelta)) : plan?.scheduledOut ? "Scheduled out" : flight.departureName ?? "Departure";

  // Arrival side: actual on-block, else estimate, else schedule.
  const arrMs = flight.onBlockAt ?? L.etaOnBlock ?? (plan?.scheduledIn ? plan.scheduledIn * 1000 : null);
  const arrDelta = flight.onBlockAt && plan?.scheduledIn ? Math.round((flight.onBlockAt - plan.scheduledIn * 1000) / 60000) : L.scheduleDeltaMin;
  const arrNote = flight.onBlockAt ? (arrDelta === null ? "On block" : timing(arrDelta)) : L.etaOnBlock ? (arrDelta === null ? "Estimated in" : timing(arrDelta)) : plan?.scheduledIn ? "Scheduled in" : flight.arrivalName ?? "Arrival";

  let over = "";
  let main = "—";
  let under = "";
  if (L.completed) {
    over = "Arrived";
    main = flight.wheelsUpAt && flight.wheelsDownAt ? dur(flight.wheelsDownAt - flight.wheelsUpAt) : "—";
    under = `in the air, ${fmt(flight.distanceNm)} nm flown`;
  } else if (L.airborne) {
    const T = L.timings;
    over = T?.toTopOfDescentMs != null ? `Top of descent in ${countdown(T.toTopOfDescentMs)}` : T?.toTopOfClimbMs != null ? `Top of climb in ${countdown(T.toTopOfClimbMs)}` : PHASE_LABEL[phase];
    if (T?.toGateMs != null) {
      main = countdown(T.toGateMs);
      under = `to the gate. Landing ${zulu(L.etaLanding)}, ${fmt(L.toGoNm)} nm out`;
    } else if (L.toGoNm !== null) {
      main = `${fmt(L.toGoNm)} nm`;
      under = "to go";
    } else {
      // No plan: the phase is already in the label above, so show time in the air instead.
      main = flight.wheelsUpAt ? dur((frame?.t ?? Date.now()) - flight.wheelsUpAt) : PHASE_LABEL[phase];
      under = flight.wheelsUpAt ? "in the air · add a plan for arrival times" : "add a plan for arrival times";
    }
  } else if (flight.wheelsDownAt) {
    over = "Taxiing to the gate";
    main = flight.arrivalStand ? `Stand ${flight.arrivalStand}` : fmt(frame?.speed.gsKt) + " kt";
    under = flight.arrivalRunway ? `landed ${flight.arrivalRunway}` : "landed";
  } else if (flight.offBlockAt) {
    over = PHASE_LABEL[phase];
    if (L.timings?.toTakeoffMs != null && phase !== "TAKEOFF") {
      main = countdown(L.timings.toTakeoffMs);
      under = `to take-off, roughly. Pushed ${countdown(frame ? frame.t - flight.offBlockAt : null)} ago`;
    } else {
      main = frame ? dur(frame.t - flight.offBlockAt) : "—";
      under = "since off block";
    }
  } else {
    over = "At the gate";
    const toOut = plan?.scheduledOut && frame ? plan.scheduledOut * 1000 - frame.t : null;
    main = flight.departureStand ? `Stand ${flight.departureStand}` : plan?.scheduledOut ? zulu(plan.scheduledOut * 1000) : "Ready";
    under = toOut !== null ? (toOut > 0 ? `off block due in ${countdown(toOut)}` : `off block was due ${countdown(-toOut)} ago`) : "waiting for off-block";
  }

  return (
    <article className={`glass strong live-card${big ? " big" : ""}`} aria-label="Live flight">
      <div className="lc-top">
        <div className="lc-id">{callsign ? <span>{callsign}</span> : null}<span className={callsign ? "faint" : ""}>{type}</span></div>
        <span className={`lc-phase ph-${phase.toLowerCase()}`}>{PHASE_LABEL[phase]}</span>
      </div>
      <div className="lc-route">
        <div className="lc-apt">
          <div className="code">{dep}</div>
          <div className={`t ${cls(offDelta)}`}>{depTime}</div>
          <div className="s">{depNote}</div>
        </div>
        <div>
          <div className="lc-bars">
            {todFrac !== null && T0?.toTopOfDescentMs != null && (
              <span className="lc-tod" style={{ left: `${todFrac * 100}%` }}>TOD in {countdown(T0.toTopOfDescentMs)}</span>
            )}
            <div className="profile-bars" aria-hidden="true">
              {bars.map((b, i) => <i key={i} className={`${b.cls}${todFrac !== null && i === Math.round(todFrac * (BARS - 1)) ? " tod" : ""}`} style={{ height: `${b.h}px` }} />)}
            </div>
          </div>
          <div className="lc-mid">
            <div className="over">{over}</div>
            <div className="main-v">{main}</div>
            <div className="under">{under}</div>
          </div>
        </div>
        <div className="lc-apt r">
          <div className={`code${arr === "····" ? " unknown" : ""}`}>{arr === "····" ? "—" : arr}</div>
          {arr !== "····" || arrMs ? <div className={`t ${cls(arrDelta)}`}>{zulu(arrMs)}{!flight.onBlockAt && L.etaOnBlock ? <span className="est"> est</span> : null}</div> : null}
          <div className="s">{arr === "····" && !plan ? <a href="#/flight">Add your plan</a> : arrNote}</div>
        </div>
      </div>
      <div className="lc-foot">
        <span className="data">{frame ? `${altText(frame.position.altMslFt)} · ${fmt(frame.speed.gsKt)} kts` : "—"}</span>
        <span className="row" style={{ gap: 6 }}>
          {(flight.departureRunway || plan?.origin.runway) ? <span className={`chip rw${!flight.wheelsUpAt ? " now" : ""}`} title="Departure runway">↗ {flight.departureRunway ?? plan?.origin.runway}</span> : null}
          {(flight.arrivalRunway || chosenArr || plan?.destination.runway) ? <span className={`chip rw${flight.wheelsUpAt ? " now" : ""}`} title="Arrival runway">↘ {flight.arrivalRunway ?? chosenArr ?? plan?.destination.runway}</span> : null}
          {flight.departureStand && !flight.offBlockAt ? <span className="chip accent" title="Departure stand (OpenStreetMap)">Stand {flight.departureStand}</span> : null}
          {flight.arrivalStand ? <span className="chip accent" title="Arrival stand (OpenStreetMap)">Stand {flight.arrivalStand}</span> : null}
        </span>
      </div>
    </article>
  );
}

function timing(deltaMin: number): string {
  if (Math.abs(deltaMin) <= 2) return "On time";
  return deltaMin < 0 ? `${-deltaMin} min early` : `${deltaMin} min late`;
}
function cls(deltaMin: number | null): string {
  if (deltaMin === null) return "";
  return Math.abs(deltaMin) <= 2 ? "on-time" : deltaMin < 0 ? "early" : "late";
}

/** How far along the flight is: the real figure with a plan, else a fair guess from the phase. */
function phaseProgress(phase: string, progress: number, known: boolean, completed: boolean): number {
  if (completed) return 1;
  if (known) return progress;
  const by: Record<string, number> = { PREFLIGHT: 0, PUSHBACK: 0.01, TAXI_OUT: 0.02, TAKEOFF: 0.04, CLIMB: 0.14, CRUISE: 0.5, DESCENT: 0.8, APPROACH: 0.92, LANDING: 0.97, TAXI_IN: 0.99, ARRIVED: 1 };
  return by[phase] ?? 0;
}

/** Bars: the planned altitude profile with a plan; otherwise the usual climb, cruise and descent shape. */
function useBars(plan: ReturnType<typeof useLive>["plan"], _trail: TrailPoint[], progress: number, completed: boolean) {
  return useMemo(() => {
    let alts: number[];
    // Plan altitudes, with gaps (fixes without one) filled in between their neighbours.
    const raw = plan && plan.fixes.length > 1 ? [plan.origin.elevationFt ?? 0, ...plan.fixes.map((f) => f.altitudeFt ?? null), plan.destination.elevationFt ?? 0] : [];
    const known = raw.filter((v) => v != null).length;
    if (raw.length > 3 && known >= Math.max(3, raw.length * 0.5)) {
      const pts = raw.map((v, i) => {
        if (v != null) return v;
        let a = i - 1; while (a > 0 && raw[a] == null) a--;
        let b = i + 1; while (b < raw.length - 1 && raw[b] == null) b++;
        const va = raw[a] ?? 0, vb = raw[b] ?? 0;
        return va + ((vb - va) * (i - a)) / Math.max(1, b - a);
      });
      alts = Array.from({ length: BARS }, (_, i) => pts[Math.min(pts.length - 1, Math.round((i / (BARS - 1)) * (pts.length - 1)))]!);
    } else {
      // Climb over the first fifth, cruise, descend over the last quarter.
      alts = Array.from({ length: BARS }, (_, i) => { const x = i / (BARS - 1); return x < 0.2 ? 0.12 + 0.88 * Math.sin((x / 0.2) * Math.PI / 2) : x > 0.75 ? 0.12 + 0.88 * Math.cos(((x - 0.75) / 0.25) * Math.PI / 2) : 1; });
    }
    const max = Math.max(1, ...alts);
    const lit = Math.round(progress * BARS);
    return alts.map((a, i) => ({ h: 6 + 44 * Math.max(0, a / max), cls: i === lit - 1 && !completed && lit > 0 ? "here" : i < lit ? "on" : "" }));
  }, [plan, Math.round(progress * BARS), completed]);
}

type Ev = { type: string; altMslFt: number | null };
type Ctx = { depRw?: string | null; arrRw?: string | null; fpm?: number | null };
const flAlt = (ft: number | null) => ft == null ? undefined : ft >= 18000 ? `FL${Math.round(ft / 1000) * 10}` : `${(Math.round(ft / 500) * 500).toLocaleString()} ft`;
const EVENT_TEXT: Record<string, (e: Ev, c: Ctx) => [string, string?]> = {
  OFF_BLOCK: () => ["Off block", "Doors closed, brakes off."],
  PUSHBACK_START: () => ["Pushback"],
  TAXI_START: (_e, c) => ["Taxiing out", c.depRw ? `For runway ${c.depRw}.` : undefined],
  TAKEOFF_ROLL: (_e, c) => ["Take-off roll", c.depRw ? `Runway ${c.depRw}.` : undefined],
  WHEELS_UP: (_e, c) => ["Airborne", c.depRw ? `Off runway ${c.depRw}.` : undefined],
  TOP_OF_CLIMB: (e) => ["Top of climb", flAlt(e.altMslFt) ? `Level at ${flAlt(e.altMslFt)}.` : undefined],
  TOP_OF_DESCENT: (e) => ["Top of descent", flAlt(e.altMslFt) ? `Leaving ${flAlt(e.altMslFt)}.` : undefined],
  APPROACH_START: (_e, c) => ["On approach", c.arrRw ? `Runway ${c.arrRw}.` : undefined],
  GO_AROUND: () => ["Go-around", "Climbing away for another try."],
  TOUCHDOWN: (_e, c) => ["Touchdown", c.fpm != null ? `${Math.round(Math.abs(c.fpm))} fpm${c.arrRw ? ` on ${c.arrRw}` : ""}.` : c.arrRw ? `Runway ${c.arrRw}.` : undefined],
  TOUCH_AND_GO: () => ["Touch and go"],
  RUNWAY_EXIT: () => ["Off the runway"],
  ON_BLOCK: () => ["On block", "Arrived at the gate."],
  ENGINES_OFF: () => ["Flight complete", "Engines off."],
};

/** What's next and what just happened, like a phone's flight notifications. */
export function FlightFeed() {
  const L = useLive();
  const events = useApp((s) => s.events);
  const landing = useApp((s) => s.landing);
  const chosenArr = useChosenArrivalRunway(L.flight?.departureIcao ?? L.plan?.origin.icao, L.flight?.arrivalIcao ?? L.plan?.destination.icao);
  if (!L.flight) return null;
  const ctx: Ctx = { depRw: L.flight.departureRunway ?? L.plan?.origin.runway, arrRw: L.flight.arrivalRunway ?? chosenArr ?? L.plan?.destination.runway, fpm: landing?.touchdownVsFpm ?? null };
  const items: { k: string; title: string; sub?: string; when?: string; next?: boolean }[] = [];
  const T = L.timings;
  if (L.airborne && T?.toTopOfDescentMs != null && T.toTopOfDescentMs < 15 * 60_000) {
    const rw = ctx.arrRw;
    items.push({ k: "tod", next: true, title: `Top of descent in ${countdown(T.toTopOfDescentMs)}`, sub: rw ? `Expect runway ${rw}${L.plan?.destination.icao ? ` at ${L.plan.destination.icao}` : ""}.` : undefined });
  } else if (L.airborne && T?.toTopOfClimbMs != null) {
    items.push({ k: "toc", next: true, title: `Top of climb in ${countdown(T.toTopOfClimbMs)}` });
  }
  for (const e of [...events].reverse()) {
    const f = EVENT_TEXT[e.type];
    if (!f) continue;
    const [title, sub] = f(e, ctx);
    items.push({ k: `${e.type}-${e.seq}`, title, sub, when: zulu(e.t) });
    if (items.length >= 3) break;
  }
  if (!items.length) return null;
  return (
    <div className="lc-feed" aria-label="Flight updates">
      {items.map((it) => (
        <div key={it.k} className={`lc-note${it.next ? " next" : ""}`}>
          <div className="lc-note-h"><b>{it.title}</b>{it.when && <span>{it.when}</span>}</div>
          {it.sub && <div className="lc-note-s">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}
