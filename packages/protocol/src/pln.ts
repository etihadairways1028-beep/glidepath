/**
 * Microsoft Flight Simulator flight plan files (.PLN, the "SimBase.Document" XML that the
 * world map, Little Navmap and most planners write) → Glidepath's flight plan.
 */
import type { FlightPlan } from "./index";

const tag = (s: string, name: string): string | null => {
  const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1]!.trim() : null;
};
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** "N51° 28' 13.10",W0° 27' 40.98",+000083.00" → lat, lon, feet. */
export function parseWorldPosition(p: string): { lat: number; lon: number; altFt: number | null } | null {
  const parts = p.split(",");
  if (parts.length < 2) return null;
  const one = (t: string): number | null => {
    const m = t.trim().match(/^([NSEW])\s*(\d+(?:\.\d+)?)°?\s*(?:(\d+(?:\.\d+)?)'?)?\s*(?:(\d+(?:\.\d+)?)"?)?/i);
    if (!m) return null;
    const v = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
    return /[SW]/i.test(m[1]!) ? -v : v;
  };
  const lat = one(parts[0]!), lon = one(parts[1]!);
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = parts[2] ? Number(parts[2].trim()) : NaN;
  return { lat, lon, altFt: Number.isFinite(alt) ? alt : null };
}

const nmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, dφ = (b.lat - a.lat) * r, dλ = (b.lon - a.lon) * r;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dλ / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
};

export function parsePln(xml: string, now = Date.now()): FlightPlan {
  const fp = tag(xml, "FlightPlan.FlightPlan");
  if (!fp) throw new Error("This isn't a Microsoft Flight Simulator flight plan.");
  const wps = [...fp.matchAll(/<ATCWaypoint(?:\s+id="([^"]*)")?[^>]*>([\s\S]*?)<\/ATCWaypoint>/gi)].map((m) => {
    const body = m[2]!;
    const pos = parseWorldPosition(tag(body, "WorldPosition") ?? "");
    const ident = (tag(body, "ICAOIdent") ?? m[1] ?? "").trim().toUpperCase();
    return pos ? { ident, type: (tag(body, "ATCWaypointType") ?? "").toLowerCase(), pos, via: tag(body, "ATCAirway"), dep: tag(body, "DepartureFP"), arr: tag(body, "ArrivalFP"), app: tag(body, "ApproachTypeFP"), rwy: tag(body, "RunwayNumberFP"), rwyDes: tag(body, "RunwayDesignatorFP"), alt: tag(body, "AltitudeFP") } : null;
  }).filter((w): w is NonNullable<typeof w> => !!w && !!w.ident);
  if (wps.length < 2) throw new Error("This flight plan has no waypoints.");
  const depId = (tag(fp, "DepartureID") ?? wps[0]!.ident).toUpperCase();
  const dstId = (tag(fp, "DestinationID") ?? wps[wps.length - 1]!.ident).toUpperCase();
  const depPos = parseWorldPosition(tag(fp, "DepartureLLA") ?? "") ?? wps[0]!.pos;
  const dstPos = parseWorldPosition(tag(fp, "DestinationLLA") ?? "") ?? wps[wps.length - 1]!.pos;
  const cruise = Number(tag(fp, "CruisingAlt"));
  const first = wps[0]!.ident === depId ? 1 : 0;
  const last = wps[wps.length - 1]!.ident === dstId ? wps.length - 1 : wps.length;
  const mid = wps.slice(first, last);
  const sid = mid.find((w) => w.dep)?.dep ?? null;
  const star = mid.find((w) => w.arr)?.arr ?? null;
  const rw = (n: string | null, d: string | null) => n ? `${n.padStart(2, "0")}${d && /^(LEFT|RIGHT|CENTER|L|R|C)$/i.test(d) ? d[0]!.toUpperCase() : ""}` : null;
  const depRwy = rw(tag(fp, "DepartureRunway") ?? (wps[0]!.ident === depId ? wps[0]!.rwy : null) ?? wps[first]?.rwy ?? null, null);
  let prev = depPos;
  const fixes = mid.map((w) => {
    const legNm = Math.round(nmBetween(prev, w.pos) * 10) / 10; prev = w.pos;
    const alt = w.alt ? Number(w.alt) : w.pos.altFt;
    return { ident: w.ident, lat: w.pos.lat, lon: w.pos.lon, altitudeFt: alt && Number.isFinite(alt) && alt > 0 ? Math.round(alt) : null,
      proc: w.dep ? "sid" as const : w.arr || w.app ? "star" as const : null, name: null, via: w.via ? unxml(w.via) : w.dep ?? w.arr ?? null, kind: w.type || null, legNm, timeS: null, fuelKg: null, trackDeg: null, windDirDeg: null, windKt: null, oatC: null };
  });
  let dist = 0; { let p: { lat: number; lon: number } = depPos; for (const f of fixes) { dist += nmBetween(p, f); p = f; } dist += nmBetween(p, dstPos); }
  // A readable ATC route: SID, then airway/fix pairs, then STAR.
  const route: string[] = [];
  if (sid) route.push(sid);
  for (const f of fixes) { if (f.proc) continue; if (f.via && f.via !== route[route.length - 2]) route.push(f.via); else if (!f.via) route.push("DCT"); route.push(f.ident); }
  if (star) route.push(star);
  return {
    source: "msfs", ofpId: null, callsign: null, flightNumber: null, airline: null, aircraftIcao: null, registration: null,
    origin: { icao: depId, name: tag(fp, "DepartureName") ? unxml(tag(fp, "DepartureName")!) : null, runway: depRwy, lat: depPos.lat, lon: depPos.lon, elevationFt: depPos.altFt },
    destination: { icao: dstId, name: tag(fp, "DestinationName") ? unxml(tag(fp, "DestinationName")!) : null, runway: null, lat: dstPos.lat, lon: dstPos.lon, elevationFt: dstPos.altFt },
    alternate: null, route: route.join(" ").replace(/\bDCT DCT\b/g, "DCT"), sid, star, fixes,
    cruiseAltitudeFt: Number.isFinite(cruise) && cruise > 0 ? cruise : null, distanceNm: Math.round(dist),
    scheduledOut: null, scheduledOff: null, scheduledOn: null, scheduledIn: null, blockTimeS: null, airTimeS: null,
    originUtcOffsetH: null, destinationUtcOffsetH: null, fuelUnits: "kg", fuelRampKg: null, fuelBurnKg: null, fuelLandingKg: null, fetchedAt: now,
  };
}
