/**
 * Glance mode: a full-screen, high-contrast view for an iPad on a stand or a
 * second monitor. Keeps the screen awake where the browser allows it.
 */
import { useEffect, useState } from "react";
import { LiveCard } from "../components/LiveCard";
import { StatusPill, TimingsStrip } from "../components/Timings";
import { Icon, Tile } from "../components/ui";
import { countdown, fmt, fuel, useLive } from "../data/derive";
import { useApp, useSettings } from "../data/store";
import { MapView } from "../components/MapView";

export function Glance() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const { fuelUnit } = useSettings();
  const [awake, setAwake] = useState<"on" | "unsupported" | "off">("off");

  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const request = () => {
      if (!nav.wakeLock) { setAwake("unsupported"); return; }
      nav.wakeLock.request("screen").then((l) => { lock = l; setAwake("on"); }).catch(() => setAwake("unsupported"));
    };
    request();
    const vis = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lock?.release(); };
  }, []);

  const f = L.frame;
  const trail = useApp((s) => s.trail);
  const [layout, setLayout] = useState<"auto" | "card" | "cockpit">(() => { try { return (localStorage.getItem("glidepath.glanceLayout") as "auto" | "card" | "cockpit") || "auto"; } catch { return "auto"; } });
  const [wide, setWide] = useState(() => window.matchMedia("(orientation: landscape) and (min-width: 1000px)").matches);
  useEffect(() => { const mq = window.matchMedia("(orientation: landscape) and (min-width: 1000px)"); const h = () => setWide(mq.matches); mq.addEventListener("change", h); return () => mq.removeEventListener("change", h); }, []);
  const cockpit = layout === "cockpit" || (layout === "auto" && wide);
  const pick = (v: "card" | "cockpit") => { const next = (v === "cockpit") === wide ? "auto" : v; setLayout(next); try { localStorage.setItem("glidepath.glanceLayout", next); } catch { /* ignore */ } };
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg } : null;

  if (cockpit) {
    return (
      <div className="glance glance-cockpit">
        <div className="gc-top between">
          <a className="btn small glass" href="#/home"><span style={{ width: 16, height: 16 }}>{Icon.back()}</span>Exit</a>
          <div className="seg glass" role="group" aria-label="Layout"><button onClick={() => pick("card")}>Card</button><button className="on">Cockpit</button></div>
        </div>
        <div className="gc-left">
          {L.flight ? <LiveCard big /> : <div className="glass pad empty"><div className="h2">No live flight</div><p className="muted">Start your sim, or the demo from Home.</p></div>}
          {L.timings && <TimingsStrip t={L.timings} big />}
          {f && (
            <div className="gc-tiles">
              <Tile k="Altitude" v={fmt(f.position.altMslFt)} unit="ft" />
              <Tile k="Ground speed" v={fmt(f.speed.gsKt)} unit="kt" />
              <Tile k="Vertical speed" v={fmt(f.speed.vsFpm)} unit="fpm" />
              <Tile k={L.fuelAtDestinationKg !== null ? "Fuel at dest." : "Fuel"} v={fuel(L.fuelAtDestinationKg ?? f.fuel.totalKg, fuelUnit)} />
            </div>
          )}
        </div>
        <div className="gc-map glass">
          <MapView trail={trail} plan={L.plan} aircraft={aircraft} follow interactive agl={f?.position.altAglFt ?? null} onGround={!!f?.position.onGround} />
          {L.timings && (L.timings.toTopOfDescentMs !== null || L.timings.toGateMs !== null) && (
            <div className="gc-map-tags">
              {L.timings.toTopOfDescentMs !== null ? <span className="tm-pill glass"><span className="faint">TOD in</span> {countdown(L.timings.toTopOfDescentMs)}</span> : null}
              {L.timings.toGateMs !== null ? <span className="tm-pill glass"><span className="faint">Gate in</span> {countdown(L.timings.toGateMs)}</span> : null}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="glance">
      <div style={{ width: "min(980px, 100%)" }}>
        <div className="between" style={{ marginBottom: 14 }}>
          <a className="btn small glass" href="#/home"><span style={{ width: 16, height: 16 }}>{Icon.back()}</span>Exit</a>
          {wide || layout !== "auto" ? <div className="seg glass" role="group" aria-label="Layout"><button className="on">Card</button><button onClick={() => pick("cockpit")}>Cockpit</button></div> : null}
          <span className="faint" style={{ fontSize: 12.5 }}>{awake === "on" ? "Screen kept awake" : awake === "unsupported" ? "Tip: set Auto-Lock to Never while flying" : ""}{mode === "demo" ? (awake === "on" || awake === "unsupported" ? ". Demo flight" : "Demo flight") : ""}</span>
        </div>
        {L.flight ? <LiveCard big /> : <div className="glass pad empty"><div className="h2">No live flight</div><p className="muted">Start your sim, or the demo from Home.</p></div>}
        {L.timings && (
          <div style={{ marginTop: 14 }}>
            <TimingsStrip t={L.timings} big />
            <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <StatusPill label="Departure" status={L.timings.departure} />
              <StatusPill label="Arrival" status={L.timings.arrival} />
              {L.timings.toTopOfDescentMs !== null ? <span className="tm-pill"><span className="faint">Top of descent in</span> {countdown(L.timings.toTopOfDescentMs)}</span> : null}
              {L.timings.toGateMs !== null ? <span className="tm-pill"><span className="faint">At the gate in</span> {countdown(L.timings.toGateMs)}</span> : null}
            </div>
          </div>
        )}
        {f && (
          <div className="glance-strip">
            <Tile k="Altitude" v={fmt(f.position.altMslFt)} unit="ft" />
            <Tile k="Ground speed" v={fmt(f.speed.gsKt)} unit="kt" />
            <Tile k="Vertical speed" v={fmt(f.speed.vsFpm)} unit="fpm" />
            <Tile k={L.fuelAtDestinationKg !== null ? "Fuel at destination" : "Fuel"} v={fuel(L.fuelAtDestinationKg ?? f.fuel.totalKg, fuelUnit)} />
          </div>
        )}
      </div>
    </div>
  );
}
