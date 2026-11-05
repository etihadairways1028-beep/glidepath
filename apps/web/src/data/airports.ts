/**
 * Airport data in the browser: large and medium airports bundled with the
 * app (OurAirports, public domain). The Bridge has every airport; when
 * connected, search and airport pages ask it first.
 */
import { AirportDb, type Airport, type Runway } from "@glidepath/aviation-data";
import { activeBridge } from "./bridge";

let dbPromise: Promise<AirportDb> | null = null;

export function loadAirportDb(): Promise<AirportDb> {
  dbPromise ??= Promise.all([
    fetch("data/airports-major.json").then((r) => r.json()),
    fetch("data/runways-major.json").then((r) => r.json()),
    fetch("data/frequencies-major.json").then((r) => r.json()),
  ]).then(([a, r, f]) => new AirportDb(a, r, f));
  return dbPromise;
}

export interface AirportDetail extends Airport {
  runways: Runway[];
  frequencies: Array<{ type: string; description: string; mhz: number }>;
}

export async function searchAirports(q: string): Promise<Airport[]> {
  const bridge = activeBridge();
  if (bridge) {
    try {
      return await bridge.get<Airport[]>(`/api/airports/search?q=${encodeURIComponent(q)}`);
    } catch {
      /* fall back to the bundled list */
    }
  }
  return (await loadAirportDb()).search(q, 25);
}

export async function airportDetail(code: string): Promise<AirportDetail | null> {
  const bridge = activeBridge();
  if (bridge) {
    try {
      return await bridge.get<AirportDetail>(`/api/airports/${encodeURIComponent(code)}`);
    } catch {
      /* fall back */
    }
  }
  const db = await loadAirportDb();
  const a = db.get(code);
  return a ? { ...a, runways: db.runwaysAt(a.code), frequencies: db.frequencies(a.code) } : null;
}
