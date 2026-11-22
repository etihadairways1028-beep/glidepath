/**
 * Takeoff and landing performance estimates.
 *
 * A simplified model scaled from each type's published airport-planning
 * figures (field length at max weight, sea level, ISA, dry, and landing
 * distance at max landing weight). It accounts for weight, pressure altitude,
 * temperature, wind (50% of headwind, 150% of tailwind, as the rules require),
 * runway condition, flap setting, thrust, autobrake and reversers.
 *
 * It is an estimate for simulator flying, not certified data: the add-on's
 * own EFB (Fenix, PMDG, iniBuilds…) remains the reference.
 */

export type Maker = "airbus" | "boeing" | "other";

export interface PerfType {
  id: string;
  name: string;
  maker: Maker;
  /** ICAO type designators this entry covers. */
  icao: string[];
  mtowKg: number;
  mlwKg: number;
  /** Takeoff field length at MTOW, sea level, ISA, dry, standard flaps, full thrust. */
  toflFt: number;
  /** Certified (factored) landing field length at MLW, sea level, dry. */
  ldrFt: number;
  /** V2 at MTOW with standard flaps. */
  v2Kt: number;
  /** VLS / Vref at MLW, landing flaps. */
  vrefKt: number;
  /** Minimum control speed on the ground: V1 never goes below it. */
  vmcgKt: number;
  /** Flat-rated temperature above ISA: full thrust holds up to ISA + this. */
  flatC: number;
  /** Highest assumed temperature the engines allow. */
  flexMaxC: number;
  /** Takeoff flap settings, standard first. */
  toFlaps: string[];
  /** Landing flap settings, standard first. */
  ldgFlaps: string[];
  /** Autobrake settings, strongest last. */
  autobrakes: string[];
  /** Typical CG range, % MAC, for the trim estimate. */
  cg: [number, number, number];
}

const AB_TO = ["1+F", "2", "3"], AB_LD = ["FULL", "3"], AB_AB = ["LO", "MED", "MAX"];
const B7_TO = ["5", "1", "10", "15", "25"], B7_LD = ["30", "40", "25"], B7_AB = ["1", "2", "3", "MAX"];
const BW_TO = ["15", "5", "20"], BW_LD = ["30", "25"];
const RJ_TO = ["2", "1", "3", "4"], RJ_LD = ["5", "FULL"], RJ_AB = ["LO", "MED", "HI"];
const GA_TO = ["T/O", "UP"], GA_LD = ["LDG", "T/O"], GA_AB = ["Manual"];

const ab = (o: Omit<PerfType, "maker" | "toFlaps" | "ldgFlaps" | "autobrakes" | "cg" | "flatC" | "flexMaxC"> & Partial<PerfType>): PerfType =>
  ({ maker: "airbus", toFlaps: AB_TO, ldgFlaps: AB_LD, autobrakes: AB_AB, cg: [17, 28, 40], flatC: 29, flexMaxC: 70, ...o });
const bo = (o: Omit<PerfType, "maker" | "toFlaps" | "ldgFlaps" | "autobrakes" | "cg" | "flatC" | "flexMaxC"> & Partial<PerfType>): PerfType =>
  ({ maker: "boeing", toFlaps: B7_TO, ldgFlaps: B7_LD, autobrakes: B7_AB, cg: [8, 22, 33], flatC: 15, flexMaxC: 70, ...o });

export const PERF_TYPES: PerfType[] = [
  ab({ id: "a319", name: "Airbus A319", icao: ["A318", "A319"], mtowKg: 75500, mlwKg: 62500, toflFt: 6400, ldrFt: 4800, v2Kt: 145, vrefKt: 130, vmcgKt: 107 }),
  ab({ id: "a19n", name: "Airbus A319neo", icao: ["A19N"], mtowKg: 75500, mlwKg: 63900, toflFt: 6200, ldrFt: 4900, v2Kt: 144, vrefKt: 131, vmcgKt: 107 }),
  ab({ id: "a320", name: "Airbus A320", icao: ["A320"], mtowKg: 78000, mlwKg: 66000, toflFt: 6900, ldrFt: 4900, v2Kt: 151, vrefKt: 134, vmcgKt: 109 }),
  ab({ id: "a20n", name: "Airbus A320neo", icao: ["A20N"], mtowKg: 79000, mlwKg: 67400, toflFt: 6400, ldrFt: 5000, v2Kt: 150, vrefKt: 135, vmcgKt: 109 }),
  ab({ id: "a321", name: "Airbus A321", icao: ["A321"], mtowKg: 93500, mlwKg: 77800, toflFt: 7900, ldrFt: 5400, v2Kt: 160, vrefKt: 141, vmcgKt: 111 }),
  ab({ id: "a21n", name: "Airbus A321neo", icao: ["A21N"], mtowKg: 97000, mlwKg: 79200, toflFt: 8100, ldrFt: 5500, v2Kt: 161, vrefKt: 142, vmcgKt: 111 }),
  ab({ id: "a332", name: "Airbus A330-200", icao: ["A332", "A338"], mtowKg: 242000, mlwKg: 182000, toflFt: 8800, ldrFt: 5700, v2Kt: 162, vrefKt: 136, vmcgKt: 118, flatC: 15, cg: [18, 28, 40] }),
  ab({ id: "a333", name: "Airbus A330-300", icao: ["A333", "A339"], mtowKg: 242000, mlwKg: 187000, toflFt: 9100, ldrFt: 5800, v2Kt: 164, vrefKt: 139, vmcgKt: 118, flatC: 15 }),
  ab({ id: "a346", name: "Airbus A340", icao: ["A342", "A343", "A345", "A346"], mtowKg: 380000, mlwKg: 265000, toflFt: 10300, ldrFt: 6600, v2Kt: 170, vrefKt: 146, vmcgKt: 112, flatC: 15 }),
  ab({ id: "a359", name: "Airbus A350-900", icao: ["A359"], mtowKg: 280000, mlwKg: 207000, toflFt: 8700, ldrFt: 6400, v2Kt: 160, vrefKt: 140, vmcgKt: 115, flatC: 15 }),
  ab({ id: "a35k", name: "Airbus A350-1000", icao: ["A35K"], mtowKg: 319000, mlwKg: 236000, toflFt: 9200, ldrFt: 6600, v2Kt: 165, vrefKt: 145, vmcgKt: 117, flatC: 15 }),
  ab({ id: "a388", name: "Airbus A380", icao: ["A388"], mtowKg: 575000, mlwKg: 394000, toflFt: 9800, ldrFt: 6900, v2Kt: 165, vrefKt: 140, vmcgKt: 110, flatC: 15 }),
  ab({ id: "a310", name: "Airbus A300 / A310", icao: ["A306", "A310"], mtowKg: 171700, mlwKg: 140000, toflFt: 7900, ldrFt: 5300, v2Kt: 158, vrefKt: 137, vmcgKt: 110, flatC: 15, toFlaps: ["15/15", "15/0", "20/20"], ldgFlaps: ["40", "30"] }),
  ab({ id: "bcs1", name: "Airbus A220-100", icao: ["BCS1"], mtowKg: 63100, mlwKg: 52200, toflFt: 4800, ldrFt: 4400, v2Kt: 138, vrefKt: 125, vmcgKt: 100, toFlaps: RJ_TO, ldgFlaps: RJ_LD, autobrakes: RJ_AB, flatC: 15 }),
  ab({ id: "bcs3", name: "Airbus A220-300", icao: ["BCS3"], mtowKg: 70900, mlwKg: 58740, toflFt: 6200, ldrFt: 4900, v2Kt: 145, vrefKt: 130, vmcgKt: 102, toFlaps: RJ_TO, ldgFlaps: RJ_LD, autobrakes: RJ_AB, flatC: 15 }),
  bo({ id: "b736", name: "Boeing 737-600/700", icao: ["B736", "B737", "B37M"], mtowKg: 70080, mlwKg: 58604, toflFt: 6400, ldrFt: 4800, v2Kt: 148, vrefKt: 133, vmcgKt: 104 }),
  bo({ id: "b738", name: "Boeing 737-800", icao: ["B738"], mtowKg: 79016, mlwKg: 66361, toflFt: 7600, ldrFt: 5400, v2Kt: 158, vrefKt: 146, vmcgKt: 107 }),
  bo({ id: "b38m", name: "Boeing 737 MAX 8", icao: ["B38M"], mtowKg: 82191, mlwKg: 69309, toflFt: 7800, ldrFt: 5400, v2Kt: 160, vrefKt: 147, vmcgKt: 109 }),
  bo({ id: "b739", name: "Boeing 737-900 / MAX 9/10", icao: ["B739", "B39M", "B3XM"], mtowKg: 85130, mlwKg: 71350, toflFt: 8500, ldrFt: 5600, v2Kt: 163, vrefKt: 150, vmcgKt: 109 }),
  bo({ id: "b733", name: "Boeing 737 Classic", icao: ["B733", "B734", "B735"], mtowKg: 62820, mlwKg: 51710, toflFt: 7400, ldrFt: 4900, v2Kt: 150, vrefKt: 136, vmcgKt: 106 }),
  bo({ id: "b752", name: "Boeing 757-200", icao: ["B752"], mtowKg: 115680, mlwKg: 95250, toflFt: 6900, ldrFt: 4600, v2Kt: 152, vrefKt: 134, vmcgKt: 105, toFlaps: ["5", "1", "15", "20"], ldgFlaps: ["30", "25"] }),
  bo({ id: "b753", name: "Boeing 757-300", icao: ["B753"], mtowKg: 123600, mlwKg: 101600, toflFt: 8300, ldrFt: 5100, v2Kt: 158, vrefKt: 140, vmcgKt: 106, toFlaps: ["5", "1", "15", "20"], ldgFlaps: ["30", "25"] }),
  bo({ id: "b763", name: "Boeing 767", icao: ["B762", "B763", "B764"], mtowKg: 186880, mlwKg: 145150, toflFt: 8800, ldrFt: 5100, v2Kt: 160, vrefKt: 140, vmcgKt: 110, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "b744", name: "Boeing 747-400", icao: ["B744"], mtowKg: 396890, mlwKg: 295740, toflFt: 10800, ldrFt: 7000, v2Kt: 175, vrefKt: 152, vmcgKt: 118, toFlaps: ["10", "20"], ldgFlaps: ["30", "25"] }),
  bo({ id: "b748", name: "Boeing 747-8", icao: ["B748"], mtowKg: 447700, mlwKg: 312070, toflFt: 10200, ldrFt: 7200, v2Kt: 174, vrefKt: 154, vmcgKt: 118, toFlaps: ["10", "20"], ldgFlaps: ["30", "25"] }),
  bo({ id: "b772", name: "Boeing 777-200ER / LR", icao: ["B772", "B77L"], mtowKg: 297550, mlwKg: 213180, toflFt: 10100, ldrFt: 5600, v2Kt: 166, vrefKt: 141, vmcgKt: 120, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "b77w", name: "Boeing 777-300ER", icao: ["B773", "B77W"], mtowKg: 351530, mlwKg: 251290, toflFt: 10000, ldrFt: 6300, v2Kt: 172, vrefKt: 149, vmcgKt: 122, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "b788", name: "Boeing 787-8", icao: ["B788"], mtowKg: 227930, mlwKg: 172365, toflFt: 8500, ldrFt: 5400, v2Kt: 160, vrefKt: 140, vmcgKt: 115, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "b789", name: "Boeing 787-9", icao: ["B789"], mtowKg: 254010, mlwKg: 192780, toflFt: 9200, ldrFt: 5600, v2Kt: 165, vrefKt: 144, vmcgKt: 117, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "b78x", name: "Boeing 787-10", icao: ["B78X"], mtowKg: 254010, mlwKg: 201850, toflFt: 9500, ldrFt: 5800, v2Kt: 167, vrefKt: 148, vmcgKt: 117, toFlaps: BW_TO, ldgFlaps: BW_LD }),
  bo({ id: "md11", name: "McDonnell Douglas MD-11", icao: ["MD11", "DC10"], mtowKg: 286000, mlwKg: 213000, toflFt: 10200, ldrFt: 6900, v2Kt: 170, vrefKt: 150, vmcgKt: 120, toFlaps: ["15", "10", "20"], ldgFlaps: ["50", "35"], autobrakes: ["MIN", "MED", "MAX"] }),
  bo({ id: "md82", name: "McDonnell Douglas MD-80", icao: ["MD82", "MD83", "MD88", "B712"], mtowKg: 67800, mlwKg: 58970, toflFt: 7600, ldrFt: 5200, v2Kt: 150, vrefKt: 135, vmcgKt: 104, toFlaps: ["11", "5", "15"], ldgFlaps: ["40", "28"], autobrakes: ["MIN", "MED", "MAX"] }),
  { id: "e175", name: "Embraer 170 / 175", maker: "other", icao: ["E170", "E175"], mtowKg: 40370, mlwKg: 34000, toflFt: 7300, ldrFt: 4200, v2Kt: 140, vrefKt: 128, vmcgKt: 100, flatC: 15, flexMaxC: 65, toFlaps: RJ_TO, ldgFlaps: RJ_LD, autobrakes: RJ_AB, cg: [10, 22, 35] },
  { id: "e190", name: "Embraer 190 / 195", maker: "other", icao: ["E190", "E195", "E290", "E295"], mtowKg: 51800, mlwKg: 44000, toflFt: 6800, ldrFt: 4300, v2Kt: 142, vrefKt: 130, vmcgKt: 102, flatC: 15, flexMaxC: 65, toFlaps: RJ_TO, ldgFlaps: RJ_LD, autobrakes: RJ_AB, cg: [10, 22, 35] },
  { id: "crj9", name: "Bombardier CRJ700 / 900 / 1000", maker: "other", icao: ["CRJ7", "CRJ9", "CRJX", "CRJ2"], mtowKg: 38330, mlwKg: 33340, toflFt: 6000, ldrFt: 5300, v2Kt: 145, vrefKt: 140, vmcgKt: 105, flatC: 15, flexMaxC: 60, toFlaps: ["8", "20"], ldgFlaps: ["45", "30"], autobrakes: ["Manual"], cg: [10, 22, 35] },
  { id: "at76", name: "ATR 72 / 42", maker: "other", icao: ["AT72", "AT75", "AT76", "AT45", "AT46"], mtowKg: 23000, mlwKg: 22350, toflFt: 4500, ldrFt: 3000, v2Kt: 117, vrefKt: 113, vmcgKt: 89, flatC: 15, flexMaxC: 45, toFlaps: ["15", "0"], ldgFlaps: ["30", "15"], autobrakes: ["Manual"], cg: [15, 28, 37] },
  { id: "dh8d", name: "De Havilland Dash 8-400", maker: "other", icao: ["DH8D", "DH8C"], mtowKg: 29574, mlwKg: 28123, toflFt: 4700, ldrFt: 4200, v2Kt: 121, vrefKt: 118, vmcgKt: 90, flatC: 15, flexMaxC: 45, toFlaps: ["5", "10", "15"], ldgFlaps: ["15", "10", "35"], autobrakes: ["Manual"], cg: [15, 28, 37] },
  { id: "cj4", name: "Business jet (CJ4, Phenom, Citation…)", maker: "other", icao: ["C25C", "C25B", "C25A", "C510", "E50P", "E55P", "C68A", "C700", "LJ45", "PC24", "SF50", "H25B"], mtowKg: 7761, mlwKg: 7103, toflFt: 3400, ldrFt: 3000, v2Kt: 115, vrefKt: 113, vmcgKt: 85, flatC: 15, flexMaxC: 40, toFlaps: ["15", "0"], ldgFlaps: ["FULL", "15"], autobrakes: ["Manual"], cg: [10, 25, 35] },
  { id: "glex", name: "Large business jet (Global, Gulfstream, Falcon)", maker: "other", icao: ["GLEX", "GL7T", "GLF4", "GLF5", "GLF6", "CL60", "F2TH", "FA7X", "FA8X"], mtowKg: 45000, mlwKg: 35000, toflFt: 6000, ldrFt: 3500, v2Kt: 135, vrefKt: 120, vmcgKt: 100, flatC: 15, flexMaxC: 50, toFlaps: ["10", "20"], ldgFlaps: ["39", "30"], autobrakes: ["Manual"], cg: [15, 28, 40] },
  { id: "tbm9", name: "Turboprop single (TBM, PC-12, Caravan, King Air)", maker: "other", icao: ["TBM9", "TBM8", "PC12", "C208", "KODI", "B350", "BE20", "BE9L"], mtowKg: 3354, mlwKg: 3186, toflFt: 2400, ldrFt: 2100, v2Kt: 95, vrefKt: 85, vmcgKt: 0, flatC: 15, flexMaxC: 0, toFlaps: GA_TO, ldgFlaps: GA_LD, autobrakes: GA_AB, cg: [15, 25, 35] },
  { id: "c172", name: "Light piston (C172, SR22, DA40, PA-28…)", maker: "other", icao: ["C172", "C152", "C182", "SR22", "DA40", "DA42", "DA62", "PA28", "P28A", "PA34", "PA46", "BE36", "BE58", "C310", "C414", "DR40", "J3"], mtowKg: 1157, mlwKg: 1157, toflFt: 1630, ldrFt: 1335, v2Kt: 62, vrefKt: 62, vmcgKt: 0, flatC: 0, flexMaxC: 0, toFlaps: GA_TO, ldgFlaps: GA_LD, autobrakes: GA_AB, cg: [15, 25, 35] },
];

export function perfTypeFor(icao: string | null | undefined): PerfType | null {
  if (!icao) return null;
  const c = icao.toUpperCase().trim();
  return PERF_TYPES.find((t) => t.icao.includes(c)) ?? null;
}

export type Surface = "dry" | "wet" | "contaminated";

export interface Atmos { elevationFt: number; oatC: number; qnhHpa: number }
export interface Wind { dirDeg: number | null; kt: number; gustKt?: number | null }

export function pressureAltFt(a: Atmos): number { return a.elevationFt + (1013.25 - a.qnhHpa) * 27; }
export function isaC(pressureAltFt: number): number { return 15 - 1.98 * (pressureAltFt / 1000); }
/** Density ratio σ = ρ / ρ0. */
export function sigma(paFt: number, oatC: number): number {
  const delta = Math.pow(1 - 6.8756e-6 * paFt, 5.2559);
  return delta * 288.15 / (oatC + 273.15);
}

export function runwayWind(runwayHdgTrue: number, w: Wind): { head: number; cross: number } {
  if (w.dirDeg === null || !w.kt) return { head: 0, cross: 0 };
  const a = ((w.dirDeg - runwayHdgTrue) * Math.PI) / 180;
  return { head: w.kt * Math.cos(a), cross: w.kt * Math.sin(a) };
}

/** Wind factor on a ground run: half the headwind counts, one and a half times the tailwind. */
function windFactor(headKt: number, refKt: number): number {
  const eff = headKt >= 0 ? headKt * 0.5 : headKt * 1.5;
  const r = 1 - eff / refKt;
  return r * r;
}

const toFlapEffect = (t: PerfType, flap: string): { v: number; d: number } => {
  const i = Math.max(0, t.toFlaps.indexOf(flap));
  if (i === 0) return { v: 0, d: 1 };
  if (t.maker === "airbus" && t.toFlaps === AB_TO) return [{ v: 0, d: 1 }, { v: -4, d: 0.95 }, { v: -7, d: 0.92 }][i]!;
  // Other lists: earlier than standard in the list is usually less flap than standard for Boeing's "1"; treat by numeric value.
  const n = parseFloat(flap), s = parseFloat(t.toFlaps[0]!);
  if (!Number.isFinite(n) || !Number.isFinite(s)) return { v: 3, d: 1.06 };
  const step = (n - s) / 10;
  return { v: -5 * step, d: Math.max(0.85, Math.min(1.2, 1 - 0.06 * step)) };
};
const ldFlapEffect = (t: PerfType, flap: string): { v: number; d: number } => {
  const i = Math.max(0, t.ldgFlaps.indexOf(flap));
  if (i === 0) return { v: 0, d: 1 };
  const n = parseFloat(flap), s = parseFloat(t.ldgFlaps[0]!);
  if (Number.isFinite(n) && Number.isFinite(s)) { const step = (n - s) / 10; return { v: -6 * step, d: Math.max(0.85, Math.min(1.25, 1 - 0.06 * step)) }; }
  return { v: 6, d: 1.1 }; // e.g. Airbus CONF 3, FULL → 15
};

export interface TakeoffInput {
  type: PerfType;
  towKg: number;
  /** Runway available for the takeoff run (after any intersection). */
  toraFt: number;
  runwayHdgTrue: number;
  atmos: Atmos;
  wind: Wind;
  surface: Surface;
  flap: string;
  /** "flex" lets Glidepath pick the highest assumed temperature that fits. */
  thrust: "toga" | "flex";
  /** Boeing derate: 0, 1 (TO-1, −10%) or 2 (TO-2, −20%). */
  derate?: 0 | 1 | 2;
  antiIce?: boolean;
  packsOff?: boolean;
  cgPct?: number;
}

export interface TakeoffResult {
  ok: boolean;
  /** Why the takeoff doesn't work, when ok is false. */
  problem: string | null;
  v1: number; vr: number; v2: number;
  /** Assumed (flex) temperature, or null for full thrust. */
  flexC: number | null;
  todrFt: number;
  marginFt: number;
  headKt: number; crossKt: number;
  /** Stabiliser trim: Airbus THS ("UP1.2" / "DN0.4"), Boeing units. */
  trim: string;
  thrRedFt: number; accFt: number; eoAccFt: number;
  greenDot: number | null;
  overweight: boolean;
}

function todr(t: PerfType, w: number, paFt: number, tempC: number, head: number, refV: number, surface: Surface, flapD: number, thrustFactor: number): number {
  const sig = sigma(paFt, tempC);
  const delta = Math.pow(1 - 6.8756e-6 * paFt, 5.2559);
  const flat = isaC(paFt) + t.flatC;
  const tempLoss = tempC > flat ? Math.max(0.55, 1 - 0.011 * (tempC - flat)) : 1;
  const thrust = Math.pow(delta, 0.6) * tempLoss * thrustFactor;
  const surf = surface === "dry" ? 1 : surface === "wet" ? 1.15 : 1.4;
  return t.toflFt * Math.pow(w / t.mtowKg, 2) / (sig * thrust) * windFactor(head, refV) * surf * flapD;
}

const round = (n: number) => Math.round(n);

export function takeoff(i: TakeoffInput): TakeoffResult {
  const t = i.type;
  const pa = pressureAltFt(i.atmos);
  const { head, cross } = runwayWind(i.runwayHdgTrue, i.wind);
  const fe = toFlapEffect(t, i.flap);
  const sq = Math.sqrt(i.towKg / t.mtowKg);
  const v2 = t.v2Kt * sq + fe.v;
  const vr = v2 - (t.maker === "boeing" ? 6 : 4);
  const derateF = 1 - 0.1 * (i.derate ?? 0);
  const bleed = (i.antiIce ? 0.97 : 1) * (i.packsOff ? 1.02 : 1);
  const canFlex = i.thrust === "flex" && i.surface !== "contaminated" && t.flexMaxC > 0;
  const full = todr(t, i.towKg, pa, i.atmos.oatC, head, v2, i.surface, fe.d, derateF * bleed);
  let flexC: number | null = null, dist = full;
  if (canFlex && full < i.toraFt) {
    const isa = isaC(pa);
    const lo = Math.max(i.atmos.oatC, isa + t.flatC);
    const hi = isa + t.flexMaxC;
    // Highest assumed temperature whose distance still fits, with 3% margin, in 1 °C steps; at most a 25% thrust reduction.
    for (let T = Math.floor(hi); T > lo; T--) {
      const d = todr(t, i.towKg, pa, T, head, v2, i.surface, fe.d, derateF * bleed);
      const flat = isa + t.flatC;
      if (d * 1.03 <= i.toraFt && 1 - 0.011 * (T - flat) >= 0.75) { flexC = T; dist = d; break; }
    }
  }
  const margin = i.toraFt - dist;
  const ratio = i.toraFt / dist;
  const v1raw = vr - Math.max(0, Math.min(i.surface === "dry" ? 8 : 12, (ratio - 1) * 25 + (i.surface === "dry" ? 1 : 6)));
  const v1 = Math.max(t.vmcgKt, Math.min(vr, v1raw));
  const cg = i.cgPct ?? t.cg[1];
  const trim = t.maker === "airbus"
    ? (() => { const v = Math.max(-2.5, Math.min(3.5, (30 - cg) * 0.13)); return `${v >= 0 ? "UP" : "DN"}${Math.abs(v).toFixed(1)}`; })()
    : t.maker === "boeing" ? (Math.max(2.5, Math.min(8.5, 9.2 - 0.15 * cg))).toFixed(1) : "—";
  const elev = i.atmos.elevationFt;
  const okWind = i.surface === "contaminated" ? head > -5 : head > -15;
  const problem = dist > i.toraFt ? "Not enough runway at this weight, even at full thrust. Try more flap, a longer runway, or less weight."
    : !okWind ? "Tailwind is over the usual limit (15 kt; 5 kt on a contaminated runway)."
    : Math.abs(cross) > (i.surface === "dry" ? 35 : i.surface === "wet" ? 27 : 15) ? "Crosswind is beyond the usual demonstrated limit for this runway condition."
    : null;
  const sw = i.towKg / 1000;
  return {
    ok: problem === null, problem,
    v1: round(v1), vr: round(vr), v2: round(v2), flexC: flexC === null ? null : round(flexC),
    todrFt: round(dist), marginFt: round(margin), headKt: round(head), crossKt: round(cross),
    trim, thrRedFt: round(elev + 1500), accFt: round(elev + 1500), eoAccFt: round(elev + 1000),
    greenDot: t.maker === "airbus" && t.mtowKg < 100000 ? round(2 * sw + 85) : null,
    overweight: i.towKg > t.mtowKg,
  };
}

export interface LandingInput {
  type: PerfType;
  ldwKg: number;
  ldaFt: number;
  runwayHdgTrue: number;
  atmos: Atmos;
  wind: Wind;
  surface: Surface;
  flap: string;
  autobrake: string;
  reversers: boolean;
  antiIce?: boolean;
}

export interface LandingResult {
  ok: boolean;
  problem: string | null;
  vls: number;
  vapp: number;
  /** Distance from 50 ft to a stop, unfactored. */
  ldFt: number;
  /** With the 15% in-flight margin. */
  factoredFt: number;
  marginFt: number;
  headKt: number; crossKt: number;
  /** Speed added to VLS / Vref and why. */
  addKt: number;
  overweight: boolean;
  /** Autobrake setting strong enough to stop with the margin, or null if none is. */
  suggestedAutobrake: string | null;
}

function ldDist(t: PerfType, w: number, paFt: number, tempC: number, head: number, vapp: number, surface: Surface, flapD: number, abIdx: number, abCount: number, rev: boolean): number {
  const sig = sigma(paFt, tempC);
  const base = t.ldrFt / 1.67; // unfactored at MLW, max manual braking
  // Weaker autobrake settings stop later. The strongest setting is max braking.
  const weakest = abCount <= 1 ? 1 : 1.55;
  const ab = abCount <= 1 ? 1.1 : weakest - (weakest - 1) * (abIdx / (abCount - 1));
  const surf = surface === "dry" ? 1 : surface === "wet" ? 1.35 : 1.8;
  const revF = rev ? (surface === "dry" ? 0.96 : 0.9) : 1;
  const air = 1000; // the airborne part from 50 ft doesn't depend on braking
  const ground = Math.max(0, base - air) * (w / t.mlwKg) / sig * ab * surf * revF * flapD;
  return (air + ground) * windFactor(head, vapp);
}

export function landing(i: LandingInput): LandingResult {
  const t = i.type;
  const pa = pressureAltFt(i.atmos);
  const { head, cross } = runwayWind(i.runwayHdgTrue, i.wind);
  const fe = ldFlapEffect(t, i.flap);
  const vls = t.vrefKt * Math.sqrt(i.ldwKg / t.mlwKg) + fe.v;
  const gust = Math.max(0, (i.wind.gustKt ?? 0) - i.wind.kt);
  // Airbus: VLS + max(5, ⅓ headwind) capped at 15. Boeing: Vref + ½ headwind + gust, 5 to 20.
  const add = t.maker === "boeing"
    ? Math.max(5, Math.min(20, Math.max(0, head) / 2 + gust))
    : Math.max(5, Math.min(15, Math.max(0, head) / 3 + (i.antiIce ? 5 : 0)));
  const vapp = vls + add;
  const abIdx = Math.max(0, t.autobrakes.indexOf(i.autobrake));
  const ld = ldDist(t, i.ldwKg, pa, i.atmos.oatC, head, vapp, i.surface, fe.d, abIdx, t.autobrakes.length, i.reversers);
  const factored = ld * 1.15;
  let suggested: string | null = null;
  for (let k = 0; k < t.autobrakes.length; k++) {
    if (ldDist(t, i.ldwKg, pa, i.atmos.oatC, head, vapp, i.surface, fe.d, k, t.autobrakes.length, i.reversers) * 1.15 <= i.ldaFt) { suggested = t.autobrakes[k]!; break; }
  }
  const problem = factored > i.ldaFt ? "Landing distance with the 15% margin is longer than the runway. Use a stronger autobrake, more flap, or another runway."
    : head < -10 ? "Tailwind is over the usual 10 kt limit."
    : Math.abs(cross) > (i.surface === "dry" ? 38 : i.surface === "wet" ? 30 : 20) ? "Crosswind is beyond the usual demonstrated limit for this runway condition."
    : null;
  return {
    ok: problem === null, problem, vls: round(vls), vapp: round(vapp), ldFt: round(ld), factoredFt: round(factored),
    marginFt: round(i.ldaFt - factored), headKt: round(head), crossKt: round(cross), addKt: round(add),
    overweight: i.ldwKg > t.mlwKg, suggestedAutobrake: suggested,
  };
}
