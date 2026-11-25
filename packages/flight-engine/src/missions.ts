/**
 * Weekly missions: three fresh goals every week (Monday 00:00 UTC), one to fly more, one to fly
 * better and one to go somewhere new. Every mission is measured from the logbook itself, the same
 * week's completed flights, so nothing is invented. The same week always gets the same missions.
 *
 * Also: the weekly flying streak (weeks in a row with at least one completed flight).
 */
import type { FlightSummary } from "@glidepath/protocol";

export type MissionIcon = "plane" | "clock" | "feather" | "target" | "globe" | "route" | "moon" | "wind" | "link" | "layers";

export interface Mission {
  id: string;
  kind: "fly" | "skill" | "explore";
  title: string;
  /** How it's measured, in one line. */
  how: string;
  icon: MissionIcon;
  have: number;
  need: number;
  done: boolean;
  /** "1 of 3", "2.4 of 5 h"… */
  progressText: string;
}

export interface WeekMissions {
  /** "2026-W48" */
  key: string;
  start: number;
  end: number;
  missions: Mission[];
  doneCount: number;
  /** Whole days left this week (0 on the last day). */
  daysLeft: number;
  msLeft: number;
}

const H = 3_600_000, DAY = 86_400_000, WEEK = 7 * DAY;

/** Monday 00:00 UTC of the week containing t. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** ISO week key, e.g. "2026-W48". */
export function weekKey(t: number): string {
  const d = new Date(weekStart(t) + 3 * DAY); // Thursday decides the ISO year
  const y = d.getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4);
  const w = 1 + Math.round((weekStart(d.getTime()) - weekStart(jan4)) / WEEK);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** Only real, finished flights count (no replays). */
export function countedFlights(all: FlightSummary[]): FlightSummary[] {
  return all.filter((f) => f.status === "completed" && f.simulator?.source !== "replay")
    .sort((a, b) => endOf(a) - endOf(b));
}
const endOf = (f: FlightSummary) => f.endedAt ?? f.onBlockAt ?? f.wheelsDownAt ?? f.startedAt;
const blockMs = (f: FlightSummary) => (f.offBlockAt && f.onBlockAt ? f.onBlockAt - f.offBlockAt : f.wheelsUpAt && f.wheelsDownAt ? f.wheelsDownAt - f.wheelsUpAt : 0);
const fpmOf = (f: FlightSummary) => { const v = f.landings[0]?.touchdownVsFpm; return v == null || !Number.isFinite(v) ? null : Math.abs(v); };
const solarHour = (t: number, lon: number) => new Date(t + (lon / 15) * H).getUTCHours();
export const isNightLanding = (t: number, lon: number) => { const h = solarHour(t, lon); return h >= 21 || h < 5; };

/** A small, stable hash so a week always gets the same missions. */
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

type Tpl = { id: string; kind: Mission["kind"]; icon: MissionIcon; make: (r: number) => { title: string; how: string; need: number; measure: (week: FlightSummary[], before: FlightSummary[]) => number; unit?: string } };

const pick = <T,>(r: number, xs: T[]): T => xs[r % xs.length]!;

const TEMPLATES: Tpl[] = [
  // Fly more
  { id: "flights", kind: "fly", icon: "plane", make: (r) => { const n = pick(r, [2, 3, 4]); return { title: `Fly ${n} flights`, how: "Finish flights gate to gate this week.", need: n, measure: (w) => w.length }; } },
  { id: "hours", kind: "fly", icon: "clock", make: (r) => { const h = pick(r, [2, 3, 5]); return { title: `Log ${h} hours`, how: "Block time this week, off block to on block.", need: h, unit: "h", measure: (w) => Math.round((w.reduce((a, f) => a + blockMs(f), 0) / H) * 10) / 10 }; } },
  { id: "distance", kind: "fly", icon: "route", make: (r) => { const nm = pick(r, [500, 800, 1500]); return { title: `Fly ${nm.toLocaleString("en-US")} nm`, how: "Total distance flown this week.", need: nm, unit: "nm", measure: (w) => Math.round(w.reduce((a, f) => a + (f.distanceNm || 0), 0)) }; } },
  // Fly better
  { id: "soft", kind: "skill", icon: "feather", make: (r) => { const fpm = pick(r, [120, 150, 200]); return { title: `Land softer than ${fpm} fpm`, how: `One touchdown under ${fpm} fpm this week.`, need: 1, measure: (w) => (w.some((f) => (fpmOf(f) ?? 999) < fpm) ? 1 : 0) }; } },
  { id: "grade", kind: "skill", icon: "target", make: () => ({ title: "Score an A landing", how: "A landing score of 88 or more this week.", need: 1, measure: (w) => (w.some((f) => (f.landings[0]?.score ?? 0) >= 88) ? 1 : 0) }) },
  { id: "consistent", kind: "skill", icon: "layers", make: () => ({ title: "Two smooth landings", how: "Two landings under 250 fpm this week.", need: 2, measure: (w) => w.filter((f) => (fpmOf(f) ?? 999) < 250).length }) },
  { id: "crosswind", kind: "skill", icon: "wind", make: () => ({ title: "Tame a crosswind", how: "Land under 400 fpm with 10 kt or more of crosswind.", need: 1, measure: (w) => (w.some((f) => Math.abs(f.landings[0]?.crosswindKt ?? 0) >= 10 && (fpmOf(f) ?? 999) < 400) ? 1 : 0) }) },
  // Go somewhere new
  { id: "newapt", kind: "explore", icon: "globe", make: () => ({ title: "Land somewhere new", how: "Land at an airport you've never landed at before.", need: 1, measure: (w, before) => { const seen = new Set(before.map((f) => f.arrivalIcao).filter(Boolean)); return w.some((f) => f.arrivalIcao && !seen.has(f.arrivalIcao)) ? 1 : 0; } }) },
  { id: "long", kind: "explore", icon: "route", make: (r) => { const nm = pick(r, [300, 600, 1000]); return { title: `One flight over ${nm.toLocaleString("en-US")} nm`, how: `A single flight of ${nm.toLocaleString("en-US")} nm or more.`, need: 1, measure: (w) => (w.some((f) => f.distanceNm >= nm) ? 1 : 0) }; } },
  { id: "night", kind: "explore", icon: "moon", make: () => ({ title: "Land at night", how: "Touch down between 9 pm and 5 am local time.", need: 1, measure: (w) => (w.some((f) => { const l = f.landings[0]; return !!l && isNightLanding(l.t, l.lon); }) ? 1 : 0) }) },
  { id: "types", kind: "explore", icon: "plane", make: () => ({ title: "Fly two different aircraft", how: "Two different aircraft types this week.", need: 2, measure: (w) => new Set(w.map((f) => f.aircraft?.icaoType ?? f.aircraft?.title).filter(Boolean)).size }) },
  { id: "chain", kind: "explore", icon: "link", make: () => ({ title: "Pick up where you landed", how: "Start a flight from the airport your last flight landed at.", need: 1, measure: (w, before) => { const all = [...before.slice(-1), ...w]; for (let i = 1; i < all.length; i++) if (all[i]!.departureIcao && all[i]!.departureIcao === all[i - 1]!.arrivalIcao && w.includes(all[i]!)) return 1; return 0; } }) },
];

/** This week's three missions and how far along each one is. */
export function weekMissions(all: FlightSummary[], now = Date.now()): WeekMissions {
  const start = weekStart(now), end = start + WEEK, key = weekKey(now);
  const flights = countedFlights(all);
  const week = flights.filter((f) => endOf(f) >= start && endOf(f) < end);
  const before = flights.filter((f) => endOf(f) < start);
  const h = hash(key);
  const missions: Mission[] = (["fly", "skill", "explore"] as const).map((kind, i) => {
    const pool = TEMPLATES.filter((t) => t.kind === kind);
    const t = pool[(h >>> (i * 4)) % pool.length]!;
    const m = t.make(h >>> (i * 3 + 7));
    const have = m.measure(week, before);
    const fmtN = (n: number) => (m.unit === "h" ? n.toFixed(1).replace(/\.0$/, "") : n.toLocaleString("en-US"));
    return { id: `${key}:${t.id}`, kind, title: m.title, how: m.how, icon: t.icon, have, need: m.need, done: have >= m.need,
      progressText: m.need === 1 ? (have >= 1 ? "Done" : "Not yet") : `${fmtN(Math.min(have, m.need))} of ${fmtN(m.need)}${m.unit ? ` ${m.unit}` : ""}` };
  });
  const msLeft = Math.max(0, end - now);
  return { key, start, end, missions, doneCount: missions.filter((m) => m.done).length, daysLeft: Math.floor(msLeft / DAY), msLeft };
}

export interface Streak {
  /** Weeks in a row with at least one completed flight, counting this week if you've flown. */
  weeks: number;
  flownThisWeek: boolean;
  best: number;
  /** Total missions completed across all weeks so far. */
  missionsDone: number;
  /** The last 12 weeks, oldest first: how many missions were done each week. */
  history: Array<{ key: string; start: number; flights: number; missions: number }>;
}

export function flyingStreak(all: FlightSummary[], now = Date.now()): Streak {
  const flights = countedFlights(all);
  const thisWeek = weekStart(now);
  const weeks = new Set(flights.map((f) => weekStart(endOf(f))));
  const flownThisWeek = weeks.has(thisWeek);
  // Count back from this week (or last week, if you haven't flown yet this week: the streak isn't broken until the week ends).
  let w = flownThisWeek ? thisWeek : thisWeek - WEEK, n = 0;
  while (weeks.has(w)) { n++; w -= WEEK; }
  // Best ever
  const sorted = [...weeks].sort((a, b) => a - b);
  let best = 0, run = 0, prev = -Infinity;
  for (const s of sorted) { run = s - prev === WEEK ? run + 1 : 1; best = Math.max(best, run); prev = s; }
  const history: Streak["history"] = [];
  let missionsDone = 0;
  const first = sorted[0];
  const from = Math.min(first ?? thisWeek, thisWeek - 11 * WEEK);
  for (let s = from; s <= thisWeek; s += WEEK) {
    const fl = flights.filter((f) => weekStart(endOf(f)) === s).length;
    const m = fl ? weekMissions(all, s + 3 * DAY).doneCount : 0;
    missionsDone += m;
    if (s > thisWeek - 12 * WEEK) history.push({ key: weekKey(s), start: s, flights: fl, missions: m });
  }
  return { weeks: n, flownThisWeek, best: Math.max(best, n), missionsDone, history };
}
