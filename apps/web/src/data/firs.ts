/**
 * Online centre (CTR/FSS) sectors drawn as their real airspace, from the
 * open VATSpy data project (the boundaries VATSIM's own maps use; IVAO uses
 * the same ICAO FIRs). Loaded once, on demand, from GitHub (CORS allowed).
 */
import type { NetworkController } from "./external";

const BASE = "https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master";
type Geo = { type: "Feature"; properties: Record<string, string>; geometry: { type: string; coordinates: unknown } };
let data: Promise<{ bounds: Map<string, Geo>; prefix: Map<string, string> }> | null = null;

function load() {
  if (!data) data = (async () => {
    const [g, dat] = await Promise.all([
      fetch(`${BASE}/Boundaries.geojson`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ features: Geo[] }>; }),
      fetch(`${BASE}/VATSpy.dat`).then((r) => r.text()),
    ]);
    const bounds = new Map<string, Geo>();
    for (const f of g.features) bounds.set(String(f.properties.id).toUpperCase(), f);
    const prefix = new Map<string, string>();
    const sec = dat.split(/\[FIRs\]/)[1]?.split(/\n\[/)[0] ?? "";
    for (const line of sec.split(/\r?\n/)) {
      if (!line || line.startsWith(";")) continue;
      const [icao, , cs, boundary] = line.split("|");
      if (!icao) continue;
      const b = (boundary || icao).trim().toUpperCase();
      if (cs?.trim()) prefix.set(cs.trim().toUpperCase(), b);
      if (!prefix.has(icao.trim().toUpperCase())) prefix.set(icao.trim().toUpperCase(), b);
    }
    return { bounds, prefix };
  })().catch((e) => { data = null; throw e; });
  return data;
}

export interface FirFeatureCollection { type: "FeatureCollection"; features: Array<{ type: "Feature"; properties: Record<string, string | number>; geometry: { type: string; coordinates: unknown } }> }

/** Sector shapes and label points for the centres online now. */
export async function onlineFirs(controllers: NetworkController[], color: (c: NetworkController) => string): Promise<FirFeatureCollection> {
  const ctr = controllers.filter((c) => /_(CTR|FSS)$/i.test(c.callsign) || /Centre|Flight service/i.test(c.facility));
  if (!ctr.length) return { type: "FeatureCollection", features: [] };
  const { bounds, prefix } = await load();
  const out: FirFeatureCollection["features"] = [];
  const seen = new Set<string>();
  for (const c of ctr) {
    const parts = c.callsign.toUpperCase().split("_").slice(0, -1);
    let id: string | undefined;
    for (let n = parts.length; n > 0 && !id; n--) { const p = parts.slice(0, n).join("_"); id = prefix.get(p) ?? (bounds.has(p) ? p : undefined); }
    const f = id ? bounds.get(id) : undefined;
    if (!f || seen.has(f.properties.id!)) continue;
    seen.add(f.properties.id!);
    const props = { id: f.properties.id!, callsign: c.callsign, freq: c.frequency ?? "", col: color(c), raw: JSON.stringify(c) };
    out.push({ type: "Feature", properties: { ...props, part: "area" }, geometry: f.geometry });
    const lon = Number(f.properties.label_lon), lat = Number(f.properties.label_lat);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ type: "Feature", properties: { ...props, part: "label" }, geometry: { type: "Point", coordinates: [lon, lat] } });
  }
  return { type: "FeatureCollection", features: out };
}
