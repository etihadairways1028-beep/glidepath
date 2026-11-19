/**
 * Everything a network shares about one pilot, beyond the position on the map.
 * The map list stays small (position, type, route ends); these details are
 * fetched only for the aircraft someone taps. Shared by the Bridge and the app
 * so both read VATSIM, IVAO and SayIntentions the same way.
 */
export type PilotNetwork = "vatsim" | "ivao" | "sayintentions";

export interface PilotDetails {
  network: PilotNetwork;
  callsign: string;
  /** Network member ID (VATSIM CID, IVAO VID). */
  pilotId: string | null;
  rating: string | null;
  server: string | null;
  /** When this pilot connected (ISO time). */
  onlineSince: string | null;
  squawk: string | null;
  assignedSquawk: string | null;
  rules: "IFR" | "VFR" | null;
  /** ICAO type designator, e.g. A359. */
  type: string | null;
  /** Model name if the network sends one, e.g. "A350-900". */
  model: string | null;
  wake: string | null;
  registration: string | null;
  /** Operator ICAO code from the flight plan (OPR/), if filed. */
  operator: string | null;
  dep: string | null;
  arr: string | null;
  alternate: string | null;
  /** Filed cruise level, e.g. "FL340" or "8,500 ft". */
  cruiseLevel: string | null;
  cruiseTasKt: number | null;
  route: string | null;
  remarks: string | null;
  /** Voice, text only or receive only, from /V/ /T/ /R/ in remarks. */
  voice: "Voice" | "Text only" | "Receive voice" | null;
  /** Filed departure time, HHMM UTC. */
  depTimeZ: string | null;
  eteMin: number | null;
  enduranceMin: number | null;
  pob: number | null;
  /** IVAO's flight state, e.g. "En Route", "Boarding". */
  state: string | null;
  onGround: boolean | null;
  qnhHpa: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** "1245" (HHMM) -> 765 minutes. */
const hhmmMin = (v: unknown): number | null => {
  const s = str(v);
  if (!s || !/^\d{1,4}$/.test(s)) return null;
  const p = s.padStart(4, "0");
  const m = Number(p.slice(0, 2)) * 60 + Number(p.slice(2));
  return m > 0 ? m : null;
};
const secMin = (v: unknown): number | null => { const n = num(v); return n && n > 0 ? Math.round(n / 60) : null; };
const ft = (n: number) => `${Math.round(n).toLocaleString("en-US")} ft`;

/** "34000", "FL340", "F340", "A085", "S1130" (metres) -> a readable level. */
export function readLevel(v: unknown): string | null {
  const s = str(v)?.toUpperCase();
  if (!s) return null;
  if (s === "VFR") return "VFR";
  let m = s.match(/^F(?:L)?(\d{2,3})$/);
  if (m) return `FL${m[1]!.padStart(3, "0")}`;
  m = s.match(/^A(\d{2,3})$/);
  if (m) return ft(Number(m[1]) * 100);
  m = s.match(/^[SM](\d{3,4})$/);
  if (m) return `${(Number(m[1]) * 10).toLocaleString("en-US")} m`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n >= 18000 ? `FL${String(Math.round(n / 100)).padStart(3, "0")}` : ft(n);
  return null;
}

/** "N0480" (knots), "M082" (Mach, left as-is), "K0890" (km/h) -> knots where possible. */
export function readSpeed(v: unknown): number | null {
  const s = str(v)?.toUpperCase();
  if (!s) return null;
  let m = s.match(/^N(\d{3,4})$/);
  if (m) return Number(m[1]);
  m = s.match(/^K(\d{3,4})$/);
  if (m) return Math.round(Number(m[1]) / 1.852);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const VOICE: Record<string, PilotDetails["voice"]> = { V: "Voice", T: "Text only", R: "Receive voice" };
function fromRemarks(remarks: string | null) {
  const r = remarks ?? "";
  const reg = r.match(/\bREG\/([A-Z0-9-]{3,10})\b/i)?.[1]?.toUpperCase() ?? null;
  const opr = r.match(/\bOPR\/([A-Z]{3})\b/i)?.[1]?.toUpperCase() ?? null;
  const v = r.match(/(?:^|\s)\/([VTR])\/(?:\s|$)/i)?.[1]?.toUpperCase();
  return { reg, opr, voice: v ? VOICE[v] ?? null : null };
}

const VATSIM_RATING: Record<number, string> = { 0: "Basic member", 1: "Private pilot", 3: "Instrument rating", 7: "Commercial multi-engine", 15: "Airline transport pilot", 31: "Flight instructor", 63: "Flight examiner" };
const IVAO_RATING: Record<number, string> = { 2: "FS1 Basic flight student", 3: "FS2 Flight student", 4: "FS3 Advanced flight student", 5: "PP Private pilot", 6: "SPP Senior private pilot", 7: "CP Commercial pilot", 8: "ATP Airline transport pilot", 9: "SFI Senior flight instructor", 10: "CFI Chief flight instructor" };

function empty(network: PilotNetwork, callsign: string): PilotDetails {
  return { network, callsign, pilotId: null, rating: null, server: null, onlineSince: null, squawk: null, assignedSquawk: null, rules: null, type: null, model: null, wake: null, registration: null, operator: null, dep: null, arr: null, alternate: null, cruiseLevel: null, cruiseTasKt: null, route: null, remarks: null, voice: null, depTimeZ: null, eteMin: null, enduranceMin: null, pob: null, state: null, onGround: null, qnhHpa: null };
}
const rules = (v: unknown): PilotDetails["rules"] => { const s = str(v)?.toUpperCase(); return s === "I" || s === "IFR" ? "IFR" : s === "V" || s === "VFR" ? "VFR" : s === "Y" || s === "Z" ? "IFR" : null; };
const hhmmZ = (v: unknown): string | null => { const s = str(v); return s && /^\d{3,4}$/.test(s) && s !== "0000" ? s.padStart(4, "0") : null; };

/** The SayIntentions callsign, worked out the same way as on the map. */
export const sayIntentionsCallsign = (p: any) => String(p?.flight_icao || p?.tail_number || p?.displayname || p?.flight_id || "SI");

/** Find one pilot in a network's raw feed and read every detail it shares. */
export function pilotDetails(network: PilotNetwork, feed: any, callsign: string): PilotDetails | null {
  const cs = callsign.trim().toUpperCase();
  if (network === "vatsim") {
    const p = (feed?.pilots ?? []).find((x: any) => String(x?.callsign).toUpperCase() === cs);
    if (!p) return null;
    const fp = p.flight_plan ?? {};
    const remarks = str(fp.remarks), rm = fromRemarks(remarks);
    const table = new Map<number, string>((feed?.pilot_ratings ?? []).map((r: any) => [Number(r.id), String(r.long_name ?? r.short_name)]));
    // ICAO form "A359/H-SDE..." carries the wake category after the type; FAA form "H/A359/L" puts H (heavy) or J (super) first.
    const wake = str(fp.aircraft)?.match(/^[A-Z0-9]{2,4}\/([LMHJ])\b/)?.[1] ?? str(fp.aircraft_faa)?.match(/^([HJ])\//)?.[1] ?? null;
    return {
      ...empty("vatsim", String(p.callsign)),
      pilotId: str(p.cid), rating: table.get(Number(p.pilot_rating)) ?? VATSIM_RATING[Number(p.pilot_rating)] ?? null,
      server: str(p.server), onlineSince: str(p.logon_time),
      squawk: str(p.transponder), assignedSquawk: str(fp.assigned_transponder) && fp.assigned_transponder !== "0000" ? str(fp.assigned_transponder) : null,
      rules: rules(fp.flight_rules), type: str(fp.aircraft_short), wake, registration: rm.reg, operator: rm.opr,
      dep: str(fp.departure), arr: str(fp.arrival), alternate: str(fp.alternate),
      cruiseLevel: readLevel(fp.altitude), cruiseTasKt: readSpeed(fp.cruise_tas), route: str(fp.route), remarks, voice: rm.voice,
      depTimeZ: hhmmZ(fp.deptime), eteMin: hhmmMin(fp.enroute_time), enduranceMin: hhmmMin(fp.fuel_time),
      qnhHpa: num(p.qnh_mb),
    };
  }
  if (network === "ivao") {
    const p = (feed?.clients?.pilots ?? []).find((x: any) => String(x?.callsign).toUpperCase() === cs);
    if (!p) return null;
    const fp = p.flightPlan ?? {}, t = p.lastTrack ?? {}, ac = fp.aircraft ?? {};
    const remarks = str(fp.remarks), rm = fromRemarks(remarks);
    const dt = num(fp.departureTime);
    return {
      ...empty("ivao", String(p.callsign)),
      pilotId: str(p.userId), rating: IVAO_RATING[Number(p.rating)] ?? null, server: str(p.serverId),
      onlineSince: str(p.createdAt) ?? (num(p.time) !== null ? new Date(Date.now() - num(p.time)! * 1000).toISOString() : null),
      squawk: num(t.transponder) !== null ? String(num(t.transponder)).padStart(4, "0") : null,
      rules: rules(fp.flightRules), type: str(fp.aircraftId) ?? str(ac.icaoCode), model: str(ac.model), wake: str(ac.wakeTurbulence),
      registration: rm.reg, operator: rm.opr,
      dep: str(fp.departureId), arr: str(fp.arrivalId), alternate: str(fp.alternativeId),
      cruiseLevel: readLevel(fp.level), cruiseTasKt: readSpeed(fp.speed), route: str(fp.route), remarks, voice: rm.voice,
      depTimeZ: dt !== null && dt > 0 ? `${String(Math.floor(dt / 3600) % 24).padStart(2, "0")}${String(Math.floor((dt % 3600) / 60)).padStart(2, "0")}` : null,
      eteMin: secMin(fp.eet), enduranceMin: secMin(fp.endurance), pob: num(fp.peopleOnBoard),
      state: str(t.state), onGround: typeof t.onGround === "boolean" ? t.onGround : null,
    };
  }
  const list: any[] = Array.isArray(feed) ? feed : Array.isArray(feed?.flights) ? feed.flights : [];
  const p = list.find((x) => sayIntentionsCallsign(x).toUpperCase() === cs);
  if (!p) return null;
  return {
    ...empty("sayintentions", sayIntentionsCallsign(p)),
    type: str(p.aircraft_icao), registration: str(p.tail_number), dep: str(p.origin), arr: str(p.final_destination),
    rules: rules(p.flight_rules), squawk: str(p.squawk ?? p.transponder),
  };
}
