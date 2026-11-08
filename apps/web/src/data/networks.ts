/**
 * Live traffic and ATC for VATSIM, IVAO and SayIntentions.
 * Asks the Bridge when connected; otherwise fetches the public feeds straight
 * from this device, so traffic shows even without a PC. Controllers get a map
 * position: IVAO sends one, VATSIM's transceiver feed gives one, and failing
 * that the airport in the callsign (EGLL_TWR -> Heathrow) is used.
 */
import { activeBridge } from "./bridge";
import { loadAirportDb } from "./airports";
import type { Network, NetworkController, NetworkPilot, NetworkSnapshot } from "./external";

export interface PlacedController extends NetworkController { lat: number; lon: number }
export interface LiveNetwork extends NetworkSnapshot { atc: PlacedController[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
const FACILITY: Record<number, string> = { 0: "Observer", 1: "Flight service", 2: "Delivery", 3: "Ground", 4: "Tower", 5: "Approach", 6: "Centre" };
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

function parseVatsim(j: any): NetworkSnapshot {
  const pilots: NetworkPilot[] = (j?.pilots ?? []).filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map((p: any) => ({
    callsign: String(p.callsign), lat: p.latitude, lon: p.longitude, altFt: p.altitude ?? 0, gsKt: p.groundspeed ?? 0, hdg: p.heading ?? 0,
    type: p.flight_plan?.aircraft_short || null, dep: p.flight_plan?.departure || null, arr: p.flight_plan?.arrival || null, network: "vatsim" as const,
  }));
  const controllers: NetworkController[] = [...(j?.controllers ?? []), ...(j?.atis ?? [])].filter((c: any) => c.facility !== 0).map((c: any) => ({
    callsign: String(c.callsign), frequency: c.frequency && c.frequency !== "199.998" ? String(c.frequency) : null,
    facility: /_ATIS$/.test(c.callsign) ? "ATIS" : FACILITY[c.facility] ?? "ATC", atis: Array.isArray(c.text_atis) ? c.text_atis.map(String) : [], network: "vatsim" as const,
  }));
  return { network: "vatsim", updatedAt: j?.general?.update_timestamp ?? new Date().toISOString(), pilots, controllers };
}

function parseIvao(j: any): NetworkSnapshot & { pos: Map<string, [number, number]> } {
  const pilots: NetworkPilot[] = (j?.clients?.pilots ?? []).filter((p: any) => p.lastTrack && Number.isFinite(p.lastTrack.latitude)).map((p: any) => ({
    callsign: String(p.callsign), lat: p.lastTrack.latitude, lon: p.lastTrack.longitude, altFt: p.lastTrack.altitude ?? 0, gsKt: p.lastTrack.groundSpeed ?? 0,
    hdg: p.lastTrack.heading ?? 0, type: p.flightPlan?.aircraftId || p.flightPlan?.aircraft?.icaoCode || null,
    dep: p.flightPlan?.departureId || null, arr: p.flightPlan?.arrivalId || null, network: "ivao" as const,
  }));
  const pos = new Map<string, [number, number]>();
  const controllers: NetworkController[] = (j?.clients?.atcs ?? []).map((c: any) => {
    if (c.lastTrack && Number.isFinite(c.lastTrack.latitude)) pos.set(String(c.callsign), [c.lastTrack.latitude, c.lastTrack.longitude]);
    return {
      callsign: String(c.callsign), frequency: c.atcSession?.frequency ? Number(c.atcSession.frequency).toFixed(3) : null,
      facility: /_ATIS$/.test(c.callsign) ? "ATIS" : String(c.atcSession?.position ?? "ATC"), atis: Array.isArray(c.atis?.lines) ? c.atis.lines.map(String) : [], network: "ivao" as const,
    };
  });
  return { network: "ivao", updatedAt: j?.updatedAt ?? new Date().toISOString(), pilots, controllers, pos };
}

function parseSayIntentions(j: any): NetworkSnapshot {
  const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.flights) ? j.flights : [];
  const pilots: NetworkPilot[] = list
    .map((p) => ({ p, lat: num(p?.lat), lon: num(p?.lon ?? p?.lng ?? p?.longitude) }))
    .filter(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    .map(({ p, lat, lon }) => ({
      callsign: String(p.flight_icao || p.tail_number || p.displayname || p.flight_id || "SI"), lat, lon,
      altFt: Number.isFinite(num(p.altitude)) ? Math.round(num(p.altitude)) : 0, gsKt: Number.isFinite(num(p.airspeed)) ? Math.round(num(p.airspeed)) : 0,
      hdg: Number.isFinite(num(p.heading)) ? num(p.heading) : 0, type: p.aircraft_icao ? String(p.aircraft_icao) : null,
      dep: p.origin ? String(p.origin) : null, arr: p.final_destination ? String(p.final_destination) : null, network: "sayintentions" as const,
    }));
  return { network: "sayintentions", updatedAt: new Date().toISOString(), pilots, controllers: [] };
}

const FEED: Record<Network, string> = {
  vatsim: "https://data.vatsim.net/v3/vatsim-data.json",
  ivao: "https://api.ivao.aero/v2/tracker/whazzup",
  sayintentions: "https://tracker.sayintentions.ai/api/map",
};

async function direct(url: string): Promise<any> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let vatsimPos: { at: number; map: Map<string, [number, number]> } | null = null;
async function vatsimPositions(): Promise<Map<string, [number, number]>> {
  if (vatsimPos && Date.now() - vatsimPos.at < 60_000) return vatsimPos.map;
  const map = new Map<string, [number, number]>();
  try {
    const list = await direct("https://data.vatsim.net/v3/transceivers-data.json") as Array<{ callsign: string; transceivers: Array<{ latDeg: number; lonDeg: number }> }>;
    for (const c of list) { const t = c.transceivers?.[0]; if (t && Number.isFinite(t.latDeg)) map.set(c.callsign, [t.latDeg, t.lonDeg]); }
  } catch { /* fall back to airport positions */ }
  vatsimPos = { at: Date.now(), map };
  return map;
}

async function place(controllers: NetworkController[], known: Map<string, [number, number]>): Promise<PlacedController[]> {
  const db = await loadAirportDb().catch(() => null);
  const out: PlacedController[] = [];
  for (const c of controllers) {
    if (c.facility === "ATIS") continue;
    let p = known.get(c.callsign) ?? null;
    if (!p && db) {
      const prefix = c.callsign.split(/[_-]/)[0]!;
      const a = db.get(prefix) ?? (prefix.length === 3 ? db.get(`K${prefix}`) : null);
      if (a) p = [a.lat, a.lon];
    }
    if (p) out.push({ ...c, lat: p[0], lon: p[1] });
  }
  return out;
}

/** Traffic + ATC for one network. Throws a readable message if neither the Bridge nor the feed answers. */
export async function getLiveNetwork(n: Network): Promise<LiveNetwork> {
  let snap: NetworkSnapshot & { pos?: Map<string, [number, number]> };
  const b = activeBridge();
  try {
    if (!b) throw new Error("no bridge");
    snap = await b.get<NetworkSnapshot>(`/api/ext/${n}`);
    if (n === "ivao") snap = { ...snap, pos: undefined };
  } catch {
    try {
      const j = await direct(FEED[n]);
      snap = n === "vatsim" ? parseVatsim(j) : n === "ivao" ? parseIvao(j) : parseSayIntentions(j);
    } catch {
      throw new Error(b ? `Couldn't load ${n === "sayintentions" ? "SayIntentions" : n.toUpperCase()} right now.` : "Couldn't load this network from here. Connect your Bridge and it fetches it for you.");
    }
  }
  const known = n === "vatsim" ? await vatsimPositions() : snap.pos ?? new Map();
  if (n === "ivao" && !snap.pos && snap.controllers.length) {
    // The Bridge doesn't pass IVAO positions; ask the feed directly for them.
    try { const j = await direct(FEED.ivao); for (const [k, v] of parseIvao(j).pos) known.set(k, v); } catch { /* airport fallback */ }
  }
  const atc = await place(snap.controllers, known);
  return { network: snap.network, updatedAt: snap.updatedAt, pilots: snap.pilots, controllers: snap.controllers, atc };
}

/* ---------------- METARs on the map ---------------- */
export interface MetarDot { icao: string; lat: number; lon: number; category: string; raw: string; wind: string; temp: string }
export async function getMetarsInView(bbox: [number, number, number, number]): Promise<MetarDot[]> {
  const [w, s, e, n] = bbox.map((v) => Math.round(v * 100) / 100) as [number, number, number, number];
  const url = `https://aviationweather.gov/api/data/metar?bbox=${s},${w},${n},${e}&format=json`;
  const b = activeBridge();
  let list: any[];
  try {
    if (!b) throw new Error("no bridge");
    list = await b.get<any[]>(`/api/ext/metarbox?bbox=${s},${w},${n},${e}`);
  } catch {
    list = await direct(url);
  }
  return (Array.isArray(list) ? list : []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon)).slice(0, 600).map((m) => ({
    icao: String(m.icaoId), lat: m.lat, lon: m.lon, category: String(m.fltCat ?? m.fltcat ?? ""), raw: String(m.rawOb ?? ""),
    wind: m.wdir != null && m.wspd != null ? `${m.wdir === "VRB" ? "VRB" : String(m.wdir).padStart(3, "0")}/${m.wspd}${m.wgst ? `G${m.wgst}` : ""} kt` : "",
    temp: m.temp != null ? `${Math.round(m.temp)}°C` : "",
  }));
}
