/**
 * The live flight card. Designed to read at a glance from across a desk:
 * route, where you are along it (an altitude profile that lights up as you
 * fly), times against plan, and the one number that matters right now.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../data/store";
import { altText, countdown, dur, fmt, PHASE_LABEL, useLive, zulu } from "../data/derive";
import { useChoice, useChosenArrivalRunway } from "./Procedures";


export function LiveCard({ big, profile }: { big?: boolean; profile?: ReactNode }) {
  const L = useLive();
  const { frame, flight, plan, phase } = L;
  const est = phaseProgress(L.phase, L.progress, !!L.plan || L.toGoNm !== null, L.completed);
  const choice = useChoice(flight?.departureIcao ?? plan?.origin.icao, flight?.arrivalIcao ?? plan?.destination.icao);
  const chosenArr = choice.arrRunway ?? null;
  // Where top of descent falls along the bars (from the time to TOD against the time to the gate).
  const T0 = L.timings;
  const todFrac = L.airborne && T0?.toTopOfDescentMs != null && T0.toGateMs != null && T0.toGateMs > 0
    ? Math.min(0.98, est + (T0.toTopOfDescentMs / T0.toGateMs) * (1 - est)) : null;

  // Top of climb: from the time to TOC while climbing; afterwards from the profile's shape.
  const tocFrac = L.airborne && T0?.toTopOfClimbMs != null && T0.toGateMs != null && T0.toGateMs > 0
    ? Math.min(0.9, est + (T0.toTopOfClimbMs / T0.toGateMs) * (1 - est)) : null;
  const events = useApp((s) => s.events);
  const tocEv = events.find((e) => e.type === "TOP_OF_CLIMB");
  const todEv = events.find((e) => e.type === "TOP_OF_DESCENT");
  const nowT = L.frame?.t ?? Date.now();
  const tocLabel = tocEv ? zulu(tocEv.t) : T0?.toTopOfClimbMs != null ? zulu(nowT + T0.toTopOfClimbMs) : null;
  const todLabel = todEv ? zulu(todEv.t) : T0?.toTopOfDescentMs != null ? zulu(nowT + T0.toTopOfDescentMs) : null;
  const altProfile = useProfile(L.plan, tocFrac, todFrac);

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
    <article className={`glass strong live-card${big ? " big" : ""}${profile ? " merged" : ""}`} aria-label="Live flight">
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
          {!profile && <FlightProfile alts={altProfile} progress={est} completed={L.completed} airborne={L.airborne} tocFrac={tocFrac} todFrac={todFrac}
            tocLabel={tocLabel} todLabel={todLabel} />}
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
      {profile && <div className="lc-rp">{profile}</div>}
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

const N = 72;
/** The altitude profile, 0..1 at N points: the plan's altitudes when there are enough, else climb, cruise and descent placed at T/C and T/D. */
function useProfile(plan: ReturnType<typeof useLive>["plan"], tocFrac: number | null, todFrac: number | null): number[] {
  const tocK = tocFrac === null ? null : Math.round(tocFrac * 50);
  const todK = todFrac === null ? null : Math.round(todFrac * 50);
  return useMemo(() => {
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
      // Place each altitude by real distance along the route (not by waypoint count), so the shape matches progress.
      const geo = [plan!.origin, ...plan!.fixes, plan!.destination];
      const cum = [0];
      for (let i = 1; i < geo.length; i++) cum.push(cum[i - 1]! + gcNm(geo[i - 1]!.lat, geo[i - 1]!.lon, geo[i]!.lat, geo[i]!.lon));
      const total = cum.at(-1)! || 1;
      const out = Array.from({ length: N }, (_, i) => {
        const d = (i / (N - 1)) * total;
        let k = 0; while (k < cum.length - 2 && cum[k + 1]! < d) k++;
        const seg = cum[k + 1]! - cum[k]! || 1, f = Math.min(1, Math.max(0, (d - cum[k]!) / seg));
        return pts[k]! + (pts[k + 1]! - pts[k]!) * f;
      });
      const max = Math.max(1, ...out);
      return out.map((v) => Math.max(0, v / max));
    }
    const c = tocK !== null ? tocK / 50 : 0.2, d = todK !== null ? todK / 50 : 0.76;
    const ease = (t: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;
    return Array.from({ length: N }, (_, i) => { const x = i / (N - 1); return x <= c ? ease(x / Math.max(0.01, c)) : x >= d ? 1 - ease((x - d) / Math.max(0.01, 1 - d)) : 1; });
  }, [plan, tocK, todK]);
}

function gcNm(la1: number, lo1: number, la2: number, lo2: number): number {
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function useSize(): [(el: HTMLDivElement | null) => void, number, number] {
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setSize([el.clientWidth, el.clientHeight]);
    ro.current = new ResizeObserver(([e]) => setSize([Math.round(e!.contentRect.width), Math.round(e!.contentRect.height)]));
    ro.current.observe(el);
  }, []);
  return [ref, size[0], size[1]];
}

/**
 * Where you are along the flight, as pilots draw it: the vertical profile from gate to gate,
 * lit up behind you, a plane riding it, and T/C and T/D marked with their times.
 */
function FlightProfile({ alts, progress, completed, airborne, tocFrac, todFrac, tocLabel, todLabel }: {
  alts: number[]; progress: number; completed: boolean; airborne: boolean; tocFrac: number | null; todFrac: number | null; tocLabel: string | null; todLabel: string | null;
}) {
  const [ref, W, boxH] = useSize();
  const H = boxH || 74, top = 20, base = H - 10, pad = 7;
  const id = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const p = Math.min(1, Math.max(0, progress));
  const X = (f: number) => pad + f * (W - pad * 2);
  const Y = (a: number) => base - a * (base - top);
  const altAt = (f: number) => { const x = Math.min(1, Math.max(0, f)) * (alts.length - 1); const k = Math.floor(x), r = x - k; return alts[k]! + ((alts[Math.min(alts.length - 1, k + 1)] ?? alts[k]!) - alts[k]!) * r; };
  // Where the profile reaches cruise and leaves it, when timings don't say.
  const shapeToc = alts.findIndex((a) => a >= 0.97) / (alts.length - 1);
  let lastHi = alts.length - 1; while (lastHi > 0 && alts[lastHi]! < 0.97) lastHi--;
  const fToc = tocFrac ?? (shapeToc > 0 ? shapeToc : null);
  const fTod = todFrac ?? (lastHi > 0 && lastHi < alts.length - 1 ? lastHi / (alts.length - 1) : null);

  const path = useMemo(() => {
    if (W < 40) return "";
    const pts = alts.map((a, i) => [X(i / (alts.length - 1)), Y(a)] as const);
    // Smooth curve through the points (Catmull-Rom to Bézier).
    let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6, c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }, [alts, W, H]);

  const px = X(p), py = Y(altAt(p));
  const slope = (altAt(Math.min(1, p + 0.015)) - altAt(Math.max(0, p - 0.015))) * (base - top) / (0.03 * (W - pad * 2) || 1);
  const angle = Math.max(-28, Math.min(28, (-Math.atan(slope) * 180) / Math.PI));
  // When T/C and T/D are close, their labels lean away from each other instead of overlapping.
  const close = fToc !== null && fTod !== null && Math.abs(X(fTod) - X(fToc)) < 120;
  const marker = (f: number | null, label: string, time: string | null, key: string, side: "l" | "r") => {
    if (f === null || W < 40) return null;
    const x = X(f), y = Y(altAt(f)), passed = f <= p;
    const anchor = close ? (side === "l" ? "end" : "start") : "middle";
    const lx = close ? (side === "l" ? Math.max(70, x + 6) : Math.min(W - 70, x - 6)) : Math.min(W - 36, Math.max(36, x));
    return (
      <g key={key} className={`fp-mark${passed ? " passed" : ""}`}>
        <circle cx={x} cy={y} r={3.2} />
        <text x={lx} y={Math.max(9, y - 9)} textAnchor={anchor}>{label}{time ? <tspan className="fp-time"> {time}</tspan> : null}</text>
      </g>
    );
  };
  return (
    <div className={`flight-profile${completed ? " done" : ""}`} ref={ref} aria-hidden="true">
      {W >= 40 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <linearGradient id={`fl-${id}`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#3D8BFF" /><stop offset="1" stopColor="#8FD0FF" /></linearGradient>
            <linearGradient id={`fa-${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4A9BFF" stopOpacity=".38" /><stop offset="1" stopColor="#4A9BFF" stopOpacity="0" /></linearGradient>
            <clipPath id={`cf-${id}`}><rect x="0" y="0" width={px} height={H} /></clipPath>
            <clipPath id={`cr-${id}`}><rect x={px} y="0" width={W - px} height={H} /></clipPath>
            <filter id={`gl-${id}`} x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          {/* runway baseline with the two airports */}
          <line className="fp-ground" x1={pad} x2={W - pad} y1={base} y2={base} />
          {/* what's left: faint and dashed */}
          <path className="fp-left" d={path} clipPath={`url(#cr-${id})`} />
          {/* what's flown: filled, glowing, solid */}
          <path d={`${path} L${X(1)},${base} L${X(0)},${base} Z`} fill={`url(#fa-${id})`} clipPath={`url(#cf-${id})`} />
          <path d={path} stroke={`url(#fl-${id})`} className="fp-glow" filter={`url(#gl-${id})`} clipPath={`url(#cf-${id})`} />
          <path d={path} stroke={`url(#fl-${id})`} className="fp-flown" clipPath={`url(#cf-${id})`} />
          {marker(fToc, "T/C", tocLabel, "toc", "l")}
          {marker(fTod, "T/D", todLabel, "tod", "r")}
          <circle className="fp-apt" cx={X(0)} cy={base} r={3.5} />
          <circle className={`fp-apt${completed ? " lit" : ""}`} cx={X(1)} cy={base} r={3.5} />
          {/* you are here */}
          {!completed && (
            <g transform={`translate(${px.toFixed(1)},${py.toFixed(1)})`}>
              {airborne && <circle className="fp-pulse" r="7" />}
              <circle className="fp-halo" r="11" />
              <g transform={`rotate(${angle.toFixed(1)})`}>
                <path className="fp-plane" d="M9 0 L3 -1.6 L-1 -8 L-3.2 -8 L-1.2 -1.6 L-6 -1.4 L-7.6 -4 L-9 -4 L-8 0 L-9 4 L-7.6 4 L-6 1.4 L-1.2 1.6 L-3.2 8 L-1 8 L3 1.6 Z" />
              </g>
            </g>
          )}
        </svg>
      )}
    </div>
  );
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
