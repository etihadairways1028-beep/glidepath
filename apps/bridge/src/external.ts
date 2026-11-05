/**
 * External aviation data, fetched by the Bridge on behalf of every device on
 * the user's network. Browsers cannot call most of these services directly
 * (CORS) and the networks ask apps not to poll their feeds from every client.
 * Doing it here means one cached request per interval for the whole household.
 *
 * Sources and refresh limits:
 *  - VATSIM data feed v3      https://data.vatsim.net/v3/vatsim-data.json   ≥15 s (the feed's own refresh)
 *  - IVAO Whazzup v2          https://api.ivao.aero/v2/tracker/whazzup       ≥30 s
 *  - METAR / TAF              https://aviationweather.gov/api/data/…         5 min per station
 *  - SimBrief latest OFP      https://www.simbrief.com/api/xml.fetcher.php   60 s per user
 *  - Stands / gates           OpenStreetMap via Overpass API                 cached per location for the session
 *
 * Parsers are pure functions (exported for tests). Network failures return a
 * clear error; nothing is ever invented to fill a gap.
 */
import type { FlightPlan } from "@glidepath/protocol";
import { distanceNm } from "@glidepath/flight-engine";
import type { Logger } from "./log.js";

const UA = "GlidepathBridge/0.1 (+https://github.com/etihadairways1028-beep/glidepath)";
const LB_TO_KG = 0.45359237;

export interface NetworkPilot { callsign: string; lat: number; lon: number; altFt: number; gsKt: number; hdg: number; type: string | null; dep: string | null; arr: string | null; network: "vatsim" | "ivao" }
export interface NetworkController { callsign: string; frequency: string | null; facility: string; atis: string[]; network: "vatsim" | "ivao" }
export interface NetworkSnapshot { network: "vatsim" | "ivao"; updatedAt: string; pilots: NetworkPilot[]; controllers: NetworkController[] }
export interface Metar { icao: string; raw: string; observed: string | null; windDir: number | "VRB" | null; windKt: number | null; gustKt: number | null; visibility: string | null; tempC: number | null; dewC: number | null; qnhHpa: number | null; category: string | null; clouds: Array<{ cover: string; baseFt: number | null }> }
export interface Taf { icao: string; raw: string; issued: string | null }
export interface Stand { ref: string; kind: "gate" | "stand"; lat: number; lon: number; distanceM: number }

/* ---------------- parsers ---------------- */

const FACILITY: Record<number, string> = { 0: "Observer", 1: "Flight service", 2: "Delivery", 3: "Ground", 4: "Tower", 5: "Approach", 6: "Centre" };

export function parseVatsim(j: any): NetworkSnapshot {
  const pilots: NetworkPilot[] = (j?.pilots ?? []).filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map((p: any) => ({
    callsign: String(p.callsign), lat: p.latitude, lon: p.longitude, altFt: p.altitude ?? 0, gsKt: p.groundspeed ?? 0, hdg: p.heading ?? 0,
    type: p.flight_plan?.aircraft_short || null, dep: p.flight_plan?.departure || null, arr: p.flight_plan?.arrival || null, network: "vatsim" as const,
  }));
  const ctl = [...(j?.controllers ?? []), ...(j?.atis ?? [])];
  const controllers: NetworkController[] = ctl.filter((c: any) => c.facility !== 0).map((c: any) => ({
    callsign: String(c.callsign), frequency: c.frequency && c.frequency !== "199.998" ? String(c.frequency) : null,
    facility: /_ATIS$/.test(c.callsign) ? "ATIS" : FACILITY[c.facility] ?? "ATC", atis: Array.isArray(c.text_atis) ? c.text_atis.map(String) : [], network: "vatsim" as const,
  }));
  return { network: "vatsim", updatedAt: j?.general?.update_timestamp ?? new Date().toISOString(), pilots, controllers };
}

export function parseIvao(j: any): NetworkSnapshot {
  const pilots: NetworkPilot[] = (j?.clients?.pilots ?? []).filter((p: any) => p.lastTrack && Number.isFinite(p.lastTrack.latitude)).map((p: any) => ({
    callsign: String(p.callsign), lat: p.lastTrack.latitude, lon: p.lastTrack.longitude, altFt: p.lastTrack.altitude ?? 0, gsKt: p.lastTrack.groundSpeed ?? 0,
    hdg: p.lastTrack.heading ?? 0, type: p.flightPlan?.aircraftId || p.flightPlan?.aircraft?.icaoCode || null,
    dep: p.flightPlan?.departureId || null, arr: p.flightPlan?.arrivalId || null, network: "ivao" as const,
  }));
  const controllers: NetworkController[] = (j?.clients?.atcs ?? []).map((c: any) => ({
    callsign: String(c.callsign), frequency: c.atcSession?.frequency ? Number(c.atcSession.frequency).toFixed(3) : null,
    facility: /_ATIS$/.test(c.callsign) ? "ATIS" : String(c.atcSession?.position ?? "ATC"), atis: Array.isArray(c.atis?.lines) ? c.atis.lines.map(String) : [], network: "ivao" as const,
  }));
  return { network: "ivao", updatedAt: j?.updatedAt ?? new Date().toISOString(), pilots, controllers };
}

export function parseMetars(j: any): Metar[] {
  return (Array.isArray(j) ? j : []).map((m: any) => ({
    icao: String(m.icaoId), raw: String(m.rawOb ?? ""), observed: m.reportTime ?? null,
    windDir: m.wdir === "VRB" ? "VRB" : Number.isFinite(m.wdir) ? m.wdir : null, windKt: Number.isFinite(m.wspd) ? m.wspd : null,
    gustKt: Number.isFinite(m.wgst) ? m.wgst : null, visibility: m.visib === undefined || m.visib === null ? null : String(m.visib),
    tempC: Number.isFinite(m.temp) ? m.temp : null, dewC: Number.isFinite(m.dewp) ? m.dewp : null,
    qnhHpa: Number.isFinite(m.altim) ? Math.round(m.altim) : null, category: m.fltCat ?? null,
    clouds: Array.isArray(m.clouds) ? m.clouds.map((c: any) => ({ cover: String(c.cover), baseFt: Number.isFinite(c.base) ? c.base : null })) : [],
  }));
}

export function parseTafs(j: any): Taf[] {
  return (Array.isArray(j) ? j : []).map((t: any) => ({ icao: String(t.icaoId), raw: String(t.rawTAF ?? ""), issued: t.issueTime ?? null }));
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** SimBrief OFP (JSON v2) → the compact plan the app needs. */
export function parseSimbrief(j: any, now = Date.now()): FlightPlan {
  if (j?.fetch?.status && !/success/i.test(j.fetch.status)) throw new Error(`SimBrief: ${j.fetch.status}`);
  const units: "kg" | "lb" = /lb/i.test(j?.params?.units ?? "kgs") ? "lb" : "kg";
  const toKg = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(units === "lb" ? n * LB_TO_KG : n); };
  const apt = (a: any) => ({
    icao: String(a?.icao_code ?? "").toUpperCase(), name: str(a?.name), runway: str(a?.plan_rwy),
    lat: num(a?.pos_lat) ?? 0, lon: num(a?.pos_long) ?? 0, elevationFt: num(a?.elevation),
  });
  const fixesRaw = j?.navlog?.fix ? (Array.isArray(j.navlog.fix) ? j.navlog.fix : [j.navlog.fix]) : [];
  const fixes = fixesRaw
    .map((f: any) => ({ ident: String(f.ident ?? ""), lat: num(f.pos_lat), lon: num(f.pos_long), altitudeFt: num(f.altitude_feet) }))
    .filter((f: any) => f.lat !== null && f.lon !== null) as FlightPlan["fixes"];
  const origin = apt(j?.origin);
  const destination = apt(j?.destination);
  if (!origin.icao || !destination.icao) throw new Error("SimBrief returned a plan without origin or destination");
  return {
    source: "simbrief",
    ofpId: str(j?.params?.request_id),
    callsign: str(j?.atc?.callsign),
    flightNumber: str(j?.general?.flight_number),
    airline: str(j?.general?.icao_airline),
    aircraftIcao: str(j?.aircraft?.icaocode ?? j?.aircraft?.icao_code),
    registration: str(j?.aircraft?.reg),
    origin, destination,
    alternate: str(j?.alternate?.icao_code),
    route: String(j?.general?.route ?? j?.atc?.route ?? ""),
    fixes,
    cruiseAltitudeFt: num(j?.general?.initial_altitude),
    distanceNm: num(j?.general?.route_distance ?? j?.general?.gc_distance),
    scheduledOut: num(j?.times?.sched_out), scheduledOff: num(j?.times?.sched_off),
    scheduledOn: num(j?.times?.sched_on), scheduledIn: num(j?.times?.sched_in),
    blockTimeS: num(j?.times?.sched_block ?? j?.times?.est_block), airTimeS: num(j?.times?.est_time_enroute),
    originUtcOffsetH: num(j?.times?.orig_timezone), destinationUtcOffsetH: num(j?.times?.dest_timezone),
    fuelUnits: units,
    fuelRampKg: toKg(j?.fuel?.plan_ramp), fuelBurnKg: toKg(j?.fuel?.enroute_burn), fuelLandingKg: toKg(j?.fuel?.plan_landing),
    fetchedAt: now,
  };
}

export function parseStands(j: any, at: { lat: number; lon: number }): Stand[] {
  const out: Stand[] = [];
  for (const e of j?.elements ?? []) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const ref = str(e.tags?.ref) ?? str(e.tags?.name);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ref) continue;
    out.push({ ref, kind: e.tags?.aeroway === "gate" ? "gate" : "stand", lat, lon, distanceM: Math.round(distanceNm(at, { lat, lon }) * 1852) });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/* ---------------- fetching with caches ---------------- */

interface Entry<T> { at: number; value?: T; error?: string; pending?: Promise<T> }

export class ExternalData {
  private cache = new Map<string, Entry<unknown>>();
  private readonly log: Logger;
  constructor(log: Logger, private readonly fetchImpl: typeof fetch = fetch) {
    this.log = log.child("external");
  }

  vatsim(): Promise<NetworkSnapshot> {
    return this.cached("vatsim", 15_000, async () => parseVatsim(await this.json("https://data.vatsim.net/v3/vatsim-data.json")));
  }
  ivao(): Promise<NetworkSnapshot> {
    return this.cached("ivao", 30_000, async () => parseIvao(await this.json("https://api.ivao.aero/v2/tracker/whazzup")));
  }
  metar(ids: string[]): Promise<Metar[]> {
    const list = clean(ids);
    return this.cached(`metar:${list.join(",")}`, 300_000, async () =>
      parseMetars(await this.json(`https://aviationweather.gov/api/data/metar?ids=${list.join(",")}&format=json`)));
  }
  taf(ids: string[]): Promise<Taf[]> {
    const list = clean(ids);
    return this.cached(`taf:${list.join(",")}`, 600_000, async () =>
      parseTafs(await this.json(`https://aviationweather.gov/api/data/taf?ids=${list.join(",")}&format=json`)));
  }
  simbrief(user: string): Promise<FlightPlan> {
    const u = user.trim();
    if (!/^[\w.\- ]{1,64}$/.test(u)) return Promise.reject(new Error("That doesn't look like a SimBrief username or Pilot ID"));
    const q = /^\d+$/.test(u) ? `userid=${u}` : `username=${encodeURIComponent(u)}`;
    return this.cached(`simbrief:${u.toLowerCase()}`, 60_000, async () =>
      parseSimbrief(await this.json(`https://www.simbrief.com/api/xml.fetcher.php?${q}&json=v2`, true)));
  }
  stands(lat: number, lon: number): Promise<Stand[]> {
    const key = `stands:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const query = `[out:json][timeout:15];(nwr(around:120,${lat},${lon})["aeroway"~"^(parking_position|gate)$"];);out center tags;`;
    return this.cached(key, 24 * 3600_000, async () => {
      const res = await this.fetchImpl("https://overpass-api.de/api/interpreter", {
        method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`OpenStreetMap stand lookup failed (HTTP ${res.status})`);
      return parseStands(await res.json(), { lat, lon });
    });
  }

  private async json(url: string, allow400 = false): Promise<any> {
    const res = await this.fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 204) return [];
    if (!res.ok && !(allow400 && res.status === 400)) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
    const body: any = await res.json().catch(() => {
      throw new Error(`${new URL(url).host} returned something that isn't JSON`);
    });
    if (allow400 && res.status === 400) throw new Error(`SimBrief: ${body?.fetch?.status ?? "user or plan not found"}`);
    return body;
  }

  /** Serve from cache while fresh; one in-flight request per key; keep stale data on errors. */
  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const e = this.cache.get(key) as Entry<T> | undefined;
    const now = Date.now();
    if (e?.value !== undefined && now - e.at < ttl) return e.value;
    if (e?.pending) return e.pending;
    const pending = load().then(
      (value) => { this.cache.set(key, { at: Date.now(), value }); return value; },
      (err: Error) => {
        this.log.warn(`${key.split(":")[0]} unavailable: ${err.message}`);
        if (e?.value !== undefined) { this.cache.set(key, { ...e, pending: undefined }); return e.value; } // stale but real
        this.cache.delete(key);
        throw err;
      },
    );
    this.cache.set(key, { at: e?.at ?? 0, value: e?.value, pending });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return pending;
  }
}

function clean(ids: string[]): string[] {
  return [...new Set(ids.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{3,4}$/.test(s)))].slice(0, 10).sort();
}
