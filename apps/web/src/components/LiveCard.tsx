/**
 * The live flight card. Designed to read at a glance from across a desk:
 * route, where you are along it (an altitude profile that lights up as you
 * fly), times against plan, and the one number that matters right now.
 */
import { useMemo } from "react";
import type { TrailPoint } from "../data/store";
import { useApp } from "../data/store";
import { dur, fmt, PHASE_LABEL, useLive, zulu } from "../data/derive";

const BARS = 34;

export function LiveCard({ big }: { big?: boolean }) {
  const L = useLive();
  const trail = useApp((s) => s.trail);
  const { frame, flight, plan, phase } = L;
  const bars = useBars(L.plan, trail, L.progress, L.completed);

  if (!flight) return null;
  const callsign = plan?.callsign ?? flight.callsign ?? flight.aircraft?.registration ?? "—";
  const type = plan?.aircraftIcao ?? flight.aircraft?.icaoType ?? flight.aircraft?.title ?? "";
  const dep = flight.departureIcao ?? plan?.origin.icao ?? "····";
  const arr = flight.arrivalIcao ?? plan?.destination.icao ?? "····";

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
    under = `airborne · ${fmt(flight.distanceNm)} nm`;
  } else if (L.airborne) {
    over = L.tod && !L.tod.pastTod && L.tod.minutesToTod !== null ? `Top of descent in ${Math.max(1, Math.round(L.tod.minutesToTod))} min` : PHASE_LABEL[phase];
    main = L.etaLanding && frame ? dur(L.etaLanding - frame.t) : L.toGoNm !== null ? `${fmt(L.toGoNm)} nm` : PHASE_LABEL[phase];
    under = L.etaLanding ? `to landing · ${fmt(L.toGoNm)} nm to go` : "connect a plan for time to go";
  } else if (flight.wheelsDownAt) {
    over = "Taxiing to the gate";
    main = flight.arrivalStand ? `Stand ${flight.arrivalStand}` : fmt(frame?.speed.gsKt) + " kt";
    under = flight.arrivalRunway ? `landed ${flight.arrivalRunway}` : "landed";
  } else if (flight.offBlockAt) {
    over = PHASE_LABEL[phase];
    main = frame ? dur(frame.t - flight.offBlockAt) : "—";
    under = "since off block";
  } else {
    over = "At the gate";
    main = flight.departureStand ? `Stand ${flight.departureStand}` : plan?.scheduledOut ? zulu(plan.scheduledOut * 1000) : "Ready";
    under = plan?.scheduledOut ? "scheduled off block" : "waiting for off-block";
  }

  return (
    <article className={`glass strong live-card${big ? " big" : ""}`} aria-label="Live flight">
      <div className="lc-top">
        <div className="lc-id"><span>{callsign}</span><span className="faint">{type}</span></div>
        <span className="pill phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="lc-route">
        <div className="lc-apt">
          <div className="code">{dep}</div>
          <div className={`t ${cls(offDelta)}`}>{depTime}</div>
          <div className="s">{depNote}</div>
        </div>
        <div>
          <div className="profile-bars" aria-hidden="true">
            {bars.map((b, i) => <i key={i} className={b.cls} style={{ height: `${b.h}px` }} />)}
          </div>
          <div className="lc-mid">
            <div className="over">{over}</div>
            <div className="main-v">{main}</div>
            <div className="under">{under}</div>
          </div>
        </div>
        <div className="lc-apt r">
          <div className="code">{arr}</div>
          <div className={`t ${cls(arrDelta)}`}>{zulu(arrMs)}{!flight.onBlockAt && L.etaOnBlock ? <span className="est"> est</span> : null}</div>
          <div className="s">{arrNote}</div>
        </div>
      </div>
      <div className="lc-foot">
        <span className="data">{frame ? `${fmt(frame.position.altMslFt)} ft · ${fmt(frame.speed.gsKt)} kt` : "—"}</span>
        <span className="row" style={{ gap: 6 }}>
          {(flight.departureRunway || plan?.origin.runway) && !flight.wheelsUpAt ? <span className="chip" title="Departure runway">↗ {flight.departureRunway ?? plan?.origin.runway}</span> : null}
          {flight.wheelsUpAt && (flight.arrivalRunway || plan?.destination.runway) ? <span className="chip" title="Arrival runway">↘ {flight.arrivalRunway ?? plan?.destination.runway}</span> : null}
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

/** Bars: planned altitude profile when there is a plan, else the altitudes actually flown. */
function useBars(plan: ReturnType<typeof useLive>["plan"], trail: TrailPoint[], progress: number, completed: boolean) {
  return useMemo(() => {
    let alts: number[] = [];
    let lit = 0;
    if (plan && plan.fixes.length > 1) {
      const pts = [plan.origin.elevationFt ?? 0, ...plan.fixes.map((f) => f.altitudeFt ?? 0), plan.destination.elevationFt ?? 0];
      alts = Array.from({ length: BARS }, (_, i) => pts[Math.min(pts.length - 1, Math.round((i / (BARS - 1)) * (pts.length - 1)))]!);
      lit = completed ? BARS : Math.round(progress * BARS);
    } else if (trail.length > 1) {
      alts = Array.from({ length: BARS }, (_, i) => trail[Math.min(trail.length - 1, Math.floor((i / BARS) * trail.length))]!.alt);
      lit = BARS;
    } else {
      alts = Array.from({ length: BARS }, (_, i) => Math.sin((i / (BARS - 1)) * Math.PI) * 10);
    }
    const max = Math.max(1, ...alts);
    return alts.map((a, i) => ({ h: 5 + 46 * Math.max(0, a / max), cls: i === lit - 1 && !completed && plan ? "here" : i < lit ? "on" : "" }));
  }, [plan, trail.length, Math.round(progress * BARS), completed]);
}
