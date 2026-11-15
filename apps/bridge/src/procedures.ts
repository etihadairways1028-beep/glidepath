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
