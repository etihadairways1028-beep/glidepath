/**
 * Badges: milestones earned from saved flights. Every badge is computed from
 * the logbook itself (nothing is invented), and each one says how to earn it,
 * with progress towards the next step where it has steps.
 */
import type { FlightSummary } from "@glidepath/protocol";

export interface Badge {
  id: string;
  title: string;
  /** How to earn it, in one line. */
  how: string;
  icon: "plane" | "feather" | "globe" | "clock" | "moon" | "star" | "target" | "wind" | "route";
  earned: boolean;
  /** When it was earned (the flight that earned it), if known. */
  earnedAt: number | null;
  /** 0..1 progress for stepped badges that aren't earned yet. */
  progress: number | null;
  progressText: string | null;
}

const blockMs = (f: FlightSummary) => (f.offBlockAt && f.onBlockAt ? f.onBlockAt - f.offBlockAt : f.wheelsUpAt && f.wheelsDownAt ? f.wheelsDownAt - f.wheelsUpAt : 0);
const fpmOf = (f: FlightSummary) => {
  const v = f.landings[0]?.touchdownVsFpm;
  return v === null || v === undefined || !Number.isFinite(v) ? null : Math.abs(v);
};
const H = 3_600_000;

/** Local hour (0-23) at a point in time, using longitude for a rough solar time. */
function solarHour(t: number, lon: number): number {
  const d = new Date(t + (lon / 15) * H);
  return d.getUTCHours();
}

export function computeBadges(all: FlightSummary[]): Badge[] {
  const done = all.filter((f) => f.status === "completed").sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt));
  const at = (f: FlightSummary | undefined) => (f ? f.endedAt ?? f.onBlockAt ?? f.startedAt : null);
  const firstWhere = (p: (f: FlightSummary) => boolean) => done.find(p);

  const out: Badge[] = [];
  const add = (b: Omit<Badge, "earned" | "earnedAt" | "progress" | "progressText"> & { by?: FlightSummary; progress?: [number, number] | null }) => {
    const earned = !!b.by;
    const [have, need] = b.progress ?? [0, 0];
    out.push({
      id: b.id, title: b.title, how: b.how, icon: b.icon, earned, earnedAt: at(b.by),
      progress: !earned && b.progress ? Math.min(1, have / need) : null,
      progressText: !earned && b.progress ? `${Math.min(have, need)} of ${need}` : null,
    });
  };

  add({ id: "first", title: "First flight", how: "Finish a flight, gate to gate.", icon: "plane", by: done[0] });

  for (const n of [10, 50, 100]) add({ id: `flights${n}`, title: `${n} flights`, how: `Finish ${n} flights.`, icon: "route", by: done[n - 1], progress: [done.length, n] });

  const butter = firstWhere((f) => (fpmOf(f) ?? 999) < 100);
  add({ id: "butter", title: "Butter", how: "Touch down softer than 100 fpm.", icon: "feather", by: butter });

  // Five landings in a row under 200 fpm.
  let streak = 0, best = 0; let streakBy: FlightSummary | undefined;
  for (const f of done) {
    const v = fpmOf(f);
    if (v === null) continue;
    streak = v < 200 ? streak + 1 : 0;
    best = Math.max(best, streak);
    if (streak >= 5 && !streakBy) streakBy = f;
  }
  add({ id: "smooth5", title: "Smooth operator", how: "Five landings in a row under 200 fpm.", icon: "star", by: streakBy, progress: [best, 5] });

  const ace = firstWhere((f) => (f.landings[0]?.score ?? 0) >= 95);
  add({ id: "aplus", title: "A+ landing", how: "Score 95 or more on a landing.", icon: "target", by: ace });

  const long = firstWhere((f) => blockMs(f) >= 6 * H);
  const longest = Math.max(0, ...done.map(blockMs));
  add({ id: "longhaul", title: "Long haul", how: "Fly a flight of 6 hours or more, block to block.", icon: "clock", by: long, progress: [Math.round((longest / H) * 10) / 10, 6] });

  const ultra = firstWhere((f) => f.distanceNm >= 5000);
  add({ id: "ultra", title: "Ultra long range", how: "Fly 5,000 nm in one flight.", icon: "globe", by: ultra, progress: [Math.round(Math.max(0, ...done.map((f) => f.distanceNm))), 5000] });

  const airports: string[] = [];
  let airportsBy: Record<number, FlightSummary> = {};
  for (const f of done) for (const a of [f.departureIcao, f.arrivalIcao]) if (a && !airports.includes(a)) { airports.push(a); airportsBy[airports.length] = f; }
  for (const n of [10, 25]) add({ id: `airports${n}`, title: `${n} airports`, how: `Visit ${n} different airports.`, icon: "globe", by: airportsBy[n], progress: [airports.length, n] });

  const night = firstWhere((f) => {
    const l = f.landings[0];
    if (!l) return false;
    const h = solarHour(l.t, l.lon);
    return h >= 21 || h < 5;
  });
  add({ id: "night", title: "Night landing", how: "Land between 9 pm and 5 am local time at the airport.", icon: "moon", by: night });

  const xwind = firstWhere((f) => Math.abs(f.landings[0]?.crosswindKt ?? 0) >= 15 && (fpmOf(f) ?? 999) < 400);
  add({ id: "crosswind", title: "Crosswind pro", how: "Land safely (under 400 fpm) with 15 kt or more of crosswind.", icon: "wind", by: xwind });

  const continents = new Set<string>();
  let continentsBy: FlightSummary | undefined;
  for (const f of done) {
    for (const a of [f.departureIcao, f.arrivalIcao]) if (a) continents.add(regionOf(a));
    if (continents.size >= 3 && !continentsBy) continentsBy = f;
  }
  continents.delete("?");
  add({ id: "regions3", title: "World traveller", how: "Fly to airports in 3 different world regions.", icon: "globe", by: continentsBy, progress: [continents.size, 3] });

  return out;
}

/** World region from the first letter of the ICAO code (ICAO's own regions). */
export function regionOf(icao: string): string {
  const c = icao.trim().toUpperCase()[0] ?? "?";
  if ("KCP".includes(c)) return "North America";
  if ("MT".includes(c)) return "Central America and Caribbean";
  if ("S".includes(c)) return "South America";
  if ("EL".includes(c)) return "Europe";
  if ("U".includes(c)) return "Russia and Central Asia";
  if ("O".includes(c)) return "Middle East";
  if ("V".includes(c)) return "South Asia";
  if ("RZ".includes(c)) return "East Asia";
  if ("W".includes(c)) return "South-East Asia";
  if ("Y".includes(c) || c === "N") return "Oceania";
  if ("DFGH".includes(c)) return "Africa";
  if (c === "B") return "Arctic";
  return "?";
}
