/**
 * Copilot data: one snapshot of the flight that the rules engine, the
 * spoken callouts and (optionally) the AI model all read from.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { callouts, copilotAlerts, type CalloutState, type CopilotSnapshot, type CopilotWeather, type RunwayEnd } from "@glidepath/flight-engine";
import { activeBridge } from "./bridge";
import { airportDetail } from "./airports";
import { getMetar } from "./external";
import { useLive } from "./derive";
import { useApp, useSettings } from "./store";

/** Arrival weather (via the Bridge, every 5 min) and runways (from the airport database). */
function useArrival(icao: string | null) {
  const [weather, setWeather] = useState<CopilotWeather | null>(null);
  const [runways, setRunways] = useState<RunwayEnd[]>([]);
  const conn = useApp((s) => s.conn);
  useEffect(() => {
    setWeather(null); setRunways([]);
    if (!icao) return;
    let alive = true;
    void airportDetail(icao).then((a) => alive && a && setRunways(a.runways.flatMap((r) => r.ends)));
    const load = () => {
      if (!activeBridge()) return;
      getMetar([icao]).then((m) => { const x = m[0]; if (alive && x) setWeather({ icao: x.icao, windDir: x.windDir, windKt: x.windKt, gustKt: x.gustKt, visibility: x.visibility, category: x.category, qnhHpa: x.qnhHpa, tempC: x.tempC, raw: x.raw }); }).catch(() => undefined);
    };
    load();
    const id = setInterval(load, 300_000);
    return () => { alive = false; clearInterval(id); };
  }, [icao, conn]);
  return { weather, runways };
}

export function useCopilot() {
  const L = useLive();
  const landing = useApp((s) => s.landing);
  const arrival = L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? null;
  const { weather, runways } = useArrival(arrival);
  const f = L.frame;
  const snapshot: CopilotSnapshot = useMemo(() => ({
    phase: L.phase,
    airborne: L.airborne,
    altFt: f?.position.altMslFt ?? null,
    aglFt: f?.position.altAglFt ?? null,
    iasKt: f?.speed.iasKt ?? null,
    gsKt: f?.speed.gsKt ?? null,
    vsFpm: f?.speed.vsFpm ?? null,
    gearDown: f?.controls.gearDown ?? null,
    flapsIndex: f?.controls.flapsIndex ?? null,
    fuelKg: f?.fuel.totalKg ?? null,
    fuelAtDestinationKg: L.fuelAtDestinationKg,
    plannedLandingFuelKg: L.plan?.fuelLandingKg ?? null,
    toGoNm: L.toGoNm,
    departure: L.flight?.departureIcao ?? L.plan?.origin.icao ?? null,
    arrival,
    timings: L.timings,
    tod: L.tod ? { minutesToTod: L.tod.minutesToTod, pastTod: L.tod.pastTod, plannedVsFpm: L.tod.plannedVsFpm, requiredVsNowFpm: L.tod.requiredVsNowFpm } : null,
    arrivalWeather: weather,
    arrivalRunways: runways,
    lastLanding: (landing ?? L.flight?.landings.at(-1)) ? (() => { const l = (landing ?? L.flight!.landings.at(-1))!; return { grade: l.grade, score: l.score, touchdownVsFpm: l.touchdownVsFpm, verdict: l.verdict }; })() : null,
  }), [L, f, weather, runways, landing, arrival]);
  const alerts = useMemo(() => copilotAlerts(snapshot), [snapshot]);
  return { snapshot, alerts, live: L };
}

/** Compact facts for the AI model: only real values, rounded, no nulls. */
export function factsFor(s: CopilotSnapshot, extra: Record<string, unknown>): Record<string, unknown> {
  const t = s.timings;
  const z = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(11, 16).replace(":", "") + "Z" : undefined);
  const facts: Record<string, unknown> = {
    utcNow: new Date().toISOString().slice(11, 16).replace(":", "") + "Z",
    phase: s.phase, airborne: s.airborne, altitudeFt: s.altFt, aboveGroundFt: s.aglFt, indicatedKt: s.iasKt, groundspeedKt: s.gsKt, verticalSpeedFpm: s.vsFpm,
    gearDown: s.gearDown, flapsIndex: s.flapsIndex, fuelOnBoardKg: s.fuelKg, fuelAtDestinationEstimateKg: s.fuelAtDestinationKg, plannedLandingFuelKg: s.plannedLandingFuelKg,
    departure: s.departure, arrival: s.arrival, distanceToGoNm: s.toGoNm,
    topOfDescent: s.tod ? { minutesFromNowEstimate: s.tod.minutesToTod, alreadyPast: s.tod.pastTod, threeDegreeVsFpm: s.tod.plannedVsFpm, vsNeededNowFpm: s.tod.requiredVsNowFpm } : undefined,
    milestones: t?.milestones.map((m) => ({ name: m.label, scheduled: z(m.scheduled), estimated: z(m.estimated), actual: z(m.actual), minutesVsSchedule: m.deltaMin ?? undefined })),
    departureStatus: t?.departure?.label, arrivalStatus: t?.arrival?.label,
    blockTimeMin: t?.blockMs != null ? Math.round(t.blockMs / 60000) : undefined, airTimeMin: t?.airMs != null ? Math.round(t.airMs / 60000) : undefined,
    arrivalWeather: s.arrivalWeather ?? undefined,
    arrivalRunways: s.arrivalRunways.map((e) => ({ ident: e.ident, headingTrue: Math.round(e.headingTrueDeg), lengthFt: e.lengthFt })),
    lastLanding: s.lastLanding ?? undefined,
    alerts: copilotAlerts(s).map((a) => `${a.level}: ${a.title} — ${a.detail}`),
    ...extra,
  };
  return JSON.parse(JSON.stringify(facts, (_k, v) => (v === null ? undefined : typeof v === "number" ? Math.round(v * 10) / 10 : v)));
}

/** Spoken callouts while flying (on-device speech; nothing leaves the device). */
export function useCallouts() {
  const { voiceCallouts } = useSettings();
  const L = useLive();
  const prev = useRef<CalloutState | null>(null);
  const said = useRef(new Set<string>());
  useEffect(() => {
    if (!L.frame) return;
    const next: CalloutState = { phase: L.phase, aglFt: L.frame.position.altAglFt, airborne: L.airborne, minutesToTod: L.tod && !L.tod.pastTod ? L.tod.minutesToTod : null };
    const lines = callouts(prev.current, next, said.current);
    prev.current = next;
    if (!voiceCallouts || !lines.length || !("speechSynthesis" in window)) return;
    for (const line of lines) {
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.05;
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    }
  }, [L.frame, L.phase, voiceCallouts]);
}

export function speakTest(text = "Glidepath callouts are on.") {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  return true;
}
