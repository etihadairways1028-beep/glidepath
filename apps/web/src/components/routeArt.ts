/**
 * Drawing a flight's route on a canvas, shared by the share card and the replay video:
 * the real coastline (Natural Earth, bundled with the app), the track coloured by
 * altitude like the live map, and a projection that fits the whole route.
 */
export interface ArtPt { lat: number; lon: number; alt?: number; t?: number; gs?: number }
export interface Box { x: number; y: number; w: number; h: number }

type Ring = number[][];
let landP: Promise<Ring[]> | null = null;
/** Every land outline, once per session. */
export function loadLand(): Promise<Ring[]> {
  landP ??= fetch("data/land.geojson").then((r) => r.json()).then((g: { features: Array<{ geometry: { type: string; coordinates: unknown } }> }) => {
    const rings: Ring[] = [];
    for (const f of g.features ?? []) {
      const gm = f.geometry;
      if (gm?.type === "Polygon") for (const r of gm.coordinates as Ring[]) rings.push(r);
      if (gm?.type === "MultiPolygon") for (const poly of gm.coordinates as Ring[][]) for (const r of poly) rings.push(r);
    }
    return rings;
  }).catch(() => []);
  return landP;
}

/** Altitude colours, the same as the live map's trail. */
const STOPS: Array<[number, [number, number, number]]> = [[0, [52, 199, 89]], [5000, [100, 210, 255]], [12000, [10, 132, 255]], [20000, [142, 139, 255]], [30000, [191, 90, 242]]];
export function altColor(ft: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    if (ft <= STOPS[i]![0]) {
      const [a0, c0] = STOPS[i - 1]!, [a1, c1] = STOPS[i]!, k = (ft - a0) / (a1 - a0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j]! - v) * k)).join(",")})`;
    }
  }
  return "rgb(191,90,242)";
}

export interface Projection { map: (lon: number, lat: number) => [number, number]; scale: number; lonShift: boolean }
/** Fit the points in the box (equirectangular, corrected for latitude, safe across the date line). */
export function fit(points: ArtPt[], box: Box, pad = 0.14): Projection {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const lonsRaw = pts.map((p) => p.lon);
  const lonShift = lonsRaw.length > 1 && Math.max(...lonsRaw) - Math.min(...lonsRaw) > 180;
  const L = (l: number) => (lonShift && l < 0 ? l + 360 : l);
  const midLat = pts.length ? pts.reduce((s, p) => s + p.lat, 0) / pts.length : 0;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => L(p.lon) * k), ys = pts.map((p) => -p.lat);
  let [x0, x1, y0, y1] = pts.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [-10, 10, -10, 10];
  // Never zoom in closer than ~1.5° across, so a short hop still shows the coast around it.
  const minSpan = 1.5;
  if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
  if (y1 - y0 < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; }
  const iw = box.w * (1 - pad * 2), ih = box.h * (1 - pad * 2);
  const s = Math.min(iw / (x1 - x0), ih / (y1 - y0));
  const ox = box.x + box.w / 2 - ((x0 + x1) / 2) * s, oy = box.y + box.h / 2 - ((y0 + y1) / 2) * s;
  return { map: (lon, lat) => [ox + L(lon) * k * s, oy - lat * s], scale: s, lonShift };
}

/** Land in one colour on sea in another, clipped to the box. */
export function drawLand(c: CanvasRenderingContext2D, pr: Projection, box: Box, land: Ring[], fill = "#1B2130", coast = "rgba(255,255,255,.10)") {
  c.save();
  c.beginPath(); c.rect(box.x, box.y, box.w, box.h); c.clip();
  c.beginPath();
  for (const r of land) {
    // Skip shapes nowhere near the box.
    let any = false;
    for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 24))) {
      const [x, y] = pr.map(r[i]![0]!, r[i]![1]!);
      if (x > box.x - box.w && x < box.x + box.w * 2 && y > box.y - box.h && y < box.y + box.h * 2) { any = true; break; }
    }
    if (!any) continue;
    r.forEach((p, i) => { const [x, y] = pr.map(p[0]!, p[1]!); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath();
  }
  c.fillStyle = fill; c.fill("evenodd");
  c.lineWidth = 1.5; c.strokeStyle = coast; c.stroke();
  c.restore();
}

/** The track, coloured by altitude, up to `upto` points. */
export function drawTrack(c: CanvasRenderingContext2D, pr: Projection, pts: ArtPt[], width: number, upto = pts.length) {
  c.save(); c.lineCap = "round"; c.lineJoin = "round"; c.lineWidth = width;
  for (let i = 1; i < Math.min(upto, pts.length); i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (Math.abs(a.lon - b.lon) > 180) continue;
    const [x0, y0] = pr.map(a.lon, a.lat), [x1, y1] = pr.map(b.lon, b.lat);
    c.strokeStyle = altColor(b.alt ?? 0);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  c.restore();
}

/** Great-circle points between two airports, for flights recorded without a track. */
export function greatCircle(a: ArtPt, b: ArtPt, n = 64): ArtPt[] {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!d) return [a, b];
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
  });
}

export function trackNm(pts: ArtPt[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    d += 3440.065 * 2 * Math.asin(Math.sqrt(h));
  }
  return d;
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  c.beginPath(); c.moveTo(x + rad, y); c.arcTo(x + w, y, x + w, y + h, rad); c.arcTo(x + w, y + h, x, y + h, rad); c.arcTo(x, y + h, x, y, rad); c.arcTo(x, y, x + w, y, rad); c.closePath();
}

/** A small top-down airliner pointing up (north), centred on 0,0. */
export function drawPlane(c: CanvasRenderingContext2D, x: number, y: number, hdgDeg: number, size: number) {
  c.save(); c.translate(x, y); c.rotate((hdgDeg * Math.PI) / 180); c.scale(size / 24, size / 24);
  c.beginPath();
  c.moveTo(0, -12); c.lineTo(1.6, -8); c.lineTo(1.6, -2.5); c.lineTo(11, 3); c.lineTo(11, 5); c.lineTo(1.6, 2.5); c.lineTo(1.2, 8); c.lineTo(4, 10.5); c.lineTo(4, 12);
  c.lineTo(0, 11); c.lineTo(-4, 12); c.lineTo(-4, 10.5); c.lineTo(-1.2, 8); c.lineTo(-1.6, 2.5); c.lineTo(-11, 5); c.lineTo(-11, 3); c.lineTo(-1.6, -2.5); c.lineTo(-1.6, -8); c.closePath();
  c.fillStyle = "#fff"; c.fill(); c.lineWidth = 1.2; c.strokeStyle = "rgba(0,0,0,.55)"; c.stroke();
  c.restore();
}

export function bearing(a: ArtPt, b: ArtPt): number {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
