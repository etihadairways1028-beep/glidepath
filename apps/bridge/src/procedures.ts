/**
 * Departure, arrival and approach procedures for an airport, read from the
 * simulator's own navigation data (SimConnect facility data, MSFS 2020/2024).
 * Free, and it matches whatever navdata the sim has installed (including
 * Navigraph's, if the pilot has it in the sim).
 *
 * This file only turns the sim's records into lists; the MSFS adapter asks
 * for them. Records arrive one per item, each with its own id and its
 * parent's id, so the structure is rebuilt from those ids, not from order.
 */

/** SimConnect FacilityDataType values used here. */
export const FT = { AIRPORT: 0, RUNWAY: 1, APPROACH: 5, APPROACH_TRANSITION: 6, DEPARTURE: 10, ARRIVAL: 11, RUNWAY_TRANSITION: 12, ENROUTE_TRANSITION: 13 } as const;

/** The facility definition, field by field (the reader below reads them in this order). */
export const PROCEDURE_DEFINITION = [
  "OPEN AIRPORT", "N_RUNWAYS",
  "OPEN RUNWAY", "PRIMARY_NUMBER", "PRIMARY_DESIGNATOR", "SECONDARY_NUMBER", "SECONDARY_DESIGNATOR", "CLOSE RUNWAY",
  "OPEN DEPARTURE", "NAME",
  "OPEN RUNWAY_TRANSITION", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR", "CLOSE RUNWAY_TRANSITION",
  "OPEN ENROUTE_TRANSITION", "NAME", "CLOSE ENROUTE_TRANSITION",
  "CLOSE DEPARTURE",
  "OPEN ARRIVAL", "NAME",
  "OPEN RUNWAY_TRANSITION", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR", "CLOSE RUNWAY_TRANSITION",
  "OPEN ENROUTE_TRANSITION", "NAME", "CLOSE ENROUTE_TRANSITION",
  "CLOSE ARRIVAL",
  "OPEN APPROACH", "TYPE", "SUFFIX", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR",
  "OPEN APPROACH_TRANSITION", "IAF_ICAO", "CLOSE APPROACH_TRANSITION",
  "CLOSE APPROACH",
  "CLOSE AIRPORT",
];

export interface Procedure { name: string; /** Runways it serves; empty = all. */ runways: string[]; transitions: string[] }
export interface Approach { name: string; type: string; runway: string; transitions: string[] }
export interface AirportProcedures { icao: string; source: "msfs"; runways: string[]; departures: Procedure[]; arrivals: Procedure[]; approaches: Approach[] }

export interface Reader { readInt32(): number; readString8(): string }
export interface FacilityRecord { type: number; id: number; parent: number; data: Reader }

const DESIG = ["", "L", "R", "C", "W", "A", "B"];
const COMPASS: Record<number, string> = { 37: "N", 38: "NE", 39: "E", 40: "SE", 41: "S", 42: "SW", 43: "W", 44: "NW" };
const APPROACH_TYPE: Record<number, string> = { 1: "GPS", 2: "VOR", 3: "NDB", 4: "ILS", 5: "LOC", 6: "SDF", 7: "LDA", 8: "VOR/DME", 9: "NDB/DME", 10: "RNAV", 11: "LOC BC" };

export function runwayName(num: number, des: number): string {
  if (!num) return "";
  const n = COMPASS[num] ?? (num >= 1 && num <= 36 ? String(num).padStart(2, "0") : "");
  return n ? n + (DESIG[des] ?? "") : "";
}

const clean = (s: string) => s.replace(/\0.*$/s, "").trim().toUpperCase();
const okName = (s: string) => /^[A-Z0-9]{1,8}$/.test(s);

/** Builds the lists from the records of one request. Throws if what came back doesn't look like procedures. */
export function collectProcedures(icao: string, records: FacilityRecord[]): AirportProcedures {
  const runways = new Set<string>();
  const procs = new Map<number, { kind: "dep" | "arr"; p: Procedure }>();
  const apps = new Map<number, Approach>();
  const kids: FacilityRecord[] = [];
  let bad = 0;
  for (const r of records) {
    if (r.type === FT.RUNWAY) {
      const a = runwayName(r.data.readInt32(), r.data.readInt32()), b = runwayName(r.data.readInt32(), r.data.readInt32());
      if (a) runways.add(a); if (b) runways.add(b);
    } else if (r.type === FT.DEPARTURE || r.type === FT.ARRIVAL) {
      const name = clean(r.data.readString8());
      if (!okName(name)) { bad++; continue; }
      procs.set(r.id, { kind: r.type === FT.DEPARTURE ? "dep" : "arr", p: { name, runways: [], transitions: [] } });
    } else if (r.type === FT.APPROACH) {
      const type = APPROACH_TYPE[r.data.readInt32()] ?? "APP";
      const suffix = r.data.readInt32();
      const rw = runwayName(r.data.readInt32(), r.data.readInt32());
      const sfx = suffix >= 65 && suffix <= 90 ? ` ${String.fromCharCode(suffix)}` : "";
      apps.set(r.id, { name: `${type === "GPS" ? "RNAV" : type}${sfx}${rw ? ` ${rw}` : ""}`, type, runway: rw, transitions: [] });
    } else if (r.type === FT.RUNWAY_TRANSITION || r.type === FT.ENROUTE_TRANSITION || r.type === FT.APPROACH_TRANSITION) {
      kids.push(r);
    }
  }
  for (const r of kids) {
    if (r.type === FT.APPROACH_TRANSITION) {
      const a = apps.get(r.parent);
      const name = clean(r.data.readString8());
      if (a && okName(name) && !a.transitions.includes(name)) a.transitions.push(name);
      continue;
    }
    const pr = procs.get(r.parent);
    if (!pr) continue;
    if (r.type === FT.RUNWAY_TRANSITION) {
      const rw = runwayName(r.data.readInt32(), r.data.readInt32());
      if (rw && !pr.p.runways.includes(rw)) pr.p.runways.push(rw);
    } else {
      const name = clean(r.data.readString8());
      if (okName(name) && !pr.p.transitions.includes(name)) pr.p.transitions.push(name);
    }
  }
  const total = procs.size + apps.size;
  if (bad > 0 && bad >= total) throw new Error("The simulator's procedure data didn't read correctly.");
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const list = [...procs.values()];
  return {
    icao: icao.toUpperCase(), source: "msfs",
    runways: [...runways].sort(),
    departures: list.filter((x) => x.kind === "dep").map((x) => x.p).sort(byName),
    arrivals: list.filter((x) => x.kind === "arr").map((x) => x.p).sort(byName),
    approaches: [...apps.values()].sort((a, b) => a.runway.localeCompare(b.runway) || a.name.localeCompare(b.name)),
  };
}

/* ---------------- Approach paths (where to fly, fix by fix, to the runway) ---------------- */

export const FT_LEG = { APPROACH_LEG: 7, FINAL_APPROACH_LEG: 8, MISSED_APPROACH_LEG: 9 } as const;

/** Every leg is read with these fields, in this order (see readLeg). */
export const LEG_FIELDS = ["TYPE", "FIX_ICAO", "FIX_LATITUDE", "FIX_LONGITUDE", "ALTITUDE1", "ALTITUDE2", "COURSE", "TURN_DIRECTION", "ROUTE_DISTANCE", "DISTANCE_MINUTE", "TRUE_DEGREE", "SPEED_LIMIT", "APPROACH_ALT_DESC", "FLY_OVER", "VERTICAL_ANGLE", "IS_IAF", "IS_IF", "IS_FAF", "IS_MAP"];

/** A separate, optional request: if the sim refuses it, the procedure lists above still work. */
export const APPROACH_PATH_DEFINITION = [
  "OPEN AIRPORT",
  "OPEN APPROACH", "TYPE", "SUFFIX", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR",
  "OPEN APPROACH_TRANSITION", "IAF_ICAO",
  "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG",
  "CLOSE APPROACH_TRANSITION",
  "OPEN FINAL_APPROACH_LEG", ...LEG_FIELDS, "CLOSE FINAL_APPROACH_LEG",
  "OPEN MISSED_APPROACH_LEG", ...LEG_FIELDS, "CLOSE MISSED_APPROACH_LEG",
  "CLOSE APPROACH",
  "CLOSE AIRPORT",
];

export interface PathFix {
  ident: string; lat: number; lon: number;
  /** Altitude restriction, feet (none = null); alt2Ft is the second value of a window. */
  altFt: number | null; alt2Ft?: number | null;
  /** How to read the restriction: at, at or above, at or below, between. */
  altDesc?: "at" | "above" | "below" | "between" | null;
  speedKt?: number | null;
  /** Course into this fix and the leg's length, as published (course is magnetic unless trueCourse). */
  courseDeg?: number | null; trueCourse?: boolean; distNm?: number | null;
  flyOver?: boolean; role?: "IAF" | "IF" | "FAF" | "MAP" | null; vAngle?: number | null;
}
/** A published holding pattern (ARINC 424 HA/HF/HM leg) at a fix. */
export interface PubHold { ident: string; lat: number; lon: number; /** Inbound course, degrees; magnetic unless `trueCourse`. */ courseDeg: number; trueCourse: boolean; right: boolean;
  /** Leg length: nautical miles, or minutes when `legMin` is set. */ legNm: number | null; legMin: number | null; altFt: number | null; alt2Ft: number | null; speedKt: number | null; from: "approach" | "missed" }
export interface ApproachPath { name: string; runway: string; final: PathFix[]; transitions: Array<{ name: string; legs: PathFix[] }>; missed: PathFix[]; holds: PubHold[] }
export interface PathReader extends Reader { readFloat64(): number; readFloat32(): number }
export interface PathRecord { type: number; id: number; parent: number; data: PathReader }

const HOLD_TYPES = new Set([12, 13, 14]); // HA, HF, HM
const ft = (m: number) => (Number.isFinite(m) && m > 1 ? Math.round((m * 3.28084) / 10) * 10 : null);
interface Leg { fix: PathFix | null; hold: Omit<PubHold, "from"> | null }
/** Reads one leg in the order of APPROACH_PATH_DEFINITION. Legs without a fixed point (CA, VA, VM, FM…) have nothing to draw. */
function readLeg(r: PathReader): Leg {
  const type = r.readInt32();
  const ident = clean(r.readString8());
  const lat = r.readFloat64(), lon = r.readFloat64();
  const alt1 = r.readFloat32(), alt2 = r.readFloat32(), course = r.readFloat32();
  const turn = r.readInt32(), dist = r.readFloat32(), minutes = r.readInt32(), trueDeg = r.readInt32(), speed = r.readFloat32();
  const desc = r.readInt32(), flyOver = r.readInt32(), vAngle = r.readFloat32(), iaf = r.readInt32(), iff = r.readInt32(), faf = r.readInt32(), map = r.readInt32();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return { fix: null, hold: null };
  const legNmVal = !minutes && dist > 0 ? (dist > 100 ? dist / 1852 : dist) : null;
  const fix: PathFix = {
    ident: ident || "·", lat, lon, altFt: ft(alt1), alt2Ft: desc === 4 ? ft(alt2) : null,
    altDesc: ft(alt1) === null ? null : ({ 1: "at", 2: "above", 3: "below", 4: "between" } as Record<number, PathFix["altDesc"]>)[desc] ?? "at",
    speedKt: Number.isFinite(speed) && speed > 60 && speed < 400 ? Math.round(speed) : null,
    courseDeg: Number.isFinite(course) && course > 0 && course <= 360 ? Math.round(course) : null, trueCourse: !!trueDeg,
    distNm: legNmVal !== null && legNmVal < 300 ? Math.round(legNmVal * 10) / 10 : null,
    flyOver: !!flyOver, role: map ? "MAP" : faf ? "FAF" : iff ? "IF" : iaf ? "IAF" : null,
    vAngle: Number.isFinite(vAngle) && Math.abs(vAngle) > 1 && Math.abs(vAngle) < 8 ? Math.round(Math.abs(vAngle) * 100) / 100 : null,
  };
  let hold: Leg["hold"] = null;
  // Only a sane racetrack: a real course, a turn side, and a leg length that makes sense.
  if (HOLD_TYPES.has(type) && Number.isFinite(course) && course >= 0 && course <= 360 && (turn === 1 || turn === 2)) {
    const legMin = minutes ? (dist > 0.4 && dist <= 4 ? dist : null) : null;
    const legNm = !minutes && dist > 0 ? (dist > 100 ? dist / 1852 : dist) : null; // metres in the sim's data; nm if it's already small
    if ((legMin !== null) || (legNm !== null && legNm >= 0.5 && legNm <= 25) || (!dist)) {
      hold = { ident: fix.ident, lat, lon, courseDeg: Math.round(course * 10) / 10, trueCourse: !!trueDeg, right: turn === 2, legNm: legNm !== null ? Math.round(legNm * 10) / 10 : null, legMin: legMin ?? (!dist ? 1 : null), altFt: ft(alt1), alt2Ft: ft(alt2), speedKt: Number.isFinite(speed) && speed > 60 && speed < 400 ? Math.round(speed) : null };
    }
  }
  return { fix, hold };
}

export function collectApproachPaths(records: PathRecord[]): ApproachPath[] {
  const apps = new Map<number, ApproachPath>();
  const trans = new Map<number, { app: number; t: { name: string; legs: PathFix[] } }>();
  for (const r of records) {
    if (r.type === FT.APPROACH) {
      const type = APPROACH_TYPE[r.data.readInt32()] ?? "APP";
      const suffix = r.data.readInt32();
      const rw = runwayName(r.data.readInt32(), r.data.readInt32());
      const sfx = suffix >= 65 && suffix <= 90 ? ` ${String.fromCharCode(suffix)}` : "";
      apps.set(r.id, { name: `${type === "GPS" ? "RNAV" : type}${sfx}${rw ? ` ${rw}` : ""}`, runway: rw, final: [], transitions: [], missed: [], holds: [] });
    }
  }
  for (const r of records) {
    if (r.type === FT.APPROACH_TRANSITION) {
      const a = apps.get(r.parent);
      if (!a) continue;
      const t = { name: clean(r.data.readString8()), legs: [] as PathFix[] };
      if (!okName(t.name)) continue;
      a.transitions.push(t);
      trans.set(r.id, { app: r.parent, t });
    }
  }
  const holds = new Map<number, PubHold[]>();
  const addHold = (app: number, h: Leg["hold"], from: PubHold["from"]) => { if (!h) return; const l = holds.get(app) ?? []; if (!l.some((x) => x.ident === h.ident)) l.push({ ...h, from }); holds.set(app, l); };
  for (const r of records) {
    if (r.type === FT_LEG.FINAL_APPROACH_LEG) { const a = apps.get(r.parent); if (!a) continue; const l = readLeg(r.data); if (l.fix) a.final.push(l.fix); addHold(r.parent, l.hold, "approach"); }
    else if (r.type === FT_LEG.MISSED_APPROACH_LEG) { const a = apps.get(r.parent); if (!a) continue; const l = readLeg(r.data); if (l.fix) a.missed.push(l.fix); addHold(r.parent, l.hold, "missed"); }
    else if (r.type === FT_LEG.APPROACH_LEG) { const t = trans.get(r.parent); if (!t) continue; const l = readLeg(r.data); if (l.fix) t.t.legs.push(l.fix); addHold(t.app, l.hold, "approach"); }
  }
  for (const [id, a] of apps) a.holds = holds.get(id) ?? [];
  const out = [...apps.values()].filter((a) => a.final.length >= 2);
  // Drop repeated points (a leg that ends where the next starts).
  const dedupe = (l: PathFix[]) => l.filter((p, i) => i === 0 || p.ident !== l[i - 1]!.ident || Math.abs(p.lat - l[i - 1]!.lat) > 1e-5);
  for (const a of out) { a.final = dedupe(a.final); a.missed = dedupe(a.missed); for (const t of a.transitions) t.legs = dedupe(t.legs); }
  return out;
}


/* ---------------- SID and STAR paths ---------------- */

export const FT_SS = { DEPARTURE: 10, ARRIVAL: 11, RUNWAY_TRANSITION: 12, ENROUTE_TRANSITION: 13, APPROACH_LEG: 7 } as const;
export const SIDSTAR_PATH_DEFINITION = [
  "OPEN AIRPORT",
  "OPEN DEPARTURE", "NAME",
  "OPEN RUNWAY_TRANSITION", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR", "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG", "CLOSE RUNWAY_TRANSITION",
  "OPEN ENROUTE_TRANSITION", "NAME", "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG", "CLOSE ENROUTE_TRANSITION",
  "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG",
  "CLOSE DEPARTURE",
  "OPEN ARRIVAL", "NAME",
  "OPEN RUNWAY_TRANSITION", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR", "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG", "CLOSE RUNWAY_TRANSITION",
  "OPEN ENROUTE_TRANSITION", "NAME", "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG", "CLOSE ENROUTE_TRANSITION",
  "OPEN APPROACH_LEG", ...LEG_FIELDS, "CLOSE APPROACH_LEG",
  "CLOSE ARRIVAL",
  "CLOSE AIRPORT",
];
export interface ProcPath { name: string; kind: "sid" | "star"; runways: Array<{ runway: string; legs: PathFix[] }>; common: PathFix[]; enroute: Array<{ name: string; legs: PathFix[] }>; holds: PubHold[] }

export function collectSidStarPaths(records: PathRecord[]): ProcPath[] {
  const procs = new Map<number, ProcPath>();
  const subs = new Map<number, { proc: number; legs: PathFix[] }>();
  for (const r of records) {
    if (r.type === FT_SS.DEPARTURE || r.type === FT_SS.ARRIVAL) {
      const name = clean(r.data.readString8());
      if (okName(name)) procs.set(r.id, { name, kind: r.type === FT_SS.DEPARTURE ? "sid" : "star", runways: [], common: [], enroute: [], holds: [] });
    }
  }
  for (const r of records) {
    const p = procs.get(r.parent);
    if (!p) continue;
    if (r.type === FT_SS.RUNWAY_TRANSITION) { const rw = runwayName(r.data.readInt32(), r.data.readInt32()); const t = { runway: rw, legs: [] as PathFix[] }; p.runways.push(t); subs.set(r.id, { proc: r.parent, legs: t.legs }); }
    else if (r.type === FT_SS.ENROUTE_TRANSITION) { const n = clean(r.data.readString8()); const t = { name: n, legs: [] as PathFix[] }; if (okName(n)) { p.enroute.push(t); subs.set(r.id, { proc: r.parent, legs: t.legs }); } }
  }
  for (const r of records) {
    if (r.type !== FT_SS.APPROACH_LEG) continue;
    const direct = procs.get(r.parent), sub = subs.get(r.parent);
    if (!direct && !sub) continue;
    const l = readLeg(r.data);
    const owner = direct ?? procs.get(sub!.proc)!;
    if (l.fix) (direct ? direct.common : sub!.legs).push(l.fix);
    if (l.hold && !owner.holds.some((h) => h.ident === l.hold!.ident)) owner.holds.push({ ...l.hold, from: "approach" });
  }
  return [...procs.values()].filter((p) => p.common.length + p.runways.reduce((a, t) => a + t.legs.length, 0) + p.enroute.reduce((a, t) => a + t.legs.length, 0) > 0);
}
