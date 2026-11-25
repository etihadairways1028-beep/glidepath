/**
 * Airport layout from the simulator's own scenery data (SimConnect facility data):
 * runways, taxiways with their names, hold-short points and parking/gates. Used to draw
 * taxi charts for any airport in MSFS. Positions come as metre offsets (BIAS_X east,
 * BIAS_Z north) from the airport reference point and are turned into lat/lon here.
 */

/** Facility record types for the layout request (SIMCONNECT_FACILITY_DATA_TYPE). */
export const FL = { AIRPORT: 0, RUNWAY: 1, TAXI_POINT: 14, TAXI_PARKING: 15, TAXI_PATH: 16, TAXI_NAME: 17 } as const;

/** Field order matters: the reader below reads them in exactly this order. */
export const LAYOUT_DEFINITION = [
  "OPEN AIRPORT", "LATITUDE", "LONGITUDE", "MAGVAR",
  "OPEN RUNWAY", "LATITUDE", "LONGITUDE", "HEADING", "LENGTH", "WIDTH", "PRIMARY_NUMBER", "PRIMARY_DESIGNATOR", "SECONDARY_NUMBER", "SECONDARY_DESIGNATOR", "SURFACE", "CLOSE RUNWAY",
  "OPEN TAXI_POINT", "TYPE", "BIAS_X", "BIAS_Z", "CLOSE TAXI_POINT",
  "OPEN TAXI_PARKING", "TYPE", "NAME", "SUFFIX", "NUMBER", "HEADING", "RADIUS", "BIAS_X", "BIAS_Z", "CLOSE TAXI_PARKING",
  "OPEN TAXI_PATH", "TYPE", "WIDTH", "RUNWAY_NUMBER", "RUNWAY_DESIGNATOR", "START", "END", "NAME_INDEX", "CLOSE TAXI_PATH",
  "OPEN TAXI_NAME", "NAME", "CLOSE TAXI_NAME",
  "CLOSE AIRPORT",
];

export interface LayoutReader { readInt32(): number; readUint32(): number; readFloat32(): number; readFloat64(): number; readString32(): string }
export interface LayoutRecord { type: number; data: LayoutReader }

export type Pt = [number, number]; // [lat, lon]
export interface AirportLayout {
  icao: string; lat: number; lon: number; magvar: number;
  runways: Array<{ lat: number; lon: number; hdg: number; lengthM: number; widthM: number; ends: [string, string]; surface: number }>;
  /** Taxiway segments: kind, width in metres, the two ends, and the taxiway name ("" if none). */
  paths: Array<{ kind: "taxi" | "runway" | "parking" | "path" | "closed"; w: number; a: Pt; b: Pt; name: string }>;
  /** Hold-short points (ILS ones flagged). */
  holds: Array<{ p: Pt; ils: boolean }>;
  parking: Array<{ p: Pt; hdg: number; r: number; kind: "gate" | "ramp" | "cargo" | "mil" | "fuel" | "other"; name: string }>;
}

const DESIG = ["", "L", "R", "C", "W", "A", "B"];
const rwy = (n: number, d: number) => (n >= 1 && n <= 36 ? `${String(n).padStart(2, "0")}${DESIG[d] ?? ""}` : (["N", "NE", "E", "SE", "S", "SW", "W", "NW"][n - 37] ?? ""));
const cleanName = (s: string) => s.replace(/\0.*$/s, "").trim();
const PNAME: string[] = ["", "Parking", "N Parking", "NE Parking", "E Parking", "SE Parking", "S Parking", "SW Parking", "W Parking", "NW Parking", "Gate", "Dock", ...Array.from({ length: 26 }, (_, i) => `Gate ${String.fromCharCode(65 + i)}`)];
const pkind = (t: number): AirportLayout["parking"][number]["kind"] => (t >= 8 && t <= 10) || t === 15 ? "gate" : t === 5 ? "cargo" : t === 6 || t === 7 ? "mil" : t === 12 ? "fuel" : t >= 1 && t <= 4 || t === 14 ? "ramp" : "other";
const PATH_KIND: Record<number, AirportLayout["paths"][number]["kind"] | undefined> = { 1: "taxi", 2: "runway", 3: "parking", 4: "path", 5: "closed" };

export function collectLayout(icao: string, records: LayoutRecord[]): AirportLayout | null {
  let ref: { lat: number; lon: number; magvar: number } | null = null;
  const runways: AirportLayout["runways"] = [];
  const points: Array<{ p: Pt; type: number }> = [];
  const parks: AirportLayout["parking"] = [];
  const rawPaths: Array<{ type: number; w: number; s: number; e: number; name: number }> = [];
  const names: string[] = [];
  const toLL = (x: number, z: number): Pt => { const lat = ref!.lat + z / 111_320; return [lat, ref!.lon + x / (111_320 * Math.cos((ref!.lat * Math.PI) / 180))]; };
  for (const r of records) {
    const d = r.data;
    switch (r.type) {
      case FL.AIRPORT: ref = { lat: d.readFloat64(), lon: d.readFloat64(), magvar: d.readFloat32() }; break;
      case FL.RUNWAY: {
        const lat = d.readFloat64(), lon = d.readFloat64(), hdg = d.readFloat32(), lengthM = d.readFloat32(), widthM = d.readFloat32();
        const pn = d.readInt32(), pd = d.readInt32(), sn = d.readInt32(), sd = d.readInt32(), surface = d.readInt32();
        if (Number.isFinite(lat) && lengthM > 50) runways.push({ lat, lon, hdg, lengthM, widthM: widthM > 3 ? widthM : 45, ends: [rwy(pn, pd), rwy(sn, sd)], surface });
        break;
      }
      case FL.TAXI_POINT: { const type = d.readInt32(), x = d.readFloat32(), z = d.readFloat32(); points.push({ p: ref ? toLL(x, z) : [NaN, NaN], type }); break; }
      case FL.TAXI_PARKING: {
        const type = d.readInt32(), name = d.readInt32(), suffix = d.readInt32(), num = d.readUint32(), hdg = d.readFloat32(), r2 = d.readFloat32(), x = d.readFloat32(), z = d.readFloat32();
        const label = `${name >= 12 && name <= 37 ? String.fromCharCode(53 + name) : ""}${num || ""}${suffix >= 12 && suffix <= 37 ? String.fromCharCode(53 + suffix) : ""}` || PNAME[name] || "";
        parks.push({ p: ref ? toLL(x, z) : [NaN, NaN], hdg, r: r2, kind: pkind(type), name: label });
        break;
      }
      case FL.TAXI_PATH: { const type = d.readInt32(), w = d.readFloat32(); d.readInt32(); d.readInt32(); const s = d.readInt32(), e = d.readInt32(), name = d.readUint32(); rawPaths.push({ type, w, s, e, name }); break; }
      case FL.TAXI_NAME: names.push(cleanName(d.readString32())); break;
    }
  }
  if (!ref) return null;
  const paths: AirportLayout["paths"] = [];
  for (const rp of rawPaths) {
    const kind = PATH_KIND[rp.type];
    if (!kind) continue; // vehicle roads, painted lines
    const a = points[rp.s]?.p;
    // On a parking path the END is a parking spot, not a taxi point.
    const b = kind === "parking" ? parks[rp.e]?.p : points[rp.e]?.p;
    if (!a || !b || !Number.isFinite(a[0]) || !Number.isFinite(b[0])) continue;
    paths.push({ kind, w: rp.w > 1 ? rp.w : 15, a, b, name: kind === "taxi" ? names[rp.name] ?? "" : "" });
  }
  const holds = points.filter((p) => p.type === 2 || p.type === 4).map((p) => ({ p: p.p, ils: p.type === 4 }));
  const round = (p: Pt): Pt => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  return {
    icao: icao.toUpperCase(), lat: ref.lat, lon: ref.lon, magvar: Number.isFinite(ref.magvar) ? ref.magvar : 0,
    runways,
    paths: paths.map((p) => ({ ...p, a: round(p.a), b: round(p.b), w: Math.round(p.w * 10) / 10 })),
    holds: holds.map((h) => ({ ...h, p: round(h.p) })),
    parking: parks.filter((p) => Number.isFinite(p.p[0])).map((p) => ({ ...p, p: round(p.p), hdg: Math.round(p.hdg), r: Math.round(p.r) })),
  };
}
