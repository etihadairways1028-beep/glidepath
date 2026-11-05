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
  return (
    <div className="glance">
      <div style={{ width: "min(980px, 100%)" }}>
        <div className="between" style={{ marginBottom: 14 }}>
          <a className="btn small glass" href="#/home"><span style={{ width: 16, height: 16 }}>{Icon.back()}</span>Exit</a>
          <span className="faint" style={{ fontSize: 12.5 }}>{awake === "on" ? "Screen kept awake" : awake === "unsupported" ? "Tip: set Auto-Lock to Never while flying" : ""}{mode === "demo" ? " · Demo flight" : ""}</span>
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
