/**
 * External aviation data, fetched by the Bridge on behalf of every device on
 * the user's network. Browsers cannot call most of these services directly
 * (CORS) and the networks ask apps not to poll their feeds from every client.
 * Doing it here means one cached request per interval for the whole household.
 *
 * Sources and refresh limits:
 *  - VATSIM data feed v3      https://data.vatsim.net/v3/vatsim-data.json   ≥15 s (the feed's own refresh)
 *  - IVAO Whazzup v2          https://api.ivao.aero/v2/tracker/whazzup       ≥30 s
 *  - SayIntentions tracker    https://tracker.sayintentions.ai/api/map        ≥30 s (public live map feed)
 *  - METAR / TAF              https://aviationweather.gov/api/data/…         5 min per station
 *  - SimBrief latest OFP      https://www.simbrief.com/api/xml.fetcher.php   60 s per user
 *  - Stands / gates           OpenStreetMap via Overpass API                 cached per location for the session
 *
 * Parsers are pure functions (exported for tests). Network failures return a
 * clear error; nothing is ever invented to fill a gap.
 */
import { pilotDetails, type FlightPlan, type PilotDetails, type PilotNetwork } from "@glidepath/protocol";
import { distanceNm } from "@glidepath/flight-engine";
import type { Logger } from "./log.js";
import { TrafficTracks } from "./traffic.js";

const UA = "GlidepathBridge/0.1 (+https://github.com/etihadairways1028-beep/glidepath)";
const LB_TO_KG = 0.45359237;

export interface NetworkPilot { callsign: string; lat: number; lon: number; altFt: number; gsKt: number; hdg: number; type: string | null; dep: string | null; arr: string | null; network: Network; squawk?: string | null }
export type Network = "vatsim" | "ivao" | "sayintentions";
export interface NetworkController { callsign: string; frequency: string | null; facility: string; atis: string[]; network: Network }
export interface NetworkSnapshot { network: Network; updatedAt: string; pilots: NetworkPilot[]; controllers: NetworkController[] }
export type { Metar, Taf } from "@glidepath/protocol";
import { parseMetars, parseTafs, type Metar, type Taf } from "@glidepath/protocol";
export interface Stand { ref: string; kind: "gate" | "stand"; lat: number; lon: number; distanceM: number }

/* ---------------- parsers ---------------- */

const FACILITY: Record<number, string> = { 0: "Observer", 1: "Flight service", 2: "Delivery", 3: "Ground", 4: "Tower", 5: "Approach", 6: "Centre" };

export function parseVatsim(j: any): NetworkSnapshot {
  const pilots: NetworkPilot[] = (j?.pilots ?? []).filter((p: any) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map((p: any) => ({
    callsign: String(p.callsign), lat: p.latitude, lon: p.longitude, altFt: p.altitude ?? 0, gsKt: p.groundspeed ?? 0, hdg: p.heading ?? 0,
    type: p.flight_plan?.aircraft_short || null, dep: p.flight_plan?.departure || null, arr: p.flight_plan?.arrival || null, network: "vatsim" as const, squawk: p.transponder ? String(p.transponder) : null,
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
    dep: p.flightPlan?.departureId || null, arr: p.flightPlan?.arrivalId || null, network: "ivao" as const, squawk: Number.isFinite(p.lastTrack?.transponder) ? String(p.lastTrack.transponder).padStart(4, "0") : null,
  }));
  const controllers: NetworkController[] = (j?.clients?.atcs ?? []).map((c: any) => ({
    callsign: String(c.callsign), frequency: c.atcSession?.frequency ? Number(c.atcSession.frequency).toFixed(3) : null,
    facility: /_ATIS$/.test(c.callsign) ? "ATIS" : String(c.atcSession?.position ?? "ATC"), atis: Array.isArray(c.atis?.lines) ? c.atis.lines.map(String) : [], network: "ivao" as const,
  }));
  return { network: "ivao", updatedAt: j?.updatedAt ?? new Date().toISOString(), pilots, controllers };
}

/** SayIntentions.AI public tracker: a top-level array of active flights. ATC is AI, so no controllers. */
export function parseSayIntentions(j: any): NetworkSnapshot {
  const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.flights) ? j.flights : [];
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const pilots: NetworkPilot[] = list
    .map((p) => ({ p, lat: num(p?.lat), lon: num(p?.lon ?? p?.lng ?? p?.longitude) }))
    .filter(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
    .map(({ p, lat, lon }) => ({
      callsign: String(p.flight_icao || p.tail_number || p.displayname || p.flight_id || "SI"),
      lat, lon,
      altFt: Number.isFinite(num(p.altitude)) ? Math.round(num(p.altitude)) : 0,
      gsKt: Number.isFinite(num(p.airspeed)) ? Math.round(num(p.airspeed)) : 0,
      hdg: Number.isFinite(num(p.heading)) ? num(p.heading) : 0,
      type: p.aircraft_icao ? String(p.aircraft_icao) : null,
      dep: p.origin ? String(p.origin) : null,
      arr: p.final_destination ? String(p.final_destination) : null,
      network: "sayintentions" as const,
    }));
  return { network: "sayintentions", updatedAt: new Date().toISOString(), pilots, controllers: [] };
}

export { parseMetars, parseTafs } from "@glidepath/protocol";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

import { parseSimbrief } from "@glidepath/protocol";
export { parseSimbrief };

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

  /** The raw network feeds, kept briefly so the map list and a tapped aircraft's details share one download. */
  private feed(n: PilotNetwork): Promise<any> {
    const url = { vatsim: "https://data.vatsim.net/v3/vatsim-data.json", ivao: "https://api.ivao.aero/v2/tracker/whazzup", sayintentions: "https://tracker.sayintentions.ai/api/map" }[n];
    return this.cached(`feed:${n}`, n === "vatsim" ? 15_000 : 30_000, () => this.json(url));
  }
  /** Other aircraft's tracks, recorded from every network snapshot (see traffic.ts). */
  readonly traffic = new TrafficTracks();
  private snap(n: PilotNetwork, ms: number, parse: (j: any) => NetworkSnapshot, background: boolean): Promise<NetworkSnapshot> {
    if (!background) this.traffic.wanted.set(n, Date.now());
    return this.cached(n, ms, async () => { const s = parse(await this.feed(n)); this.traffic.record(n, s.pilots); return s; });
  }
  vatsim(background = false): Promise<NetworkSnapshot> { return this.snap("vatsim", 15_000, parseVatsim, background); }
  sayintentions(background = false): Promise<NetworkSnapshot> { return this.snap("sayintentions", 30_000, parseSayIntentions, background); }
  ivao(background = false): Promise<NetworkSnapshot> { return this.snap("ivao", 30_000, parseIvao, background); }
  /**
   * Keep recording tracks for the networks an app has used in the last 12 hours, once a minute,
   * so a tapped aircraft shows its whole track even if the app was closed.
   */
  startTrafficRecording(): () => void {
    const t = setInterval(() => {
      const now = Date.now();
      for (const [n, at] of this.traffic.wanted) {
        if (now - at > 12 * 3600_000) { this.traffic.wanted.delete(n); continue; }
        const run = n === "vatsim" ? this.vatsim(true) : n === "ivao" ? this.ivao(true) : this.sayintentions(true);
        run.catch(() => undefined);
      }
    }, 60_000);
    t.unref?.();
    return () => clearInterval(t);
  }
  /** Everything the network shares about one pilot (flight plan, squawk, rating…), for the aircraft someone taps. */
  async pilot(n: string, callsign: string): Promise<PilotDetails | null> {
    if (n !== "vatsim" && n !== "ivao" && n !== "sayintentions") throw new Error("network must be vatsim, ivao or sayintentions");
    if (!/^[A-Za-z0-9_-]{2,12}$/.test(callsign)) throw new Error("callsign is not valid");
    return pilotDetails(n, await this.feed(n), callsign);
  }
  /** Raw aviationweather.gov METARs inside a box (south,west,north,east), for weather dots on the map. */
  metarBox(bbox: string): Promise<unknown[]> {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return Promise.reject(new Error("bbox must be south,west,north,east"));
    const b = parts.map((v) => v.toFixed(1)).join(",");
    return this.cached(`metarbox:${b}`, 300_000, async () => {
      const j = await this.json(`https://aviationweather.gov/api/data/metar?bbox=${b}&format=json`);
      return Array.isArray(j) ? j.slice(0, 600) : [];
    });
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
