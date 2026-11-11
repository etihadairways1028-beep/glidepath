/**
 * Glideslope flight messages: a glass banner at each stage of the flight
 * (taxi, take-off, cruise reached, top of descent, approach, landing, on
 * blocks), built from live data. Spoken too when voice callouts are on.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLive } from "../data/derive";
import { settingsStore, store, useSettings } from "../data/store";

interface Msg { id: number; title: string; body: string; tone: "info" | "good" | "warn" }
let msgs: Msg[] = [];
const subs = new Set<() => void>();
let nextId = 1;
const emit = () => subs.forEach((f) => f());
export function postFlightMessage(title: string, body: string, tone: Msg["tone"] = "info") {
  const m = { id: nextId++, title, body, tone };
  msgs = [...msgs.slice(-2), m];
  emit();
  window.setTimeout(() => { msgs = msgs.filter((x) => x.id !== m.id); emit(); }, 7000);
  if (settingsStore.get().voiceCallouts && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(`${title}. ${body}`);
    u.rate = 1.03; u.lang = "en-US";
    window.speechSynthesis.speak(u);
  }
}
const useMsgs = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => msgs, () => msgs);

const fl = (ft: number | null | undefined) => (ft == null ? "" : ft >= 18000 ? `FL${Math.round(ft / 100).toString().padStart(3, "0")}` : `${Math.round(ft / 100) * 100} ft`);
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.max(1, Math.round(min))} min`);

/** Watches the flight and posts messages. Mounted once, in App. */
export function useFlightMessages() {
  const { flightMessages } = useSettings();
  const L = useLive();
  const prevPhase = useRef<string | null>(null);
  const said = useRef(new Set<string>());
  const lastLanding = useRef<number | null>(store.get().landing?.t ?? null);

  useEffect(() => {
    const phase = L.phase;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (!flightMessages || !L.frame || prev === null || prev === phase) return;
    const dest = L.destination?.icao ?? L.flight?.arrivalIcao ?? "your destination";
    const alt = L.frame.position.altMslFt;
    const toGo = L.toGoNm != null ? `${Math.round(L.toGoNm)} nm to ${dest}` : null;
    const eta = L.etaLanding ? hm((L.etaLanding - L.frame.t) / 60000) : null;
    const once = (key: string, title: string, body: string, tone: Msg["tone"] = "info") => {
      if (said.current.has(key)) return;
      said.current.add(key);
      postFlightMessage(title, body, tone);
    };
    switch (phase) {
      case "PUSHBACK": once("push", "Pushback", "Flight started. Glidepath is recording."); break;
      case "TAXI_OUT": once("taxi", "Taxiing out", `Heading for the runway${L.flight?.departureIcao ? ` at ${L.flight.departureIcao}` : ""}.`); break;
      case "TAKEOFF": once("to", "Take-off roll", "Have a good flight."); break;
      case "CLIMB": if (prev === "TAKEOFF") once("climb", "Positive climb", toGo ? `Climbing out. ${toGo}.` : "Climbing out."); break;
      case "CRUISE": once("cruise", "Cruise reached", `Level at ${fl(alt)}.${toGo ? ` ${toGo}` : ""}${eta ? `, landing in about ${eta}` : ""}.`, "good"); break;
      case "DESCENT": once("desc", "Descent started", `${toGo ?? `Descending towards ${dest}`}.${eta ? ` Landing in about ${eta}.` : ""}`); break;
      case "APPROACH": once("app", "On approach", `Approaching ${dest}. Check your landing configuration.`); break;
      case "TAXI_IN": once("taxiin", `Welcome to ${dest}`, "Taxi to the gate."); break;
      case "COMPLETED": once("done", "On blocks", "Flight saved to your logbook.", "good"); said.current.clear(); break;
    }
    // A go-around or a new flight re-arms the approach and landing messages.
    if (phase === "CLIMB" && (prev === "APPROACH" || prev === "LANDING")) for (const k of ["app", "desc", "cruise"]) said.current.delete(k);
  }, [L.phase, flightMessages]);

  // Top of descent coming up. Fires even if a reading is skipped (sim rate, a stutter).
  const todMin = L.tod && !L.tod.pastTod ? L.tod.minutesToTod : null;
  useEffect(() => {
    if (!flightMessages || todMin == null || L.phase !== "CRUISE") return;
    if (todMin <= 1) {
      if (!said.current.has("tod1")) { said.current.add("tod1"); said.current.add("tod5"); postFlightMessage("Top of descent now", "Start your descent.", "warn"); }
    } else if (todMin <= 5.2 && !said.current.has("tod5")) {
      said.current.add("tod5");
      postFlightMessage(`Top of descent in ${Math.round(todMin)} minutes`, "Time to brief the arrival.");
    }
  }, [todMin == null ? null : Math.round(todMin * 2), flightMessages, L.phase]);

  useLightMessages(L);

  // Landing result.
  useEffect(() => { const off = store.subscribe(() => {
    const l = store.get().landing;
    if (!l || l.t === lastLanding.current) return;
    lastLanding.current = l.t;
    if (!settingsStore.get().flightMessages) return;
    const fpm = l.touchdownVsFpm != null ? `${Math.round(l.touchdownVsFpm)} fpm` : "";
    postFlightMessage("Touchdown", `${fpm}${fpm ? ", " : ""}${l.verdict.replace(/\.$/, "")}. Grade ${l.grade}.`, l.score >= 70 ? "good" : "warn");
  }); return () => { off(); }; }, []);
}

const LIGHT_NAMES: Record<string, string> = { landing: "Landing lights", taxi: "Taxi light", beacon: "Beacon", strobe: "Strobes", nav: "Nav lights", logo: "Logo lights", wing: "Wing lights" };
type Lights = Record<string, boolean | null>;

/**
 * Lights: a message when a light is switched on or off (switches made within a
 * couple of seconds are grouped), plus the usual airline reminders: beacon on
 * before engine start, landing lights at 10,000 ft and for take-off.
 * Uses the simulator's standard light switches; some add-ons (Fenix, for one)
 * drive their own lights and may not report them.
 */
function useLightMessages(L: ReturnType<typeof useLive>) {
  const { lightMessages } = useSettings();
  const prev = useRef<Lights | null>(null);
  const pending = useRef<{ on: string[]; off: string[]; timer: number | null }>({ on: [], off: [], timer: null });
  const reminded = useRef(new Set<string>());
  const prevAlt = useRef<number | null>(null);
  const lights = L.frame?.lights as Lights | undefined;
  const key = lights ? Object.keys(LIGHT_NAMES).map((k) => (lights[k] == null ? "-" : lights[k] ? "1" : "0")).join("") : "";

  useEffect(() => {
    if (!lights) { prev.current = null; return; }
    const before = prev.current;
    prev.current = { ...lights };
    if (!before || !lightMessages) return; // never announce the state we join with
    const p = pending.current;
    for (const k of Object.keys(LIGHT_NAMES)) {
      const a = before[k], b = lights[k];
      if (a == null || b == null || a === b) continue;
      const name = LIGHT_NAMES[k]!;
      p.on = p.on.filter((x) => x !== name); p.off = p.off.filter((x) => x !== name);
      (b ? p.on : p.off).push(name);
    }
    if ((p.on.length || p.off.length) && p.timer === null) {
      p.timer = window.setTimeout(() => {
        const list = (xs: string[]) => xs.length === 1 ? xs[0]! : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
        const parts: string[] = [];
        if (p.on.length) parts.push(`${list(p.on)} on`);
        if (p.off.length) parts.push(`${list(p.off)} off`);
        if (parts.length) postFlightMessage("Lights", parts.join(". ") + ".");
        p.on = []; p.off = []; p.timer = null;
      }, 2500);
    }
  }, [key, lightMessages]);

  // Reminders.
  const f = L.frame;
  const alt = f?.position.altMslFt ?? null;
  const enginesRunning = !!f && f.engines.some((e) => e.running === true);
  useEffect(() => {
    const was = prevAlt.current;
    prevAlt.current = alt;
    if (!lightMessages || !f || !lights) return;
    const once = (k: string, title: string, body: string) => { if (!reminded.current.has(k)) { reminded.current.add(k); postFlightMessage(title, body, "warn"); } };
    if (L.phase === "COMPLETED" || L.phase === "PREFLIGHT") { reminded.current.clear(); return; }
    if (enginesRunning && lights.beacon === false && f.position.onGround) once("beacon", "Beacon is off", "Engines are running. Switch the beacon on.");
    if (L.phase === "TAKEOFF" && lights.landing === false) once("toLanding", "Landing lights are off", "Switch them on for take-off.");
    if (L.phase === "TAKEOFF" && lights.strobe === false) once("toStrobe", "Strobes are off", "Switch them on when you enter the runway.");
    if (was != null && alt != null && L.airborne) {
      if (was < 10000 && alt >= 10000 && lights.landing === true) once("up10k", "Passing 10,000 ft", "Landing lights can go off now.");
      if (was > 10000 && alt <= 10000 && lights.landing === false) once("down10k", "Passing 10,000 ft", "Landing lights on.");
    }
    if (L.phase === "APPROACH" && lights.landing === false && (f.position.altAglFt ?? 9999) < 2500) once("appLanding", "Landing lights are off", "Switch them on for landing.");
  }, [alt == null ? null : Math.round(alt / 100), key, L.phase, enginesRunning, lightMessages]);
}

export function GlideslopeBanners() {
  const list = useMsgs();
  const [, force] = useState(0);
  if (!list.length) return null;
  return (
    <div className="gs-stack" aria-live="polite">
      {list.map((m) => (
        <div key={m.id} className={`glass strong gs-msg ${m.tone}`} role="status" onClick={() => { msgs = msgs.filter((x) => x.id !== m.id); emit(); force((n) => n + 1); }}>
          <div className="gs-from"><span className="gs-dot" />Glideslope</div>
          <div className="gs-title">{m.title}</div>
          <div className="gs-body">{m.body}</div>
        </div>
      ))}
    </div>
  );
}
