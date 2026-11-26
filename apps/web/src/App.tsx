import { flushSync } from "react-dom";
import { Support } from "./screens/Support";
import { PerformanceScreen } from "./screens/Performance";
import { ApproachScreen } from "./screens/Approach";
import { currentLook } from "./components/Look";
import { UpdatesScreen } from "./screens/Updates";
import { Celebrate } from "./components/Celebrate";
import { Fragment } from "react";
import { useWallpaper } from "./components/Wallpaper";
import { ChartsScreen } from "./screens/Charts";
import { RemoteScreen } from "./screens/Remote";
import { ToolsScreen } from "./screens/Tools";
import { ChecklistsScreen } from "./screens/Checklists";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Mark } from "./components/ui";
import { activeBridge, BridgeClient, adoptLocalToken, consumePairingLink, detectBridgeUrl, isStandalone, setActiveBridge } from "./data/bridge";
import { startPrefsSync } from "./data/prefsSync";
import { startUnloadFlush } from "./data/unload";

/*
 * Open where you left off: the Home Screen app (and a plain visit to the app's address)
 * comes back to the page you were last on instead of Home.
 */
const LAST = "glidepath.lastRoute";
(() => {
  try {
    const h = location.hash, last = localStorage.getItem(LAST);
    const pairing = /(^#|[?&])(bridge|token|pc)=/.test(h);
    const gpk = /[?&]gpk=([^&]*)/.exec(h)?.[1];
    const fresh = h === "" || h === "#" || h === "#/" || /^#\/home(\?gpk=[^&]*)?$/.test(h);
    if (last && /^#\/[a-z]/.test(last) && !pairing && (isStandalone() || fresh)) history.replaceState(null, "", location.pathname + location.search + last + (gpk ? `${last.includes("?") ? "&" : "?"}gpk=${gpk}` : ""));
    window.addEventListener("hashchange", () => { if (/^#\/[a-z]/.test(location.hash)) localStorage.setItem(LAST, location.hash.replace(/[?&]gpk=[^&]*/, "")); });
  } catch { /* storage off */ }
})();
import { findBridgeOnNetwork, initCloud, saveBridge, syncFlights, useCloud } from "./data/cloud";
import type { FlightSummary } from "@glidepath/protocol";
import { activeDemo, startDemo } from "./data/demo";
import { initAutoConnect, tryRelay } from "./data/connect";
import { UpdateCenter } from "./components/UpdateCenter";
import { FlightCompletePrompt } from "./components/FlightReview";
import { APP_VERSION, WhatsNew } from "./components/WhatsNew";
import { SideClock } from "./components/Clock";
import { initSync } from "./data/sync";
import { settingsStore, store, useApp, useSettings } from "./data/store";
import { onNewSimbriefPlan, startPlanSync } from "./data/plan";
import { postFlightMessage } from "./components/Glideslope";
import { cloudBases } from "./data/cloud";
import { CockpitScreen } from "./screens/Cockpit";
import { WeatherScreen } from "./screens/Weather";
import { GlideslopeBanners, useFlightMessages, useApproachCoach } from "./components/Glideslope";
import { Account, ForgotPassword, ResetPassword, hasBeenWelcomed, Welcome } from "./screens/Account";
import { CopilotScreen } from "./screens/Copilot";
import { useCallouts } from "./data/copilot";
import { Home } from "./screens/Home";
import { MapScreen } from "./screens/MapScreen";
import { FlightScreen } from "./screens/Flight";
import { Logbook, FlightDetail } from "./screens/Logbook";
import { Airports, AirportPage } from "./screens/Airports";
import { SettingsScreen } from "./screens/Settings";
import { applyGlass } from "./glassLevel";
import { ScreenGuard } from "./components/ScreenGuard";
import { CareerScreen } from "./screens/CareerScreen";
import { ChallengeScreen } from "./screens/Challenge";
import { initLive } from "./data/live";
import { reviewApproach } from "@glidepath/flight-engine";
initLive();
if (location.search.includes("gpdebug")) Object.assign(window, { __gpStore: store, __gpReview: reviewApproach, __gpBridge: activeBridge, __gpDemo: activeDemo });
import { BridgeIconTip } from "./components/InstallCard";
import { Glance } from "./screens/Glance";

/* ---------- Scroll and titles when moving between screens ----------
 * A new screen starts at the top. Going back (to the screen you just came from)
 * returns you to where you were, e.g. down the logbook list. */
const scrollMemory = new Map<string, number>();
let prevHash = "", prevPrevHash = "";
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", (e) => {
    const main = document.getElementById("main");
    const from = new URL(e.oldURL).hash, to = location.hash;
    if (main) scrollMemory.set(from, main.scrollTop);
    const back = to === prevHash;
    prevPrevHash = prevHash; prevHash = from;
    void prevPrevHash;
    requestAnimationFrame(() => { const m = document.getElementById("main"); if (m) m.scrollTop = back ? scrollMemory.get(to) ?? 0 : 0; if (!back) window.scrollTo(0, 0); });
  });
}
const TITLES: Record<string, string> = { home: "", map: "Live map", flight: "Flight", remote: "Remote", logbook: "Logbook", review: "Flight review", copilot: "Copilot", charts: "Charts", checklists: "Checklists", performance: "Performance", approach: "Landing helper", tools: "Pilot tools", cockpit: "EFB", weather: "Weather", airports: "Airports", glance: "Glance", career: "Career", challenge: "Landing challenge", account: "Account", settings: "Settings", updates: "Updates", support: "Support" };

/* ---------- hash router (works on GitHub Pages and on the Bridge) ---------- */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  const hashRef = useRef(location.hash);
  useEffect(() => {
    const on = () => {
      const next = location.hash;
      const top = (h: string) => h.replace(/^#\/?/, "").split(/[/?]/)[0] || "home";
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
      // Cross-fade between screens (old one fades out while the new one rises in), where the browser can.
      if (doc.startViewTransition && top(next) !== top(hashRef.current) && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        doc.startViewTransition(() => flushSync(() => setHash(next)));
      } else setHash(next);
      hashRef.current = next;
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const path = hash.replace(/^#\/?/, "").split("?")[0] || "home";
  return path.split("/").filter(Boolean);
}
export const go = (path: string) => { location.hash = `#/${path}`; };

/* ---------- connection start-up ---------- */
/**
 * Opened from the PC's address on another device (http://192.168…:4810/app): that's the Bridge's own copy.
 * When the PC's relay link is up, move to the newest app on the website, already paired.
 */
function handOffToNewestApp(): void {
  // A Home Screen app must stay itself: moving to another address would open a browser page.
  if (isStandalone()) return;
  const lan = location.protocol === "http:" && location.pathname.startsWith("/app") && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!lan) return;
  const go = async () => {
    const { token } = settingsStore.get();
    if (!token) return;
    try {
      const r = await fetch("/api/pclink", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { online?: boolean; bid?: string };
      if (j.online && j.bid) location.replace(`https://glidepath-ad9.pages.dev/app/#pc=${encodeURIComponent(j.bid)}&token=${encodeURIComponent(token)}`);
    } catch { /* stay on this copy */ }
  };
  window.setTimeout(() => void go(), 600);
}

export function connectFromSettings(): void {
  const url = detectBridgeUrl();
  const { token, pcRelay } = settingsStore.get();
  // Paired by code through the relay (the direct link was blocked on that network).
  if (pcRelay && token && location.protocol === "https:") {
    const go = () => setActiveBridge(new BridgeClient(location.origin, token, { urls: cloudBases(), token: "", pc: { bid: pcRelay, key: token } }));
    // The service address loads a moment after the app opens.
    if (cloudBases().length) go(); else { let n = 0; const t = window.setInterval(() => { if (cloudBases().length || ++n > 40) { clearInterval(t); if (cloudBases().length) go(); } }, 150); }
    return;
  }
  if (url && token) setActiveBridge(new BridgeClient(url, token));
}

/** Sidebar sections, like the iPad's own apps: the flight first, then tools, then you. */
const SECTION_BEFORE: Record<string, string> = { copilot: "Tools", career: "You" };

const NAV: Array<{ id: string; label: string; icon: () => ReactNode; mobile: boolean }> = [
  { id: "home", label: "Home", icon: Icon.home, mobile: true },
  { id: "map", label: "Live map", icon: Icon.map, mobile: true },
  { id: "flight", label: "Flight", icon: Icon.flight, mobile: true },
  { id: "remote", label: "Remote", icon: Icon.remote, mobile: true },
  { id: "logbook", label: "Logbook", icon: Icon.book, mobile: true },
  { id: "copilot", label: "Copilot", icon: Icon.headset, mobile: false },
  { id: "charts", label: "Charts", icon: Icon.chart, mobile: true },
  { id: "performance", label: "Performance", icon: Icon.perf, mobile: false },
  { id: "approach", label: "Landing helper", icon: Icon.approach, mobile: false },
  { id: "checklists", label: "Checklists", icon: Icon.checklist, mobile: false },
  { id: "tools", label: "Pilot tools", icon: Icon.calc, mobile: false },
  { id: "cockpit", label: "EFB", icon: Icon.panel, mobile: false },
  { id: "weather", label: "Weather", icon: Icon.cloud, mobile: false },
  { id: "airports", label: "Airports", icon: Icon.tower, mobile: false },
  { id: "glance", label: "Glance mode", icon: Icon.expand, mobile: false },
  { id: "career", label: "Career", icon: Icon.career, mobile: false },
  { id: "challenge", label: "Landing challenge", icon: Icon.trophy, mobile: false },
  { id: "account", label: "Account", icon: Icon.person, mobile: false },
  { id: "settings", label: "Settings", icon: Icon.gear, mobile: false },
];

export function App() {
  const route = useRoute();
  useEffect(() => startPlanSync(() => settingsStore.get().simbriefUser ?? "", () => activeBridge()), []);
  useEffect(() => onNewSimbriefPlan((p) => postFlightMessage("New SimBrief flight loaded", `${p.origin.icao} to ${p.destination.icao}${p.callsign ? `, ${p.callsign}` : ""}. It's on your map and Flight screen.`, "info", "#/flight")), []);
  useEffect(() => { const t = TITLES[route[0] ?? "home"]; document.title = t ? `${t} · Glidepath` : "Glidepath"; }, [route[0]]);
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const status = useApp((st) => st.status);
  useCallouts();
  useFlightMessages();
  useApproachCoach();

  useEffect(() => {
    consumePairingLink();
    connectFromSettings();
    startPrefsSync();
    startUnloadFlush();
    void adoptLocalToken().then((ok) => { if (ok) connectFromSettings(); });
    handOffToNewestApp();
    if (!settingsStore.get().token && new URLSearchParams(location.search).get("demo") === "1") startDemo();
    void initCloud().then(() => { initAutoConnect(); initSync(); });
  }, []);

  // Signed in but not paired on this device: look for one of the account's PCs on this Wi-Fi.
  const cloud = useCloud();
  useEffect(() => {
    if (cloud.status !== "ready" || !cloud.active || activeBridge() || store.get().mode === "demo") return;
    let gone = false;
    void findBridgeOnNetwork().then((b) => {
      if (gone || activeBridge()) return;
      if (!b) { void tryRelay(); return; } // not on this Wi-Fi: connect through the account instead
      settingsStore.set({ bridgeUrl: b.url, token: b.token });
      connectFromSettings();
    });
    return () => { gone = true; };
  }, [cloud.status, cloud.active]);

  // Connected and signed in: remember this PC on the account, and copy finished flights.
  const lastDone = useApp((st) => (st.lastFlight?.status === "completed" ? st.lastFlight.id : null));
  useEffect(() => {
    const b = activeBridge();
    if (mode !== "bridge" || !b || cloud.status !== "ready" || !cloud.active || !status) return;
    const { token } = settingsStore.get();
    if (b.isRelay) { void b.get<FlightSummary[]>("/api/flights?limit=500").then(syncFlights).catch(() => undefined); return; }
    void b.get<{ bridgeId: string; addresses: string[]; port: number }>("/api/lan")
      .then((lan) => saveBridge({ bridgeId: lan.bridgeId, name: status.hostname, addresses: lan.addresses, port: lan.port, token }))
      .catch(() => undefined);
    void b.get<FlightSummary[]>("/api/flights?limit=500").then(syncFlights).catch(() => undefined);
  }, [mode, cloud.status, cloud.active, status?.bridgeId, lastDone]);

  useEffect(() => {
    document.documentElement.dataset.accent = s.accent;
    document.documentElement.dataset.glass = s.reduceTransparency ? "solid" : "glass";
  }, [s.accent, s.reduceTransparency]);

  // Liquid Glass strength (Settings → Appearance). 95 = clear glass with bright, thick edges.
  useEffect(() => applyGlass(s.glassLevel ?? 95), [s.glassLevel]);

  useWallpaper();

  // Light / dark / follow the device.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      // ?theme=dark|light (used by the website's iPad preview) overrides without saving.
      const forced = new URLSearchParams(location.search).get("theme");
      // Cockpit, Sunset and Neon are dark designs: they always use the dark theme.
      const theme = currentLook() !== "glass" ? "dark" : forced === "dark" || forced === "light" ? forced : (s.theme ?? "system") === "system" ? (mq.matches ? "light" : "dark") : s.theme;
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#DCE8F7" : "#03050C");
    };
    apply();
    mq.addEventListener("change", apply);
    window.addEventListener("glidepath-look", apply);
    return () => { mq.removeEventListener("change", apply); window.removeEventListener("glidepath-look", apply); };
  }, [s.theme]);

  // The glass highlight follows the pointer (desktop / Apple Pencil hover).
  useEffect(() => {
    let raf = 0;
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch" && e.type === "pointermove") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = (e.target as Element | null)?.closest?.(".glass") as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener("pointermove", on, { passive: true });
    window.addEventListener("pointerdown", on, { passive: true });
    return () => { window.removeEventListener("pointermove", on); window.removeEventListener("pointerdown", on); };
  }, []);

  const [welcomed, setWelcomed] = useState(hasBeenWelcomed);
  const [screen, ...rest] = route;
  // Which tab the liquid highlight sits under (the last one is "More").
  const mobileTabs = NAV.filter((n) => n.mobile);
  const onTab = mobileTabs.findIndex((n) => n.id === (screen || "home"));
  const tabIndex = onTab >= 0 ? onTab : mobileTabs.length;
  const full = screen === "map" || screen === "glance";
  let body: ReactNode;
  switch (screen) {
    case "map": body = <MapScreen />; break;
    case "flight": body = <FlightScreen />; break;
    case "logbook": body = rest[0] ? <FlightDetail id={rest[0]} /> : <Logbook />; break;
    case "review": body = rest[0] ? <FlightDetail id={rest[0]} review /> : <Logbook />; break;
    case "airports": body = rest[0] ? <AirportPage code={rest[0]} /> : <Airports />; break;
    case "settings": body = <SettingsScreen />; break;
    case "account": body = <Account />; break;
    case "support": body = <Support />; break;
    case "updates": body = <UpdatesScreen />; break;
    case "forgot": body = <ForgotPassword />; break;
    case "career": body = <CareerScreen />; break;
    case "challenge": body = <ChallengeScreen />; break;
    case "reset": body = <ResetPassword token={rest[0]} />; break;
    case "glance": body = <Glance />; break;
    case "copilot": body = <CopilotScreen />; break;
    case "cockpit": body = <CockpitScreen initial={rest[0]} />; break;
    case "checklists": body = <ChecklistsScreen />; break;
    case "performance": body = <PerformanceScreen />; break;
    case "approach": body = <ApproachScreen />; break;
    case "tools": body = <ToolsScreen />; break;
    case "remote": body = <RemoteScreen />; break;
    case "charts": body = <ChartsScreen />; break;
    case "weather": body = <WeatherScreen />; break;
    default: body = <Home />;
  }

  if (!welcomed) return (<><Sky /><Welcome onDone={() => setWelcomed(true)} /></>);

  return (
    <>
      <Sky />
      <GlideslopeBanners />
      <div className={`shell${screen === "glance" ? " glance" : ""}`}>
        {screen !== "glance" && (
          <nav className="glass side" aria-label="Main">
            <a className="brand" href="#/home" aria-label="Glidepath home"><Mark /><span className="nav-l">Glidepath</span></a>
            <SideClock />
            {NAV.map((n) => (
              <Fragment key={n.id}>
                {SECTION_BEFORE[n.id] && <div className="nav-sec">{SECTION_BEFORE[n.id]}</div>}
                <a className={`nav-a${screen === n.id || (!screen && n.id === "home") ? " on" : ""}`} href={`#/${n.id}`} title={n.label}><span className={`nav-ic ic-${n.id}`}>{n.icon()}</span><span className="nav-l">{n.label}</span></a>
              </Fragment>
            ))}
            <div className="side-foot faint">{mode === "demo" ? "Demo flight: synthetic data" : `Glidepath ${APP_VERSION}${status?.bridgeVersion && status.bridgeVersion !== "demo" ? ` · Bridge ${status.bridgeVersion}` : ""}`}</div>
          </nav>
        )}
        {screen !== "glance" && (
          <header className="v2-top" aria-label="Glidepath">
            <a className="v2-pill v2-brand" href="#/home" aria-label="Glidepath home"><Mark /><span>Glidepath</span></a>
            <a className="v2-pill v2-search" href="#/airports"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><span>Any airport, any chart</span></a>
            <span className="v2-gap" />
            <SideClock />
            <a className="v2-pill v2-acct" href="#/account" aria-label="Account"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg></a>
          </header>
        )}
        <main className="main" id="main">
          <BridgeIconTip />
          <UpdateCenter />
          <Celebrate />
          <FlightCompletePrompt />
          <WhatsNew />
          <div key={screen || "home"} className={`page page-enter${full ? " full" : ""}`}><ScreenGuard where={location.hash || "#/home"}>{body}</ScreenGuard></div>
        </main>
      </div>
      {screen !== "glance" && (
        <nav className="glass tabbar" aria-label="Main" style={{ ["--ti" as string]: tabIndex, ["--tn" as string]: mobileTabs.length + 1 } as React.CSSProperties}>
          {NAV.filter((n) => n.mobile).map((n) => (
            <a key={n.id} className={`tab${screen === n.id ? " on" : ""}`} href={`#/${n.id}`}>{n.icon()}{n.label === "Live map" ? "Map" : n.label}</a>
          ))}
          <a className={`tab${["airports", "settings", "glance", "account", "support", "updates", "forgot", "reset", "career", "challenge", "cockpit", "weather", "checklists", "performance", "approach", "tools", "copilot"].includes(screen ?? "") ? " on" : ""}`} href="#/settings">{Icon.more()}More</a>
        </nav>
      )}
    </>
  );
}

export { store };

const CLOUD = "M0 240 C 60 200 120 210 160 230 C 190 180 270 170 310 215 C 350 190 400 200 430 230 C 470 170 560 160 600 220 C 640 195 700 200 730 232 C 770 180 860 175 900 225 C 940 200 990 205 1020 232 C 1060 190 1140 185 1200 235 L 1200 300 L 0 300 Z";

/** The sky behind the glass follows the flight: apron dusk, climb, high cruise, descent, day or night. */
function Sky() {
  const phase = useApp((st) => st.phase);
  const hasFlight = useApp((st) => !!(st.lastFlight ?? st.flight));
  // Day or night where the aircraft is (or here): from the sun's hour angle, good enough for a sky.
  const lon = useApp((st) => st.frame?.position.lon ?? null);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
  const now = new Date();
  const solarH = ((now.getUTCHours() + now.getUTCMinutes() / 60 + (lon ?? -now.getTimezoneOffset() / 4) / 15) % 24 + 24) % 24;
  const day = solarH > 6.3 && solarH < 18.2;
  const sky = !hasFlight ? "ground"
    : phase === "TAKEOFF" || phase === "CLIMB" ? "climb"
    : phase === "CRUISE" ? "cruise"
    : phase === "DESCENT" || phase === "APPROACH" || phase === "LANDING" ? "descent" : "ground";
  return (
    <div className="sky" data-sky={sky} data-day={day ? "day" : "night"} aria-hidden="true">
      <div className="sky-scene">
        <div className="ss-orb o1" /><div className="ss-orb o2" /><div className="ss-orb o3" />
        <div className="ss-sun" />
        <div className="ss-stars" />
        <div className="ss-shoot" />
        <svg className="ss-clouds a" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d={CLOUD} /></svg>
        <svg className="ss-clouds b" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d={CLOUD} /></svg>
      </div>
      <div className="stars" />
      <div className="light a" /><div className="light b" /><div className="light c" />
      <div className="grain" />
    </div>
  );
}
