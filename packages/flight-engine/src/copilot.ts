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
import { touchdownWords } from "./review.js";

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

/** Altitude the way pilots say it: flight levels above 18,000 ft. */
export function altWords(ft: number): string {
  return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${nf(Math.round(ft / 10) * 10)} ft`;
}

/** Answers to the quick questions, in the voice of a first officer, from data only. */
export function copilotAnswer(q: QuickQuestion, s: CopilotSnapshot): string {
  const t = s.timings;
  const to = s.arrival ?? "destination";
  switch (q) {
    case "status": {
      const head: string[] = [];
      if (s.airborne && s.altFt !== null) head.push(altWords(s.altFt));
      if (s.gsKt !== null && (s.airborne || s.gsKt > 30)) head.push(`${nf(s.gsKt)} knots`);
      let line = head.length ? `${phaseWords(s.phase)}, ${head.join(", ")}` : phaseWords(s.phase);
      if (s.toGoNm !== null && s.arrival) line += `, ${nf(s.toGoNm)} miles to run to ${s.arrival}`;
      const parts = [line + "."];
      if (t?.toGateMs != null) parts.push(`Gate in about ${mins(t.toGateMs)}${t.arrival ? `, ${t.arrival.label.toLowerCase()}` : ""}.`);
      const alerts = copilotAlerts(s);
      parts.push(alerts.length ? `Keep an eye on: ${alerts.map((a) => a.title.toLowerCase()).join(", ")}.` : "Nothing to flag.");
      return parts.join(" ");
    }
    case "descent": {
      if (!s.airborne) return "Still on the ground. I'll work out top of descent once we're airborne with a destination.";
      if (["DESCENT", "APPROACH", "LANDING"].includes(s.phase)) return `Already on the way down${s.vsFpm !== null ? ` at ${nf(-s.vsFpm)} fpm` : ""}${s.toGoNm !== null ? `, ${nf(s.toGoNm)} miles to run` : ""}.`;
      if (!s.tod) return "I need a destination for that. Link your SimBrief plan in Settings.";
      if (s.tod.pastTod) return `We're past top of descent. Start down now, about ${nf(-(s.tod.requiredVsNowFpm ?? s.tod.plannedVsFpm))} fpm to make it.`;
      const at = t?.milestones.find((m) => m.id === "tod")?.estimated;
      return `Top of descent in about ${s.tod.minutesToTod !== null ? `${r(s.tod.minutesToTod)} minutes` : "—"}${at ? `, around ${clock(at)}` : ""}. Plan on ${nf(-s.tod.plannedVsFpm)} fpm for a 3° path. That's an estimate from distance and groundspeed.`;
    }
    case "arrival": {
      if (!t) return "Nothing to time yet.";
      const on = t.milestones.find((m) => m.id === "on")!;
      const inn = t.milestones.find((m) => m.id === "in")!;
      if (inn.actual) return `On blocks at ${clock(inn.actual)}${t.arrival ? `, ${t.arrival.label.toLowerCase()}` : ""}.${t.blockMs !== null ? ` Block time ${Math.floor(t.blockMs / 3_600_000)}h ${String(r((t.blockMs % 3_600_000) / 60_000)).padStart(2, "0")}m.` : ""}`;
      if (!inn.estimated && !inn.scheduled) return "I can't time the arrival without a destination. Link your SimBrief plan in Settings.";
      let line = `Landing around ${clock(on.actual ?? on.estimated) ?? "—"}, on blocks ${clock(inn.estimated) ?? "—"}.`;
      if (inn.scheduled) line += ` Schedule says ${clock(inn.scheduled)}, so ${t.arrival ? (t.arrival.tone === "on-time" ? "we're on time" : `we're ${t.arrival.label.toLowerCase()}`) : "no estimate yet"}.`;
      return line;
    }
    case "fuel": {
      if (s.fuelKg === null) return "This aircraft doesn't report fuel to the sim connection, so I can't see it.";
      let line = `${nf(s.fuelKg)} kg on board.`;
      if (s.fuelAtDestinationKg !== null) {
        line += ` At this burn we land with about ${nf(s.fuelAtDestinationKg)}`;
        if (s.plannedLandingFuelKg !== null) {
          const m = s.fuelAtDestinationKg - s.plannedLandingFuelKg;
          line += m >= 0 ? `, ${nf(m)} above plan.` : `, ${nf(-m)} under plan.`;
        } else line += ".";
      }
      return line;
    }
    case "weather": {
      const w = s.arrivalWeather;
      if (!w) return s.arrival ? `No weather for ${s.arrival} yet. It comes through the Bridge, so the Bridge needs internet.` : "I need a destination first.";
      const wind = w.windDir === "VRB" ? `variable ${w.windKt ?? "?"}` : w.windDir === null ? "calm" : `${String(w.windDir).padStart(3, "0")} at ${w.windKt}${w.gustKt ? `, gusting ${w.gustKt}` : ""}`;
      const bits = [`wind ${wind}`, w.visibility ? `visibility ${w.visibility}` : null, w.tempC !== null ? `${w.tempC}°` : null, w.qnhHpa !== null ? `QNH ${w.qnhHpa}` : null].filter(Boolean);
      return `${w.icao}: ${bits.join(", ")}.${w.category ? ` ${w.category}.` : ""}\n${w.raw}`;
    }
    case "runway": {
      const w = s.arrivalWeather;
      if (!s.arrivalRunways.length) return `I don't have runway data for ${to}.`;
      if (!w || typeof w.windDir !== "number" || w.windKt === null) return `${to} has ${s.arrivalRunways.map((e) => e.ident).join(", ")}. No wind report yet, so I can't pick one. The ATIS will tell you.`;
      const b = runwayForWind(s.arrivalRunways, w.windDir, w.windKt, w.gustKt)!;
      return `Expect ${b.ident}. It's the one most into wind: ${r(b.headwindKt)} kt on the nose, ${r(b.crosswindKt)} kt across${b.gustCrosswindKt ? ` (${r(b.gustCrosswindKt)} in gusts)` : ""}. The ATIS has the final word.`;
    }
    case "landing": {
      const l = s.lastLanding;
      if (!l) return "No landing on this flight yet.";
      if (l.touchdownVsFpm === null) return `Graded ${l.grade}, ${l.score} out of 100. ${l.verdict}`;
      const w = touchdownWords(l.touchdownVsFpm);
      return `${w.text} Graded ${l.grade}, ${Math.round(l.score)} out of 100.${/^Smooth|^Very smooth/.test(l.verdict) ? "" : ` ${l.verdict}`}`;
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

