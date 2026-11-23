/** SimBrief's latest OFP (JSON v2) → Glidepath's flight plan. Shared by the Bridge and the app. */
import type { FlightPlan } from "./index";

const LB_TO_KG = 0.45359237;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The public SimBrief fetcher URL for a username or numeric Pilot ID. */
export function simbriefUrl(user: string): string {
  const u = user.trim();
  return `https://www.simbrief.com/api/xml.fetcher.php?${/^\d+$/.test(u) ? "userid" : "username"}=${encodeURIComponent(u)}&json=v2`;
}

/** SimBrief OFP (JSON v2) → the compact plan the app needs. */
/** Seconds from "754" or "00:12:34" (newer plans). */
const secs = (v: unknown): number | null => {
  if (typeof v === "string" && /^\d{1,3}:\d{2}(:\d{2})?$/.test(v.trim())) { const p = v.trim().split(":").map(Number); return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p[0]! * 60 + p[1]!; }
  return num(v);
};

export function parseSimbrief(j: any, now = Date.now()): FlightPlan {
  if (j?.fetch?.status && !/success/i.test(j.fetch.status)) throw new Error(`SimBrief: ${j.fetch.status}`);
  const units: "kg" | "lb" = /lb/i.test(j?.params?.units ?? "kgs") ? "lb" : "kg";
  const toKg = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(units === "lb" ? n * LB_TO_KG : n); };
  const apt = (a: any) => ({
    icao: String(a?.icao_code ?? "").toUpperCase(), name: str(a?.name), runway: str(a?.plan_rwy),
    lat: num(a?.pos_lat) ?? 0, lon: num(a?.pos_long) ?? 0, elevationFt: num(a?.elevation),
  });
  // Older plans: navlog.fix (one object or a list). Newer ones: navlog is the list itself.
  const nav = j?.navlog;
  const fixesRaw: any[] = Array.isArray(nav) ? nav : nav?.fix ? (Array.isArray(nav.fix) ? nav.fix : [nav.fix]) : Array.isArray(nav?.fixes) ? nav.fixes : [];
  // SID and STAR: SimBrief flags their fixes (is_sid_star) and names the procedure in via_airway.
  // The flagged run at the start of the route is the SID, the one at the end is the STAR.
  const flagged = (f: any) => String(f?.is_sid_star ?? "0") === "1" && str(f?.via_airway) !== null && !/^DCT$/i.test(String(f?.via_airway));
  let firstPlain = fixesRaw.findIndex((f: any) => !flagged(f) && String(f?.type ?? "") !== "apt");
  if (firstPlain < 0) firstPlain = fixesRaw.length;
  let lastPlain = -1;
  for (let i = fixesRaw.length - 1; i >= 0; i--) if (!flagged(fixesRaw[i]) && String(fixesRaw[i]?.type ?? "") !== "apt") { lastPlain = i; break; }
  const sid = firstPlain > 0 && flagged(fixesRaw[0]) ? str(fixesRaw[0].via_airway) : null;
  const starIdx = lastPlain >= 0 && lastPlain < fixesRaw.length - 1 ? fixesRaw.findIndex((f: any, i: number) => i > lastPlain && flagged(f)) : -1;
  const star = starIdx >= 0 ? str(fixesRaw[starIdx].via_airway) : null;
  const fixes = fixesRaw
    .map((f: any, i: number) => ({ ident: String(f.ident ?? ""), lat: num(f.pos_lat), lon: num(f.pos_long), altitudeFt: num(f.altitude_feet),
      name: str(f.name), via: str(f.via_airway), kind: str(f.type),
      legNm: num(f.distance), timeS: secs(f.time_total), fuelKg: toKg(f.fuel_plan_onboard),
      trackDeg: num(f.track_mag ?? f.track_true), windDirDeg: num(f.wind_dir), windKt: num(f.wind_spd), oatC: num(f.oat),
      proc: sid && i < firstPlain && flagged(f) ? "sid" as const : star && i > lastPlain && flagged(f) ? "star" as const : null }))
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
    sid, star,
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
    costIndex: str(j?.general?.costindex ?? j?.general?.cruise_profile),
    avgWindKt: num(j?.general?.avg_wind_comp),
    paxCount: num(j?.weights?.pax_count),
    payloadKg: toKg(j?.weights?.payload), zfwKg: toKg(j?.weights?.est_zfw), towKg: toKg(j?.weights?.est_tow), ldwKg: toKg(j?.weights?.est_ldw),
    fuelTaxiKg: toKg(j?.fuel?.taxi), fuelTakeoffKg: toKg(j?.fuel?.plan_takeoff), fuelContKg: toKg(j?.fuel?.contingency),
    fuelAltnKg: toKg(j?.fuel?.alternate_burn), fuelReserveKg: toKg(j?.fuel?.reserve), fuelExtraKg: toKg(j?.fuel?.extra),
    ofpUrl: j?.files?.directory && j?.files?.pdf?.link ? `${String(j.files.directory)}${String(j.files.pdf.link)}` : null,
  };
}
