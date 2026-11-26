/** A low-poly airliner built from map extrusions, so the 3D map can show your
 *  aircraft as a real 3D shape (with a shadow) instead of a flat icon.
 *  Sizes are an A320-ish airframe in metres, scaled by `k` so the aircraft
 *  stays readable at every zoom. */
type Pt = [number, number]; // [forward, right] in metres
type Feat = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } };
type FC = { type: "FeatureCollection"; features: Feat[] };
type Part = { pts: Pt[]; base: number; top: number; color: string; mirror?: boolean };

const BODY = "#F4F7FB", WING = "#DCE3EC", DARK = "#5B6678", ACCENT = "#0A6CFF";

const half = (pts: Pt[]): Pt[] => [...pts, ...pts.slice().reverse().map(([f, r]) => [f, -r] as Pt)];

const PARTS: Part[] = [
  // fuselage: lower and upper halves give it a rounder look
  { pts: half([[19, 0], [18.2, 0.9], [16.5, 1.7], [14, 2], [-12, 2], [-16, 1.4], [-19, 0.5]]), base: 1.2, top: 3.4, color: "#E6ECF3" },
  { pts: half([[18.6, 0], [17.6, 0.7], [15.5, 1.4], [13, 1.6], [-12, 1.6], [-16, 1.1], [-18.8, 0.3]]), base: 3.4, top: 5.0, color: BODY },
  // cockpit windows
  { pts: [[17.4, 0], [16.9, 0.9], [15.7, 1.25], [15.7, -1.25], [16.9, -0.9]], base: 4.2, top: 5.05, color: "#1E2A3C" },
  // wings (swept), with engines under them
  { pts: half([[3.5, 1.8], [-1.5, 9], [-5.5, 17.2], [-7.4, 17.4], [-5.6, 9], [-4.5, 1.8]]), base: 2.3, top: 2.9, color: WING },
  { pts: [[3.2, 5.0], [3.2, 6.9], [-1.2, 6.9], [-1.2, 5.0]], base: 0.6, top: 2.6, color: DARK, mirror: true },
  // tailplane
  { pts: half([[-13, 1.2], [-16.5, 6.2], [-18, 6.2], [-17.6, 1.2]]), base: 4.4, top: 4.8, color: WING },
  // fin
  { pts: [[-11.5, 0.25], [-16.2, 0.25], [-19.2, 0.25], [-19.2, -0.25], [-16.2, -0.25], [-11.5, -0.25]], base: 5.0, top: 7.5, color: ACCENT },
  { pts: [[-14.2, 0.22], [-19.4, 0.22], [-19.4, -0.22], [-14.2, -0.22]], base: 7.5, top: 11.6, color: ACCENT },
];

const M_PER_DEG = 111_320;

export function planeExtrusion(lon: number, lat: number, hdg: number, k: number, lift: number) {
  const a = (hdg * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a), cl = Math.cos((lat * Math.PI) / 180) || 1;
  const toLL = ([f, r]: Pt): [number, number] => {
    const e = (f * s + r * c) * k, n = (f * c - r * s) * k;
    return [lon + e / (M_PER_DEG * cl), lat + n / M_PER_DEG];
  };
  const ring = (pts: Pt[]) => { const r = pts.map(toLL); r.push(r[0]!); return r; };
  const features: Feat[] = [];
  for (const p of PARTS) {
    const shapes = p.mirror ? [p.pts, p.pts.map(([f, r]) => [f, -r] as Pt)] : [p.pts];
    for (const sh of shapes) features.push({ type: "Feature", properties: { base: lift + p.base * k, top: lift + p.top * k, color: p.color }, geometry: { type: "Polygon", coordinates: [ring(sh)] } });
  }
  // Shadow: the outline on the ground, nudged away from the sun.
  const shadow: Feat = { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [0, 3, 5].map((i) => [ring(PARTS[i]!.pts)]) } };
  const body: FC = { type: "FeatureCollection", features };
  const shade: FC = { type: "FeatureCollection", features: [shadow] };
  return { body, shadow: shade };
}

/** Metres multiplier: about 40 px long on screen at any zoom, never smaller than real size ×2.5. */
export const planeScale = (zoom: number) => Math.max(2.5, Math.pow(2, 17.8 - zoom));
