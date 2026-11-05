/**
 * The Glidepath copilot (rules engine). Works with no AI service at all:
 * every alert, answer and callout is computed from live telemetry, the plan,
 * the timings and published weather. It never guesses: when data is missing
 * it says so. An optional language model can sit on top of this (see the
 * Bridge's /api/ai), but it is fed these same facts.
 */
import type { FlightTimings } from "./timings.js";
import { windComponents } from "./geo.js";
import type { RunwayEnd } from "./landing.js";

export interface CopilotWeather {
  icao: string;
  windDir: number | "VRB" | null;
  windKt: number | null;
  gustKt: number | null;
  visibility: string | null;
  category: string | null;
  qnhHpa: number | null;
  tempC: number | null;
  raw: string;
}

export interface CopilotSnapshot {
  phase: string;
  airborne: boolean;
  altFt: number | null;
  aglFt: number | null;
  iasKt: number | null;
  gsKt: number | null;
  vsFpm: number | null;
  gearDown: boolean | null;
  flapsIndex: number | null;
  fuelKg: number | null;
  fuelAtDestinationKg: number | null;
  plannedLandingFuelKg: number | null;
  toGoNm: number | null;
  departure: string | null;
  arrival: string | null;
  timings: FlightTimings | null;
  tod: { minutesToTod: number | null; pastTod: boolean; plannedVsFpm: number; requiredVsNowFpm: number | null } | null;
  arrivalWeather: CopilotWeather | null;
  arrivalRunways: RunwayEnd[];
  /** Crosswind limit to warn at, kt (aircraft-dependent; 25 is a common airliner guidance value for demonstrated crosswind). */
  crosswindLimitKt?: number;
  lastLanding: { grade: string; score: number; touchdownVsFpm: number | null; verdict: string } | null;
}

export type AlertLevel = "info" | "caution" | "warning";
export interface CopilotAlert { id: string; level: AlertLevel; title: string; detail: string }

const r = (v: number) => Math.round(v);
const nf = (v: number) => r(v).toLocaleString("en-US");

/** Best runway for the wind, with components. */
export function runwayForWind(ends: RunwayEnd[], windDir: number, windKt: number, gustKt: number | null = null) {
  let best: { ident: string; headwindKt: number; crosswindKt: number; gustCrosswindKt: number | null; lengthFt: number } | null = null;
  for (const e of ends) {
    const w = windComponents(windDir, windKt, e.headingTrueDeg);
    const g = gustKt ? windComponents(windDir, gustKt, e.headingTrueDeg) : null;
    if (!best || w.headwindKt > best.headwindKt) {
      best = { ident: e.ident, headwindKt: w.headwindKt, crosswindKt: Math.abs(w.crosswindKt), gustCrosswindKt: g ? Math.abs(g.crosswindKt) : null, lengthFt: e.lengthFt };
    }
  }
  return best;
}

/** Proactive alerts, most important first. */
export function copilotAlerts(s: CopilotSnapshot): CopilotAlert[] {
  const out: CopilotAlert[] = [];
  const agl = s.aglFt;

  // Unstable / dangerous: high sink rate close to the ground.
  if (s.airborne && agl !== null && agl < 1000 && (s.vsFpm ?? 0) < -1000) {
    out.push({ id: "sink-rate", level: "warning", title: "Sink rate", detail: `${nf(-(s.vsFpm ?? 0))} fpm descent at ${nf(agl)} ft above ground. A stable approach is usually under 1,000 fpm here.` });
  }
  // Gear not down on short final.
  if (s.airborne && s.phase === "APPROACH" && agl !== null && agl < 1500 && s.gearDown === false) {
    out.push({ id: "gear", level: "warning", title: "Gear is up", detail: `${nf(agl)} ft above ground on approach with the landing gear up.` });
  }
  // 250 kt below 10,000 ft (ICAO/FAA speed limit in most airspace).
  if (s.airborne && s.altFt !== null && s.altFt < 10000 && (s.iasKt ?? 0) > 260 && (agl ?? 99999) > 2000) {
    out.push({ id: "speed-limit", level: "caution", title: "Above 250 kt below 10,000 ft", detail: `${nf(s.iasKt!)} kt indicated at ${nf(s.altFt)} ft. Most airspace limits this to 250 kt unless ATC allows more.` });
  }
  // Fuel against plan.
  if (s.fuelAtDestinationKg !== null && s.plannedLandingFuelKg !== null) {
    const margin = s.fuelAtDestinationKg - s.plannedLandingFuelKg;
    if (margin < -0.1 * s.plannedLandingFuelKg) {
      out.push({ id: "fuel", level: "warning", title: "Fuel below plan", detail: `Estimated ${nf(s.fuelAtDestinationKg)} kg at ${s.arrival ?? "destination"}, ${nf(-margin)} kg under the planned ${nf(s.plannedLandingFuelKg)} kg.` });
    } else if (margin < 0) {
      out.push({ id: "fuel", level: "caution", title: "Fuel slightly below plan", detail: `Estimated ${nf(s.fuelAtDestinationKg)} kg at ${s.arrival ?? "destination"} against ${nf(s.plannedLandingFuelKg)} kg planned.` });
    }
  }
  // Descent planning.
  if (s.tod && s.airborne && (s.phase === "CRUISE" || s.phase === "CLIMB")) {
    if (s.tod.pastTod && s.tod.requiredVsNowFpm !== null) {
      out.push({ id: "tod-past", level: "caution", title: "Past top of descent", detail: `Start down now. To make the descent you need about ${nf(-s.tod.requiredVsNowFpm)} fpm, against ${nf(-s.tod.plannedVsFpm)} fpm on a normal 3° path.` });
    } else if (s.tod.minutesToTod !== null && s.tod.minutesToTod <= 5) {
      out.push({ id: "tod-soon", level: "info", title: `Top of descent in ${Math.max(1, r(s.tod.minutesToTod))} min`, detail: `Plan the descent: about ${nf(-s.tod.plannedVsFpm)} fpm keeps a 3° path at this groundspeed.` });
    }
  }
  // Arrival weather.
  const w = s.arrivalWeather;
  if (w && typeof w.windDir === "number" && w.windKt !== null && s.arrivalRunways.length) {
    const best = runwayForWind(s.arrivalRunways, w.windDir, w.windKt, w.gustKt);
    const limit = s.crosswindLimitKt ?? 25;
    if (best) {
      const xw = Math.max(best.crosswindKt, best.gustCrosswindKt ?? 0);
      if (xw >= limit) out.push({ id: "crosswind", level: "warning", title: `Strong crosswind at ${w.icao}`, detail: `Even on runway ${best.ident}, the most into wind, the crosswind is ${r(xw)} kt${best.gustCrosswindKt ? " in gusts" : ""}.` });
      else if (xw >= limit * 0.6) out.push({ id: "crosswind", level: "caution", title: `Crosswind at ${w.icao}`, detail: `Runway ${best.ident} is most into wind; expect about ${r(best.crosswindKt)} kt crosswind${best.gustCrosswindKt ? `, ${r(best.gustCrosswindKt)} kt in gusts` : ""}.` });
      if (best.headwindKt < -5) out.push({ id: "tailwind", level: "caution", title: `Tailwind at ${w.icao}`, detail: `No runway is into wind: best is ${best.ident} with ${r(-best.headwindKt)} kt tailwind.` });
    }
  }
  if (w && w.category && /IFR|LIFR/.test(w.category)) {
    out.push({ id: "ifr", level: w.category === "LIFR" ? "warning" : "caution", title: `${w.category} at ${w.icao}`, detail: `Low cloud or visibility${w.visibility ? ` (visibility ${w.visibility})` : ""}. Brief the approach and minimums.` });
  }
  // Schedule.
  const arr = s.timings?.arrival;
  if (arr && arr.tone === "late" && arr.deltaMin >= 15 && s.phase !== "COMPLETED") {
    out.push({ id: "late", level: "info", title: `Running ${arr.label}`, detail: `Estimated on block ${arr.deltaMin} min after the scheduled time.` });
  }
  const order: Record<AlertLevel, number> = { warning: 0, caution: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

export type QuickQuestion = "status" | "descent" | "arrival" | "fuel" | "weather" | "runway" | "landing";

export const QUICK_QUESTIONS: Array<{ id: QuickQuestion; label: string }> = [
  { id: "status", label: "How's the flight going?" },
  { id: "descent", label: "When do I start down?" },
  { id: "arrival", label: "Will I be on time?" },
  { id: "fuel", label: "Fuel check" },
  { id: "weather", label: "Weather at arrival" },
  { id: "runway", label: "Which runway?" },
  { id: "landing", label: "How was my landing?" },
];

const clock = (ms: number | null | undefined) => {
  if (!ms) return null;
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};
const mins = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : ms < 60_000 ? "under a minute" : `${r(ms / 60_000)} min`);

/** Answers to the quick questions, built only from data. */
export function copilotAnswer(q: QuickQuestion, s: CopilotSnapshot): string {
  const t = s.timings;
  switch (q) {
    case "status": {
      const parts: string[] = [];
      parts.push(`${phaseWords(s.phase)}${s.altFt !== null && s.airborne ? ` at ${nf(s.altFt)} ft` : ""}${s.gsKt !== null && (s.gsKt > 30 || s.airborne) ? `, ${nf(s.gsKt)} kt over the ground` : ""}.`);
      if (s.toGoNm !== null && s.arrival) parts.push(`${nf(s.toGoNm)} nm to ${s.arrival}.`);
      if (t?.toGateMs != null) parts.push(`About ${mins(t.toGateMs)} to the gate.`);
      if (t?.arrival) parts.push(`Arrival is ${t.arrival.label.toLowerCase()}.`);
      const alerts = copilotAlerts(s);
      parts.push(alerts.length ? `Worth a look: ${alerts.map((a) => a.title.toLowerCase()).join("; ")}.` : "Nothing needs your attention.");
      return parts.join(" ");
    }
    case "descent": {
      if (!s.airborne) return "We're on the ground. I'll work out the top of descent once you're airborne with a destination.";
      if (["DESCENT", "APPROACH", "LANDING"].includes(s.phase)) return `We're already descending${s.vsFpm !== null ? ` at ${nf(-s.vsFpm)} fpm` : ""}.${s.toGoNm !== null ? ` ${nf(s.toGoNm)} nm to go.` : ""}`;
      if (!s.tod) return "I need a destination for that. Link a SimBrief plan in Settings and I'll calculate it.";
      if (s.tod.pastTod) return `We're past the ideal top of descent. Start down now at about ${nf(-(s.tod.requiredVsNowFpm ?? s.tod.plannedVsFpm))} fpm.`;
      const at = t?.milestones.find((m) => m.id === "tod")?.estimated;
      return `Top of descent in about ${s.tod.minutesToTod !== null ? `${r(s.tod.minutesToTod)} min` : "—"}${at ? ` (${clock(at)})` : ""}. Then about ${nf(-s.tod.plannedVsFpm)} fpm holds a 3° path. This is an estimate from distance to go and groundspeed.`;
    }
    case "arrival": {
      if (!t) return "No flight to time yet.";
      const on = t.milestones.find((m) => m.id === "on")!;
      const inn = t.milestones.find((m) => m.id === "in")!;
      if (inn.actual) return `On block at ${clock(inn.actual)}${t.arrival ? `, ${t.arrival.label.toLowerCase()}` : ""}. Block time ${t.blockMs !== null ? `${Math.floor(t.blockMs / 3_600_000)}h ${String(r((t.blockMs % 3_600_000) / 60_000)).padStart(2, "0")}m` : "—"}.`;
      if (!inn.estimated && !inn.scheduled) return "I can't estimate arrival without a destination. Link a SimBrief plan in Settings.";
      const lines = [`Estimated landing ${clock(on.actual ?? on.estimated) ?? "—"}, on block ${clock(inn.estimated) ?? "—"}.`];
      if (inn.scheduled) lines.push(`Scheduled in ${clock(inn.scheduled)}: ${t.arrival ? t.arrival.label.toLowerCase() : "no estimate yet"}.`);
      if (t.basis) lines.push(`Based on ${t.basis}.`);
      return lines.join(" ");
    }
    case "fuel": {
      if (s.fuelKg === null) return "This aircraft doesn't report its fuel to the simulator connection.";
      const parts = [`${nf(s.fuelKg)} kg on board.`];
      if (s.fuelAtDestinationKg !== null) parts.push(`At this burn, about ${nf(s.fuelAtDestinationKg)} kg at ${s.arrival ?? "destination"}.`);
      if (s.fuelAtDestinationKg !== null && s.plannedLandingFuelKg !== null) {
        const m = s.fuelAtDestinationKg - s.plannedLandingFuelKg;
        parts.push(m >= 0 ? `That's ${nf(m)} kg above the planned landing fuel.` : `That's ${nf(-m)} kg below the planned landing fuel.`);
      }
      return parts.join(" ");
    }
    case "weather": {
      const w = s.arrivalWeather;
      if (!w) return s.arrival ? `No weather for ${s.arrival} yet. Weather comes through the Bridge, which needs internet access.` : "I need a destination first.";
      const wind = w.windDir === "VRB" ? `variable at ${w.windKt ?? "?"} kt` : w.windDir === null ? "calm" : `${String(w.windDir).padStart(3, "0")}° at ${w.windKt} kt${w.gustKt ? `, gusting ${w.gustKt}` : ""}`;
      return `${w.icao}: wind ${wind}${w.visibility ? `, visibility ${w.visibility}` : ""}${w.tempC !== null ? `, ${w.tempC}°C` : ""}${w.qnhHpa !== null ? `, QNH ${w.qnhHpa}` : ""}${w.category ? ` (${w.category})` : ""}. Raw: ${w.raw}`;
    }
    case "runway": {
      const w = s.arrivalWeather;
      if (!s.arrivalRunways.length) return "I don't have runway data for the destination.";
      if (!w || typeof w.windDir !== "number" || w.windKt === null) return `${s.arrival} has runways ${s.arrivalRunways.map((e) => e.ident).join(", ")}. With no wind data I can't pick one; the ATIS will tell you the runway in use.`;
      const b = runwayForWind(s.arrivalRunways, w.windDir, w.windKt, w.gustKt)!;
      return `Runway ${b.ident} is most into wind: ${r(b.headwindKt)} kt headwind, ${r(b.crosswindKt)} kt crosswind${b.gustCrosswindKt ? ` (${r(b.gustCrosswindKt)} kt in gusts)` : ""}, ${nf(b.lengthFt)} ft long. ATC or the ATIS sets the runway in use.`;
    }
    case "landing": {
      const l = s.lastLanding;
      if (!l) return "No landing recorded on this flight yet.";
      return `${l.grade} (${l.score}/100)${l.touchdownVsFpm !== null ? `, ${nf(l.touchdownVsFpm)} fpm at touchdown` : ""}. ${l.verdict}`;
    }
  }
}

function phaseWords(p: string): string {
  return ({ PREFLIGHT: "At the gate", PUSHBACK: "Pushing back", TAXI_OUT: "Taxiing out", TAKEOFF: "Taking off", CLIMB: "Climbing", CRUISE: "Cruising",
    DESCENT: "Descending", APPROACH: "On approach", LANDING: "Landing", TAXI_IN: "Taxiing in", COMPLETED: "On blocks" } as Record<string, string>)[p] ?? p;
}

/* ---------------- spoken callouts ---------------- */

export interface CalloutState {
  phase: string;
  aglFt: number | null;
  airborne: boolean;
  minutesToTod: number | null;
}

const RADIO_CALLS = [2500, 1000, 500, 100, 50, 40, 30, 20, 10];

/**
 * What to say when the flight moves from `prev` to `next`. Radio-altitude
 * calls fire once each while descending on approach, like an airliner's
 * automatic callouts.
 */
export function callouts(prev: CalloutState | null, next: CalloutState, said: Set<string>): string[] {
  const out: string[] = [];
  const once = (key: string, text: string) => {
    if (said.has(key)) return;
    said.add(key);
    out.push(text);
  };
  if (prev && prev.phase !== next.phase) {
    const m: Record<string, string> = {
      TAKEOFF: "Takeoff roll", CLIMB: "Positive climb", CRUISE: "Cruise altitude", DESCENT: "Descent started", APPROACH: "Approach",
      TAXI_IN: "Taxi to the gate", COMPLETED: "On blocks. Welcome in.",
    };
    if (m[next.phase]) once(`phase:${next.phase}`, m[next.phase]!);
  }
  if (next.minutesToTod !== null && next.minutesToTod <= 2 && next.minutesToTod > 0) once("tod2", "Top of descent in two minutes");
  if (next.airborne && (next.phase === "APPROACH" || next.phase === "DESCENT") && prev?.aglFt != null && next.aglFt !== null) {
    for (const h of RADIO_CALLS) {
      if (prev.aglFt > h && next.aglFt <= h) once(`ra:${h}`, h === 2500 ? "Twenty five hundred" : h === 1000 ? "One thousand" : h === 500 ? "Five hundred" : h === 100 ? "One hundred" : String(h));
    }
  }
  if (next.phase === "LANDING" && prev?.phase !== "LANDING") once("touchdown", "Touchdown");
  // A new climb (go-around or new flight) re-arms the radio calls.
  if (next.phase === "CLIMB" && prev?.phase !== "CLIMB") for (const k of [...said]) if (k.startsWith("ra:") || k === "touchdown" || k === "tod2") said.delete(k);
  return out;
}

