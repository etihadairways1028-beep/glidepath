/**
 * Airport, runway and frequency lookups over the OurAirports data set
 * (public domain, https://ourairports.com/data/). The data is passed in, so
 * the Bridge can bundle it while the web app loads it on demand.
 */
import { distanceNm, type LatLon, type RunwayEnd } from "@glidepath/flight-engine";

export type AirportRow = [code: string, iata: string, name: string, city: string, country: string, lat: number, lon: number, elevFt: number | null, type: "L" | "M" | "S"];
export type RunwayRow = [leIdent: string, leLat: number, leLon: number, leHdg: number, heIdent: string, heLat: number, heLon: number, heHdg: number,
  lengthFt: number | null, widthFt: number | null, surface: string, lighted: boolean, leDisplacedFt: number, heDisplacedFt: number];
export type FrequencyRow = [type: string, description: string, mhz: number];

export interface Airport {
  code: string;
  iata: string | null;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  size: "large" | "medium" | "small";
}

export interface Runway {
  /** Both ends, each usable as a landing/takeoff direction. */
  ends: [RunwayEnd & { displacedFt: number }, RunwayEnd & { displacedFt: number }];
  lengthFt: number | null;
  widthFt: number | null;
  surface: string;
  lighted: boolean;
}

const SIZE = { L: "large", M: "medium", S: "small" } as const;

export class AirportDb {
  private byCode = new Map<string, AirportRow>();
  private grid = new Map<string, AirportRow[]>();

  constructor(
    private readonly airports: AirportRow[],
    private readonly runways: Record<string, RunwayRow[]> = {},
    private readonly freqs: Record<string, FrequencyRow[]> = {},
  ) {
    for (const a of airports) {
      // Prefer the larger airport when two share a code.
      const prev = this.byCode.get(a[0]);
      if (!prev || rank(a[8]) > rank(prev[8])) this.byCode.set(a[0], a);
      const key = cell(a[5], a[6]);
      const list = this.grid.get(key);
      if (list) list.push(a);
      else this.grid.set(key, [a]);
    }
  }

  get size(): number {
    return this.airports.length;
  }

  get(code: string): Airport | null {
    const r = this.byCode.get(code.trim().toUpperCase());
    return r ? toAirport(r) : null;
  }

  /**
   * Nearest airport to a position. On the ground, the aircraft is inside the
   * airport boundary, so the closest reference point within a few nm wins,
   * preferring larger airports when two are similarly close.
   */
  nearest(p: LatLon, opts: { maxNm?: number; sizes?: Array<Airport["size"]> } = {}): (Airport & { distanceNm: number }) | null {
    const maxNm = opts.maxNm ?? 5;
    const allowed = opts.sizes ? new Set(opts.sizes) : null;
    let best: { a: AirportRow; d: number; score: number } | null = null;
    const span = Math.ceil(maxNm / 60) + 1;
    const [ci, cj] = [Math.floor(p.lat), Math.floor(p.lon)];
    for (let i = ci - span; i <= ci + span; i++) {
      for (let j = cj - span; j <= cj + span; j++) {
        for (const a of this.grid.get(`${i},${((j + 540) % 360) - 180}`) ?? []) {
          if (allowed && !allowed.has(SIZE[a[8]])) continue;
          const d = distanceNm(p, { lat: a[5], lon: a[6] });
          if (d > maxNm) continue;
          // A large airport's reference point can be 2 nm from its stands; bias towards it.
          const score = d - (a[8] === "L" ? 1.2 : a[8] === "M" ? 0.5 : 0);
          if (!best || score < best.score) best = { a, d, score };
        }
      }
    }
    return best ? { ...toAirport(best.a), distanceNm: Math.round(best.d * 10) / 10 } : null;
  }

  search(query: string, limit = 20): Airport[] {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    const exact: AirportRow[] = [];
    const starts: AirportRow[] = [];
    const contains: AirportRow[] = [];
    for (const a of this.airports) {
      if (a[0] === q || a[1] === q) exact.push(a);
      else if (a[0].startsWith(q)) starts.push(a);
      else if (q.length >= 3 && (a[2].toUpperCase().includes(q) || a[3].toUpperCase().includes(q))) contains.push(a);
    }
    const bySize = (x: AirportRow, y: AirportRow) => rank(y[8]) - rank(x[8]);
    return [...exact.sort(bySize), ...starts.sort(bySize), ...contains.sort(bySize)].slice(0, limit).map(toAirport);
  }

  runwaysAt(code: string): Runway[] {
    return (this.runways[code.trim().toUpperCase()] ?? []).map((r) => ({
      ends: [
        { ident: r[0], threshold: { lat: r[1], lon: r[2] }, headingTrueDeg: r[3], lengthFt: r[8] ?? 0, widthFt: r[9] ?? 150, displacedFt: r[12] },
        { ident: r[4], threshold: { lat: r[5], lon: r[6] }, headingTrueDeg: r[7], lengthFt: r[8] ?? 0, widthFt: r[9] ?? 150, displacedFt: r[13] },
      ],
      lengthFt: r[8], widthFt: r[9], surface: r[10], lighted: r[11],
    }));
  }

  /** Every runway direction at an airport, ready for touchdown analysis. */
  runwayEnds(code: string): RunwayEnd[] {
    return this.runwaysAt(code).flatMap((r) => r.ends);
  }

  frequencies(code: string): Array<{ type: string; description: string; mhz: number }> {
    return (this.freqs[code.trim().toUpperCase()] ?? []).map(([type, description, mhz]) => ({ type, description, mhz }));
  }
}

function rank(t: AirportRow[8]): number {
  return t === "L" ? 3 : t === "M" ? 2 : 1;
}
function cell(lat: number, lon: number): string {
  return `${Math.floor(lat)},${Math.floor(lon)}`;
}
function toAirport(a: AirportRow): Airport {
  return { code: a[0], iata: a[1] || null, name: a[2], city: a[3], country: a[4], lat: a[5], lon: a[6], elevationFt: a[7], size: SIZE[a[8]] };
}
