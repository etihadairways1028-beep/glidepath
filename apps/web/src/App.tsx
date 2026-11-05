import { useEffect, useState, type ReactNode } from "react";
import { Icon, Mark } from "./components/ui";
import { BridgeClient, consumePairingLink, detectBridgeUrl, setActiveBridge } from "./data/bridge";
import { startDemo } from "./data/demo";
import { settingsStore, store, useApp, useSettings } from "./data/store";
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
  { id: "logbook", label: "Logbook", icon: Icon.book, mobile: true },
  { id: "airports", label: "Airports", icon: Icon.tower, mobile: false },
  { id: "glance", label: "Glance mode", icon: Icon.expand, mobile: false },
  { id: "settings", label: "Settings", icon: Icon.gear, mobile: false },
];

export function App() {
  const route = useRoute();
  const s = useSettings();
  const mode = useApp((st) => st.mode);

  useEffect(() => {
    consumePairingLink();
    connectFromSettings();
    if (!settingsStore.get().token && new URLSearchParams(location.search).get("demo") === "1") startDemo();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.accent = s.accent;
    document.documentElement.dataset.glass = s.reduceTransparency ? "solid" : "glass";
  }, [s.accent, s.reduceTransparency]);

  const [screen, ...rest] = route;
  const full = screen === "map" || screen === "glance";
  let body: ReactNode;
  switch (screen) {
    case "map": body = <MapScreen />; break;
    case "flight": body = <FlightScreen />; break;
    case "logbook": body = rest[0] ? <FlightDetail id={rest[0]} /> : <Logbook />; break;
    case "airports": body = rest[0] ? <AirportPage code={rest[0]} /> : <Airports />; break;
    case "settings": body = <SettingsScreen />; break;
    case "glance": body = <Glance />; break;
    default: body = <Home />;
  }

  return (
    <>
      <div className="sky" />
      <div className="shell" style={screen === "glance" ? { gridTemplateColumns: "1fr" } : undefined}>
        {screen !== "glance" && (
          <nav className="glass side" aria-label="Main">
            <a className="brand" href="#/home"><Mark />Glidepath</a>
            {NAV.map((n) => (
              <a key={n.id} className={`nav-a${screen === n.id || (!screen && n.id === "home") ? " on" : ""}`} href={`#/${n.id}`}>{n.icon()}{n.label}</a>
            ))}
            <div className="side-foot faint">{mode === "demo" ? "Demo flight: synthetic data" : "Early test build 0.2"}</div>
          </nav>
        )}
        <main className="main" id="main">
          <div className={`page${full ? " full" : ""}`}>{body}</div>
        </main>
      </div>
      {screen !== "glance" && (
        <nav className="glass tabbar" aria-label="Main">
          {NAV.filter((n) => n.mobile).map((n) => (
            <a key={n.id} className={`tab${screen === n.id ? " on" : ""}`} href={`#/${n.id}`}>{n.icon()}{n.label === "Live map" ? "Map" : n.label}</a>
          ))}
          <a className={`tab${["airports", "settings", "glance"].includes(screen ?? "") ? " on" : ""}`} href="#/settings">{Icon.more()}More</a>
        </nav>
      )}
    </>
  );
}

export { store };
