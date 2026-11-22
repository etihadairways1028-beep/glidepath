/**
 * Live approach guidance: picks the runway you're flying to (your planned
 * arrival runway, or whichever runway you're lined up with) and works out the
 * glidepath and centreline deviation from every frame.
 */
import { useEffect, useMemo, useState } from "react";
import { approachGuide, bearingDeg, distanceNm, likelyRunway, type ApproachGuide } from "@glidepath/flight-engine";
import type { Runway } from "@glidepath/aviation-data";
type RunwayEnd = Runway["ends"][number];
import { airportDetail, loadAirportDb, type AirportDetail } from "./airports";
import { useLive } from "./derive";
import { loadChoice } from "../components/Procedures";

export interface ApproachSetup { gpaDeg: number; tchFt: number; airport: string | null; runway: string | null; voice: boolean; thrElevFt: number | null }
const KEY = "glidepath.approach";
const DEFAULTS: ApproachSetup = { gpaDeg: 3, tchFt: 50, airport: null, runway: null, voice: false, thrElevFt: null };

export function loadSetup(): ApproachSetup {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ApproachSetup>) }; } catch { return DEFAULTS; }
}
const listeners = new Set<() => void>();
export function saveSetup(p: Partial<ApproachSetup>): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...loadSetup(), ...p })); } catch { /* private mode: lasts for this visit */ }
  listeners.forEach((l) => l());
}
export function useSetup(): ApproachSetup {
  const [s, set] = useState(loadSetup);
  useEffect(() => { const l = () => set(loadSetup()); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return s;
}

type End = RunwayEnd & { displacedFt: number; airport: string; elevFt: number; airportName: string };
const detailCache = new Map<string, Promise<AirportDetail | null>>();
const detail = (c: string) => { let p = detailCache.get(c); if (!p) { p = airportDetail(c).catch(() => null); detailCache.set(c, p); } return p; };

/** Runway ends at the arrival airport and at any airport within 20 nm. */
function useCandidates(arr: string | null, pos: { lat: number; lon: number } | null, pick: string | null): End[] {
  const [ends, setEnds] = useState<End[]>([]);
  // Re-check the nearby airport only when you move about 5 nm.
  const cell = pos ? `${Math.round(pos.lat * 12)},${Math.round(pos.lon * 8)}` : "";
  useEffect(() => {
    let off = false;
    void (async () => {
      const codes = new Set<string>();
      if (pick) codes.add(pick);
      if (arr) codes.add(arr);
      if (pos) {
        const db = await loadAirportDb().catch(() => null);
        const n = db?.nearest(pos, { maxNm: 20, sizes: ["large", "medium"] });
        if (n) codes.add(n.code);
      }
      const out: End[] = [];
      for (const c of codes) {
        const d = await detail(c);
        if (!d) continue;
        for (const r of d.runways) for (const e of r.ends) if ((r.lengthFt ?? 0) >= 2000) out.push({ ...e, lengthFt: r.lengthFt ?? 0, airport: d.code, elevFt: d.elevationFt ?? 0, airportName: d.name });
      }
      if (!off) setEnds(out);
    })();
    return () => { off = true; };
  }, [arr, cell, pick]);
  return ends;
}

let lastPos: { lat: number; lon: number; t: number } | null = null;
let lastTrack: number | null = null;
/** Track over the ground from the last two positions; heading until there's movement. */
function trackOf(lat: number, lon: number, t: number, hdg: number | null): number | null {
  if (lastPos && t > lastPos.t && t - lastPos.t < 20_000) {
    const moved = distanceNm(lastPos, { lat, lon });
    if (moved > 0.02) { lastTrack = bearingDeg(lastPos, { lat, lon }); lastPos = { lat, lon, t }; }
  } else lastPos = { lat, lon, t };
  return lastTrack ?? hdg;
}

export interface LiveApproach {
  guide: ApproachGuide | null;
  end: End | null;
  ends: End[];
  /** True when the runway was picked automatically from your position. */
  auto: boolean;
  setup: ApproachSetup;
  gsKt: number | null;
  vsFpm: number | null;
  windHead: number | null;
  windCross: number | null;
}

export function useApproach(): LiveApproach {
  const L = useLive();
  const setup = useSetup();
  const f = L.frame;
  const arr = (L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? null)?.toUpperCase() ?? null;
  const dep = (L.flight?.departureIcao ?? L.plan?.origin.icao ?? "").toUpperCase();
  const pos = f ? { lat: f.position.lat, lon: f.position.lon } : null;
  const ends = useCandidates(arr, pos, setup.airport);
  const planned = arr ? (loadChoice(dep, arr).arrRunway ?? L.plan?.destination.runway ?? null) : null;
  const track = f ? trackOf(f.position.lat, f.position.lon, f.t, f.attitude.headingTrueDeg ?? null) : null;

  const pick = useMemo(() => {
    if (setup.airport && setup.runway) {
      const e = ends.find((x) => x.airport === setup.airport && x.ident === setup.runway);
      if (e) return { e, auto: false };
    }
    const lined = pos ? likelyRunway(ends, pos, track) : null;
    const plannedEnd = planned && arr ? ends.find((x) => x.airport === arr && x.ident === planned) ?? null : null;
    // Your planned runway wins while you're anywhere in its approach area (so a parallel runway never steals it).
    const plannedFits = plannedEnd && pos ? likelyRunway([plannedEnd], pos, track) !== null : false;
    if (plannedEnd && (plannedFits || !lined)) return { e: plannedEnd, auto: false };
    return lined ? { e: lined, auto: true } : plannedEnd ? { e: plannedEnd, auto: false } : null;
  }, [ends, setup.airport, setup.runway, planned, arr, pos?.lat, pos?.lon, track]);

  const end = pick?.e ?? null;
  const guide = useMemo(() => {
    if (!f || !end || f.position.altMslFt === null) return null;
    return approachGuide({
      pos: { lat: f.position.lat, lon: f.position.lon }, altMslFt: f.position.altMslFt, gsKt: f.speed.gsKt, vsFpm: f.speed.vsFpm, trackDeg: track,
      runway: { threshold: end.threshold, headingTrueDeg: end.headingTrueDeg, lengthFt: end.lengthFt, displacedFt: end.displacedFt, elevationFt: setup.thrElevFt ?? end.elevFt },
      gpaDeg: setup.gpaDeg, tchFt: setup.tchFt,
    });
  }, [f, end, track, setup.gpaDeg, setup.tchFt, setup.thrElevFt]);

  const w = f?.environment;
  let windHead: number | null = null, windCross: number | null = null;
  if (end && w && w.windDirDeg !== null && w.windKt !== null) {
    const a = ((w.windDirDeg - end.headingTrueDeg) * Math.PI) / 180;
    windHead = Math.round(w.windKt * Math.cos(a)); windCross = Math.round(w.windKt * Math.sin(a));
  }
  return { guide, end, ends, auto: pick?.auto ?? false, setup, gsKt: f?.speed.gsKt ?? null, vsFpm: f?.speed.vsFpm ?? null, windHead, windCross };
}

/** On an approach worth showing guidance for. */
export const onFinal = (g: ApproachGuide | null) => !!g && (g.state === "established" || g.state === "intercept") && g.distNm < 15 && g.hatFt < 5000;
