/**
 * Career mode: a pilot rank that grows with your hours, type ratings earned by
 * flying an aircraft, where you are now (where your last flight ended), a
 * streak for flights that start where the last one finished, and "fly this
 * next" suggestions from there. All worked out from your saved flights.
 */
import type { FlightSummary } from "@glidepath/protocol";

export interface Rank { title: string; minHours: number; stripes: number }
export const RANKS: Rank[] = [
  { title: "Student Pilot", minHours: 0, stripes: 0 },
  { title: "Cadet", minHours: 5, stripes: 1 },
  { title: "Second Officer", minHours: 20, stripes: 2 },
  { title: "First Officer", minHours: 50, stripes: 2 },
  { title: "Senior First Officer", minHours: 120, stripes: 3 },
  { title: "Captain", minHours: 250, stripes: 4 },
  { title: "Senior Captain", minHours: 500, stripes: 4 },
  { title: "Training Captain", minHours: 1000, stripes: 4 },
  { title: "Chief Pilot", minHours: 2000, stripes: 4 },
];

export type AircraftClass = "heavy" | "jet" | "regional" | "turboprop" | "ga";
const HEAVY = /^(A3[3-5]\d|A38\d|A34\d|B74\d|B77\w|B78\w|B76\d|MD11|IL96|A30\d|A31\d|DC10|C5|C17)$/;
const JET = /^(A31[89]|A32\w|A2[01]N|B73\w|B38M|B39M|B37M|B3XM|B75\d|BCS\d|A22\d|MD8\d|MD9\d|B712|C919)$/;
const REGIONAL = /^(E1[3-9]\d|E2\d{2}|E75\w|E70|E90|E95|CRJ\d|CRJX|RJ\d+|F70|F100|BA46|SU95|ARJ21)$/;
const TURBOPROP = /^(AT[4-7]\d|AT\d\w|DH8\w|Q400|DHC\d|SF34|JS41|B190|C208|PC12|PC24|TBM\w|KODI|BE20|BE35|DO28|L410)$/;

export function aircraftClass(icao: string | null | undefined): AircraftClass {
  const t = (icao ?? "").toUpperCase().trim();
  if (HEAVY.test(t)) return "heavy";
  if (JET.test(t)) return "jet";
  if (REGIONAL.test(t)) return "regional";
  if (TURBOPROP.test(t)) return "turboprop";
  return "ga";
}

/** Typical cruise speed (kt) and the distance bands (nm) that make sense for each class. */
export const CLASS_INFO: Record<AircraftClass, { label: string; cruiseKt: number; bands: Array<{ label: string; min: number; max: number }> }> = {
  heavy: { label: "Wide-body", cruiseKt: 485, bands: [{ label: "Medium haul", min: 1200, max: 2600 }, { label: "Long haul", min: 2600, max: 5200 }, { label: "Ultra long haul", min: 5200, max: 7600 }] },
  jet: { label: "Narrow-body jet", cruiseKt: 450, bands: [{ label: "Short hop", min: 120, max: 400 }, { label: "Medium", min: 400, max: 1100 }, { label: "Long", min: 1100, max: 2600 }] },
  regional: { label: "Regional jet", cruiseKt: 420, bands: [{ label: "Short hop", min: 100, max: 300 }, { label: "Medium", min: 300, max: 700 }, { label: "Long", min: 700, max: 1300 }] },
  turboprop: { label: "Turboprop", cruiseKt: 270, bands: [{ label: "Short hop", min: 50, max: 180 }, { label: "Medium", min: 180, max: 400 }, { label: "Long", min: 400, max: 800 }] },
  ga: { label: "Light aircraft", cruiseKt: 115, bands: [{ label: "Local hop", min: 15, max: 60 }, { label: "Cross-country", min: 60, max: 160 }, { label: "Long trip", min: 160, max: 350 }] },
};

export interface TypeRating { type: string; flights: number; hours: number; rated: boolean; progress: number }
export interface Career {
  hours: number;
  flights: number;
  rank: Rank;
  next: Rank | null;
  /** 0–1 towards the next rank. */
  progress: number;
  location: string | null;
  lastType: string | null;
  streak: number;
  bestStreak: number;
  ratings: TypeRating[];
}

const blockMs = (f: FlightSummary) => Math.max(0, (f.onBlockAt ?? f.endedAt ?? 0) - (f.offBlockAt ?? f.startedAt ?? 0));
const typeOf = (f: FlightSummary) => (f.aircraft?.icaoType ?? f.plan?.aircraftIcao ?? null)?.toUpperCase() ?? null;

/** Rated on a type after 3 flights or 5 hours in it. */
export const RATING_FLIGHTS = 3, RATING_HOURS = 5;

export function pilotCareer(all: FlightSummary[]): Career {
  const done = all
    .filter((f) => f.status === "completed" && f.simulator?.source !== "replay")
    .sort((a, b) => (a.offBlockAt ?? a.startedAt) - (b.offBlockAt ?? b.startedAt));
  const hours = done.reduce((s, f) => s + blockMs(f), 0) / 3_600_000;
  let rank = RANKS[0]!;
  for (const r of RANKS) if (hours >= r.minHours) rank = r;
  const next = RANKS[RANKS.indexOf(rank) + 1] ?? null;
  const progress = next ? Math.min(1, (hours - rank.minHours) / (next.minHours - rank.minHours)) : 1;

  let streak = 0, best = 0, prevArr: string | null = null;
  for (const f of done) {
    if (prevArr && f.departureIcao && f.departureIcao === prevArr) streak++;
    else streak = f.departureIcao ? 1 : 0;
    best = Math.max(best, streak);
    prevArr = f.arrivalIcao ?? null;
  }

  const types = new Map<string, { flights: number; ms: number }>();
  for (const f of done) {
    const t = typeOf(f); if (!t) continue;
    const e = types.get(t) ?? { flights: 0, ms: 0 };
    e.flights++; e.ms += blockMs(f); types.set(t, e);
  }
  const ratings = [...types.entries()].map(([type, e]) => {
    const h = e.ms / 3_600_000;
    const rated = e.flights >= RATING_FLIGHTS || h >= RATING_HOURS;
    return { type, flights: e.flights, hours: Math.round(h * 10) / 10, rated, progress: rated ? 1 : Math.max(e.flights / RATING_FLIGHTS, h / RATING_HOURS) };
  }).sort((a, b) => Number(b.rated) - Number(a.rated) || b.hours - a.hours);

  const last = done.at(-1);
  return { hours: Math.round(hours * 10) / 10, flights: done.length, rank, next, progress, location: last?.arrivalIcao ?? null, lastType: last ? typeOf(last) : null, streak, bestStreak: best, ratings };
}

export interface Place { code: string; name: string; city: string; country: string; lat: number; lon: number; size: "large" | "medium" | "small" }
export interface Suggestion { to: Place; distanceNm: number; band: string; minutes: number }

function nm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(h));
}

/** A small deterministic shuffle so suggestions change each day but not on every screen refresh. */
function seeded(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/**
 * Up to `perBand` destinations in each distance band for the aircraft class,
 * from big enough airports, avoiding places flown to recently.
 */
export function suggestFlights(from: Place, airports: Place[], cls: AircraftClass, opts: { day?: number; recent?: string[]; perBand?: number } = {}): Suggestion[] {
  const info = CLASS_INFO[cls];
  const sizes = cls === "heavy" || cls === "jet" ? ["large"] : cls === "regional" ? ["large", "medium"] : ["large", "medium", "small"];
  const recent = new Set((opts.recent ?? []).map((c) => c.toUpperCase()));
  const rnd = seeded((opts.day ?? Math.floor(Date.now() / 86_400_000)) * 7919 + [...from.code].reduce((s, c) => s + c.charCodeAt(0), 0));
  const out: Suggestion[] = [];
  for (const band of info.bands) {
    const pool = airports.filter((a) => a.code !== from.code && sizes.includes(a.size) && !recent.has(a.code)).map((a) => ({ a, d: nm(from, a) })).filter((x) => x.d >= band.min && x.d <= band.max);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    // Prefer different countries for variety.
    const seen = new Set<string>();
    const picks = [...pool.filter((x) => (seen.has(x.a.country) ? false : (seen.add(x.a.country), true))), ...pool].slice(0, opts.perBand ?? 2);
    const uniq = new Map(picks.map((x) => [x.a.code, x]));
    for (const { a, d } of uniq.values()) out.push({ to: a, distanceNm: Math.round(d), band: band.label, minutes: Math.round((d / info.cruiseKt) * 60 + 25) });
  }
  return out;
}

/** SimBrief's "new flight" form, filled in. Free SimBrief account needed. */
export function simbriefLink(from: string, to: string, type?: string | null): string {
  const q = new URLSearchParams({ orig: from, dest: to });
  if (type) q.set("type", type);
  return `https://dispatch.simbrief.com/options/custom?${q.toString()}`;
}
