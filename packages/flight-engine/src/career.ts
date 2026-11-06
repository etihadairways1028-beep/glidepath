/**
 * Career totals from a list of flights: hours, landings, records, months.
 * Used by the Logbook screen and the monthly email, so the numbers match.
 * Only completed flights count towards totals.
 */
import type { FlightSummary } from "@glidepath/protocol";
import { touchdownWords } from "./review.js";

export interface CareerStats {
  flights: number;
  blockMs: number;
  airMs: number;
  distanceNm: number;
  fuelBurnedKg: number;
  landings: number;
  avgFpm: number | null;
  softestFpm: number | null;
  firmestFpm: number | null;
  avgScore: number | null;
  /** How many landings fell in each word band, e.g. { Smooth: 4, Firm: 1 }. */
  words: Record<string, number>;
  avgRotationDegS: number | null;
  airports: number;
  aircraftTypes: number;
  topAirports: Array<{ icao: string; visits: number }>;
  topAircraft: Array<{ type: string; flights: number; blockMs: number }>;
  longest: { id: string; blockMs: number; from: string | null; to: string | null } | null;
  furthest: { id: string; nm: number; from: string | null; to: string | null } | null;
  bestLanding: { id: string; fpm: number | null; score: number; grade: string; at: string | null } | null;
  /** Block hours by calendar month (UTC), oldest first, `months` entries ending with the month of `now`. */
  byMonth: Array<{ key: string; label: string; flights: number; blockMs: number }>;
}

export const WORD_ORDER = ["Very soft", "Smooth", "Normal", "Firm", "Heavy", "Hard"] as const;

const blockOf = (f: FlightSummary) => (f.onBlockAt && f.offBlockAt ? Math.max(0, f.onBlockAt - f.offBlockAt) : 0);
const airOf = (f: FlightSummary) => (f.wheelsDownAt && f.wheelsUpAt ? Math.max(0, f.wheelsDownAt - f.wheelsUpAt) : 0);
const monthKey = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

export function careerStats(all: FlightSummary[], opts: { now?: number; months?: number } = {}): CareerStats {
  const now = opts.now ?? Date.now();
  const nMonths = opts.months ?? 12;
  const done = all.filter((f) => f.status === "completed");
  const landings = done.flatMap((f) => f.landings.map((l) => ({ f, l })));
  const fpms = landings.map(({ l }) => l.touchdownVsFpm).filter((v): v is number => v !== null && Number.isFinite(v)).map((v) => Math.abs(v));
  const words: Record<string, number> = {};
  for (const v of fpms) { const w = touchdownWords(v).word; words[w] = (words[w] ?? 0) + 1; }
  const rot = done.map((f) => f.takeoff?.rotationRateDegS ?? null).filter((v): v is number => v !== null);

  const visits = new Map<string, number>();
  for (const f of done) for (const a of [f.departureIcao, f.arrivalIcao]) if (a) visits.set(a, (visits.get(a) ?? 0) + 1);
  const types = new Map<string, { flights: number; blockMs: number }>();
  for (const f of done) {
    const t = f.aircraft?.icaoType ?? f.plan?.aircraftIcao ?? f.aircraft?.title ?? null;
    if (!t) continue;
    const e = types.get(t) ?? { flights: 0, blockMs: 0 };
    e.flights++; e.blockMs += blockOf(f);
    types.set(t, e);
  }

  const longestF = [...done].sort((a, b) => blockOf(b) - blockOf(a))[0];
  const furthestF = [...done].sort((a, b) => b.distanceNm - a.distanceNm)[0];
  const best = [...landings].sort((a, b) => b.l.score - a.l.score || Math.abs(a.l.touchdownVsFpm ?? 1e9) - Math.abs(b.l.touchdownVsFpm ?? 1e9))[0];

  const byMonth: CareerStats["byMonth"] = [];
  const d0 = new Date(now);
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1));
    const key = monthKey(d.getTime());
    byMonth.push({ key, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), flights: 0, blockMs: 0 });
  }
  const idx = new Map(byMonth.map((m, i) => [m.key, i]));
  for (const f of done) {
    const i = idx.get(monthKey(f.offBlockAt ?? f.startedAt));
    if (i !== undefined) { byMonth[i]!.flights++; byMonth[i]!.blockMs += blockOf(f); }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgFpm = avg(fpms);
  const avgScore = avg(landings.map(({ l }) => l.score));
  const avgRot = avg(rot);
  return {
    flights: done.length,
    blockMs: done.reduce((s, f) => s + blockOf(f), 0),
    airMs: done.reduce((s, f) => s + airOf(f), 0),
    distanceNm: Math.round(done.reduce((s, f) => s + f.distanceNm, 0)),
    fuelBurnedKg: Math.round(done.reduce((s, f) => s + (f.fuelStartKg !== null && f.fuelEndKg !== null ? Math.max(0, f.fuelStartKg - f.fuelEndKg) : 0), 0)),
    landings: landings.length,
    avgFpm: avgFpm === null ? null : Math.round(avgFpm),
    softestFpm: fpms.length ? Math.round(Math.min(...fpms)) : null,
    firmestFpm: fpms.length ? Math.round(Math.max(...fpms)) : null,
    avgScore: avgScore === null ? null : Math.round(avgScore),
    words,
    avgRotationDegS: avgRot === null ? null : Math.round(avgRot * 10) / 10,
    airports: visits.size,
    aircraftTypes: types.size,
    topAirports: [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([icao, v]) => ({ icao, visits: v })),
    topAircraft: [...types.entries()].sort((a, b) => b[1].blockMs - a[1].blockMs || b[1].flights - a[1].flights).slice(0, 5).map(([type, e]) => ({ type, ...e })),
    longest: longestF && blockOf(longestF) > 0 ? { id: longestF.id, blockMs: blockOf(longestF), from: longestF.departureIcao, to: longestF.arrivalIcao } : null,
    furthest: furthestF ? { id: furthestF.id, nm: Math.round(furthestF.distanceNm), from: furthestF.departureIcao, to: furthestF.arrivalIcao } : null,
    bestLanding: best ? { id: best.f.id, fpm: best.l.touchdownVsFpm === null ? null : Math.round(Math.abs(best.l.touchdownVsFpm)), score: best.l.score, grade: best.l.grade, at: best.f.arrivalIcao } : null,
    byMonth,
  };
}

/** Flights whose off-block time falls in the given UTC month (year, month 1–12). */
export function flightsInMonth(all: FlightSummary[], year: number, month: number): FlightSummary[] {
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  return all.filter((f) => { const t = f.offBlockAt ?? f.startedAt; return t >= start && t < end; });
}

/** "7h 05m" style hours. */
export function hoursText(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
