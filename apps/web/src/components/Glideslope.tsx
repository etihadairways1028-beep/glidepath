/**
 * Glideslope flight messages: a glass banner at each stage of the flight
 * (taxi, take-off, cruise reached, top of descent, approach, landing, on
 * blocks), built from live data. Spoken too when voice callouts are on.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLive } from "../data/derive";
import { settingsStore, store, useSettings } from "../data/store";

interface Msg { id: number; title: string; body: string; tone: "info" | "good" | "warn"; href?: string }
let msgs: Msg[] = [];
const subs = new Set<() => void>();
let nextId = 1;
const emit = () => subs.forEach((f) => f());
export function postFlightMessage(title: string, body: string, tone: Msg["tone"] = "info", href?: string) {
  const m = { id: nextId++, title, body, tone, href };
  msgs = [...msgs.slice(-2), m];
  emit();
  window.setTimeout(() => { msgs = msgs.filter((x) => x.id !== m.id); emit(); }, href ? 15000 : 7000);
  void systemNotify(title, body, href);
  if (settingsStore.get().voiceCallouts && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(`${title}. ${body}`);
    u.rate = 1.03; u.lang = "en-US";
    window.speechSynthesis.speak(u);
  }
}
/** A system notification too, when allowed and the app isn't on screen. Tapping it opens the app. */
async function systemNotify(title: string, body: string, href?: string) {
  try {
    if (!settingsStore.get().systemNotifications || !("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && !href) return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const url = href ?? "#/";
    if (reg) await reg.showNotification(`Glidepath · ${title}`, { body, tag: `gp-${title}`, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url } });
    else new Notification(`Glidepath · ${title}`, { body });
  } catch { /* notifications are a bonus */ }
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
      case "COMPLETED": {
        const id = L.flight?.id;
        if (!said.current.has("done")) { said.current.add("done"); postFlightMessage("Your debrief is ready", "Flight saved to your logbook. Tap to see how it went.", "good", id ? `#/logbook/${id}` : "#/logbook"); }
        said.current.clear(); break;
      }
    }
    // A go-around or a new flight re-arms the approach and landing messages.
    if (phase === "CLIMB" && (prev === "APPROACH" || prev === "LANDING")) for (const k of ["app", "desc", "cruise"]) said.current.delete(k);
  }, [L.phase, flightMessages]);

  // Top of descent: 10 minutes out, then now. Fires even if a reading is skipped (sim rate, a stutter).
  const todMin = L.tod && !L.tod.pastTod ? L.tod.minutesToTod : null;
  useEffect(() => {
    if (!flightMessages || todMin == null || L.phase !== "CRUISE") return;
    if (todMin <= 1) {
      if (!said.current.has("tod1")) { said.current.add("tod1"); said.current.add("tod10"); postFlightMessage("Top of descent now", "Start your descent.", "warn"); }
    } else if (todMin <= 10.3 && todMin > 2 && !said.current.has("tod10")) {
      said.current.add("tod10");
      postFlightMessage(`Top of descent in ${Math.round(todMin)} minutes`, "Time to brief the arrival and set up the approach.");
    }
  }, [todMin == null ? null : Math.round(todMin * 2), flightMessages, L.phase]);

  // Arrival: 30 and 10 minutes to landing.
  const toLandMin = L.timings?.toLandingMs != null && L.airborne ? L.timings.toLandingMs / 60000 : null;
  useEffect(() => {
    if (!flightMessages || toLandMin == null) return;
    const dest = L.destination?.icao ?? L.flight?.arrivalIcao ?? "your destination";
    if (toLandMin <= 10.3 && toLandMin > 3 && !said.current.has("arr10")) { said.current.add("arr10"); said.current.add("arr30"); postFlightMessage("10 minutes to landing", `About ${Math.round(toLandMin)} minutes to touchdown at ${dest}.`); }
    else if (toLandMin <= 30.5 && toLandMin > 12 && !said.current.has("arr30")) { said.current.add("arr30"); postFlightMessage("30 minutes to landing", `Landing at ${dest} in about ${Math.round(toLandMin)} minutes.`); }
  }, [toLandMin == null ? null : Math.round(toLandMin * 2), flightMessages]);

  useLightMessages(L);
  useAtcAlerts(L);

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

/**
 * ATC online alerts: polls the networks you show on the map every two minutes
 * and tells you when a controller logs on at your departure or destination.
 * Controllers already online when the flight starts are listed once.
 */
function useAtcAlerts(L: ReturnType<typeof useLive>) {
  const st = useSettings();
  const dep = L.flight?.departureIcao ?? L.plan?.origin.icao ?? null;
  const arr = L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? null;
  const known = useRef<Map<string, Set<string>>>(new Map());
  const active = !!L.frame && !L.completed && !!(dep || arr) && st.atcAlerts;
  const nets = [st.showVatsim ? "vatsim" : null, st.showIvao ? "ivao" : null].filter(Boolean) as Array<"vatsim" | "ivao">;
  useEffect(() => {
    if (!active || !nets.length) return;
    let stop = false;
    const prefixes = [dep, arr].filter(Boolean).map((c) => `${c!.toUpperCase()}_`);
    const tick = async () => {
      for (const n of nets) {
        try {
          const { getLiveNetwork } = await import("../data/networks");
          const live = await getLiveNetwork(n);
          if (stop) return;
          const here = live.controllers.filter((c) => c.facility !== "ATIS" && prefixes.some((p) => c.callsign.toUpperCase().startsWith(p)));
          const key = `${n}:${dep}-${arr}`;
          const seen = known.current.get(key);
          const label = n === "vatsim" ? "VATSIM" : "IVAO";
          if (!seen) {
            known.current.set(key, new Set(here.map((c) => c.callsign)));
            if (here.length) postFlightMessage(`ATC online (${label})`, here.slice(0, 4).map((c) => `${c.callsign}${c.frequency ? ` ${c.frequency}` : ""}`).join(", "));
          } else {
            for (const c of here) if (!seen.has(c.callsign)) { seen.add(c.callsign); postFlightMessage(`${c.callsign} is online`, `${label}${c.frequency ? `, ${c.frequency}` : ""}.`, "good"); }
            for (const cs of [...seen]) if (!here.some((c) => c.callsign === cs)) seen.delete(cs);
          }
        } catch { /* try again next round */ }
      }
    };
    void tick();
    const t = window.setInterval(tick, 120_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [active, dep, arr, nets.join(",")]);
}

export function GlideslopeBanners() {
  const list = useMsgs();
  const [, force] = useState(0);
  if (!list.length) return null;
  return (
    <div className="gs-stack" aria-live="polite">
      {list.map((m) => (
        <div key={m.id} className={`glass strong gs-msg ${m.tone}`} role="status" onClick={() => { if (m.href) location.hash = m.href.replace(/^#/, ""); msgs = msgs.filter((x) => x.id !== m.id); emit(); force((n) => n + 1); }}>
          <div className="gs-from"><span className="gs-dot" />Glideslope</div>
          <div className="gs-title">{m.title}</div>
          <div className="gs-body">{m.body}</div>
          {m.href && <div className="gs-cta">Open debrief ›</div>}
        </div>
      ))}
    </div>
  );
}
