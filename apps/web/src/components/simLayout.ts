/**
 * The simulator's own airport (from the Bridge, the same data as the Taxi chart) as map data:
 * every taxi path with its name, each parking stand with its number, outline and lead-in line,
 * and the hold-short points. Drawn on the live map over the OpenStreetMap airport.
 */
import type { AirportLayout } from "./TaxiChart";

const M = 111_320;
type F = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };

export function simLayoutGeo(l: AirportLayout | null): { type: "FeatureCollection"; features: F[] } {
  const features: F[] = [];
  if (!l) return { type: "FeatureCollection", features };
  const cl = Math.cos((l.lat * Math.PI) / 180) || 1;
  const move = (lat: number, lon: number, hdg: number, m: number): [number, number] => {
    const a = (hdg * Math.PI) / 180;
    return [lon + (Math.sin(a) * m) / (M * cl), lat + (Math.cos(a) * m) / M];
  };
  for (const p of l.paths) {
    if (p.kind === "runway" || p.kind === "closed") continue;
    features.push({ type: "Feature", properties: { t: p.kind === "parking" ? "lane" : "taxi", name: p.kind === "taxi" ? p.name : "" },
      geometry: { type: "LineString", coordinates: [[p.a[1], p.a[0]], [p.b[1], p.b[0]]] } });
  }
  for (const s of l.parking) {
    const [lat, lon] = s.p;
    const r = Math.max(8, Math.min(45, s.r || 15));
    const ring: [number, number][] = [];
    for (let i = 0; i <= 20; i++) ring.push(move(lat, lon, (i / 20) * 360, r));
    features.push({ type: "Feature", properties: { t: "stand", kind: s.kind }, geometry: { type: "Polygon", coordinates: [ring] } });
    // Lead-in line: the way the nose points when parked, from behind the stand to its stop mark.
    features.push({ type: "Feature", properties: { t: "lead" }, geometry: { type: "LineString", coordinates: [move(lat, lon, s.hdg + 180, r * 1.6), move(lat, lon, s.hdg, r * 0.55)] } });
    if (s.name) features.push({ type: "Feature", properties: { t: "standname", name: s.name }, geometry: { type: "Point", coordinates: [lon, lat] } });
  }
  for (const h of l.holds) features.push({ type: "Feature", properties: { t: "hold", ils: h.ils }, geometry: { type: "Point", coordinates: [h.p[1], h.p[0]] } });
  return { type: "FeatureCollection", features };
}
