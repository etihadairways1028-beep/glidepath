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
  window.setTimeout(() => { msgs = msgs.filter((x) => x.id !== m.id); emit(); }, 9000);
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

  // Top of descent coming up.
  const todMin = L.tod && !L.tod.pastTod ? L.tod.minutesToTod : null;
  useEffect(() => {
    if (!flightMessages || todMin == null || L.phase !== "CRUISE") return;
    if (todMin <= 5 && todMin > 4 && !said.current.has("tod5")) { said.current.add("tod5"); postFlightMessage("Top of descent in 5 minutes", "Time to brief the arrival."); }
    if (todMin <= 1 && !said.current.has("tod1")) { said.current.add("tod1"); postFlightMessage("Top of descent now", "Start your descent.", "warn"); }
  }, [todMin == null ? null : Math.ceil(todMin), flightMessages]);

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
