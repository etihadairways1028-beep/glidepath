import { ChartsScreen } from "./screens/Charts";
import { RemoteScreen } from "./screens/Remote";
import { ToolsScreen } from "./screens/Tools";
import { ChecklistsScreen } from "./screens/Checklists";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, Mark } from "./components/ui";
import { activeBridge, BridgeClient, consumePairingLink, detectBridgeUrl, setActiveBridge } from "./data/bridge";
import { findBridgeOnNetwork, initCloud, saveBridge, syncFlights, useCloud } from "./data/cloud";
import type { FlightSummary } from "@glidepath/protocol";
import { startDemo } from "./data/demo";
import { settingsStore, store, useApp, useSettings } from "./data/store";
import { CockpitScreen } from "./screens/Cockpit";
import { WeatherScreen } from "./screens/Weather";
import { GlideslopeBanners, useFlightMessages } from "./components/Glideslope";
import { Account, hasBeenWelcomed, Welcome } from "./screens/Account";
import { CopilotScreen } from "./screens/Copilot";
import { useCallouts } from "./data/copilot";
import { Home } from "./screens/Home";
import { MapScreen } from "./screens/MapScreen";
import { FlightScreen } from "./screens/Flight";
import { Logbook, FlightDetail } from "./screens/Logbook";
import { Airports, AirportPage } from "./screens/Airports";
import { SettingsScreen } from "./screens/Settings";
import { Glance } from "./screens/Glance";

/* ---------- hash router (works on GitHub Pages and on the Bridge) ---------- */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const path = hash.replace(/^#\/?/, "").split("?")[0] || "home";
  return path.split("/").filter(Boolean);
}
export const go = (path: string) => { location.hash = `#/${path}`; };

/* ---------- connection start-up ---------- */
export function connectFromSettings(): void {
  const url = detectBridgeUrl();
  const { token } = settingsStore.get();
  if (url && token) setActiveBridge(new BridgeClient(url, token));
}

const NAV: Array<{ id: string; label: string; icon: () => ReactNode; mobile: boolean }> = [
  { id: "home", label: "Home", icon: Icon.home, mobile: true },
  { id: "map", label: "Live map", icon: Icon.map, mobile: true },
  { id: "flight", label: "Flight", icon: Icon.flight, mobile: true },
  { id: "remote", label: "Remote", icon: Icon.remote, mobile: true },
  { id: "copilot", label: "Copilot", icon: Icon.headset, mobile: false },
  { id: "logbook", label: "Logbook", icon: Icon.book, mobile: true },
  { id: "charts", label: "Charts", icon: Icon.chart, mobile: false },
  { id: "checklists", label: "Checklists", icon: Icon.checklist, mobile: false },
  { id: "tools", label: "Pilot tools", icon: Icon.calc, mobile: false },
  { id: "cockpit", label: "Cockpit tools", icon: Icon.panel, mobile: false },
  { id: "weather", label: "Weather", icon: Icon.cloud, mobile: false },
  { id: "airports", label: "Airports", icon: Icon.tower, mobile: false },
  { id: "glance", label: "Glance mode", icon: Icon.expand, mobile: false },
  { id: "account", label: "Account", icon: Icon.person, mobile: false },
  { id: "settings", label: "Settings", icon: Icon.gear, mobile: false },
];

export function App() {
  const route = useRoute();
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const status = useApp((st) => st.status);
  useCallouts();
  useFlightMessages();

  useEffect(() => {
    consumePairingLink();
    connectFromSettings();
    if (!settingsStore.get().token && new URLSearchParams(location.search).get("demo") === "1") startDemo();
    void initCloud();
  }, []);

  // Signed in but not paired on this device: look for one of the account's PCs on this Wi-Fi.
  const cloud = useCloud();
  useEffect(() => {
    if (cloud.status !== "ready" || !cloud.active || activeBridge() || store.get().mode === "demo") return;
    let gone = false;
    void findBridgeOnNetwork().then((b) => {
      if (gone || !b || activeBridge()) return;
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
    void b.get<{ bridgeId: string; addresses: string[]; port: number }>("/api/lan")
      .then((lan) => saveBridge({ bridgeId: lan.bridgeId, name: status.hostname, addresses: lan.addresses, port: lan.port, token }))
      .catch(() => undefined);
    void b.get<FlightSummary[]>("/api/flights?limit=500").then(syncFlights).catch(() => undefined);
  }, [mode, cloud.status, cloud.active, status?.bridgeId, lastDone]);

  useEffect(() => {
    document.documentElement.dataset.accent = s.accent;
    document.documentElement.dataset.glass = s.reduceTransparency ? "solid" : "glass";
  }, [s.accent, s.reduceTransparency]);

  // Light / dark / follow the device.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      // ?theme=dark|light (used by the website's iPad preview) overrides without saving.
      const forced = new URLSearchParams(location.search).get("theme");
      const theme = forced === "dark" || forced === "light" ? forced : (s.theme ?? "system") === "system" ? (mq.matches ? "light" : "dark") : s.theme;
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#DCE8F7" : "#03050C");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [s.theme]);

  // The glass highlight follows the pointer (desktop / Apple Pencil hover).
  useEffect(() => {
    let raf = 0;
    const on = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
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
    return () => window.removeEventListener("pointermove", on);
  }, []);

  const [welcomed, setWelcomed] = useState(hasBeenWelcomed);
  const [screen, ...rest] = route;
  const full = screen === "map" || screen === "glance";
  let body: ReactNode;
  switch (screen) {
    case "map": body = <MapScreen />; break;
    case "flight": body = <FlightScreen />; break;
    case "logbook": body = rest[0] ? <FlightDetail id={rest[0]} /> : <Logbook />; break;
    case "airports": body = rest[0] ? <AirportPage code={rest[0]} /> : <Airports />; break;
    case "settings": body = <SettingsScreen />; break;
    case "account": body = <Account />; break;
    case "glance": body = <Glance />; break;
    case "copilot": body = <CopilotScreen />; break;
    case "cockpit": body = <CockpitScreen />; break;
    case "checklists": body = <ChecklistsScreen />; break;
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
      <div className="shell" style={screen === "glance" ? { gridTemplateColumns: "1fr" } : undefined}>
        {screen !== "glance" && (
          <nav className="glass side" aria-label="Main">
            <a className="brand" href="#/home"><Mark />Glidepath</a>
            {NAV.map((n) => (
              <a key={n.id} className={`nav-a${screen === n.id || (!screen && n.id === "home") ? " on" : ""}`} href={`#/${n.id}`}><span className={`nav-ic ic-${n.id}`}>{n.icon()}</span>{n.label}</a>
            ))}
            <div className="side-foot faint">{mode === "demo" ? "Demo flight: synthetic data" : `Early test build${status?.bridgeVersion && status.bridgeVersion !== "demo" ? ` ${status.bridgeVersion}` : ""}`}</div>
          </nav>
        )}
        <main className="main" id="main">
          <div key={screen || "home"} className={`page page-enter${full ? " full" : ""}`}>{body}</div>
        </main>
      </div>
      {screen !== "glance" && (
        <nav className="glass tabbar" aria-label="Main">
          {NAV.filter((n) => n.mobile).map((n) => (
            <a key={n.id} className={`tab${screen === n.id ? " on" : ""}`} href={`#/${n.id}`}>{n.icon()}{n.label === "Live map" ? "Map" : n.label}</a>
          ))}
          <a className={`tab${["airports", "settings", "glance", "account", "cockpit", "weather", "checklists", "tools", "copilot", "charts"].includes(screen ?? "") ? " on" : ""}`} href="#/settings">{Icon.more()}More</a>
        </nav>
      )}
    </>
  );
}

export { store };

/** The sky behind the glass follows the flight: apron dusk, climb, high cruise, descent. */
function Sky() {
  const phase = useApp((st) => st.phase);
  const hasFlight = useApp((st) => !!(st.lastFlight ?? st.flight));
  const sky = !hasFlight ? "ground"
    : phase === "TAKEOFF" || phase === "CLIMB" ? "climb"
    : phase === "CRUISE" ? "cruise"
    : phase === "DESCENT" || phase === "APPROACH" || phase === "LANDING" ? "descent" : "ground";
  return (
    <div className="sky" data-sky={sky} aria-hidden="true">
      <div className="stars" />
      <div className="light a" /><div className="light b" /><div className="light c" />
      <div className="grain" />
    </div>
  );
}
