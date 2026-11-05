import { useState } from "react";
import { MapView } from "../components/MapView";
import { Icon } from "../components/ui";
import { fmt, PHASE_LABEL, useLive } from "../data/derive";
import { getNetwork, usePoll, type NetworkPilot } from "../data/external";
import { settingsStore, useApp, useSettings } from "../data/store";

export function MapScreen() {
  const L = useLive();
  const trail = useApp((s) => s.trail);
  const mode = useApp((s) => s.mode);
  const s = useSettings();
  const [follow, setFollow] = useState(true);
  const [sel, setSel] = useState<NetworkPilot | null>(null);
  const [layers, setLayers] = useState(false);
  const bridge = mode === "bridge";
  const vatsim = usePoll(bridge && s.showVatsim ? () => getNetwork("vatsim") : null, 20_000, [bridge, s.showVatsim]);
  const ivao = usePoll(bridge && s.showIvao ? () => getNetwork("ivao") : null, 30_000, [bridge, s.showIvao]);
  const traffic = [...(vatsim.data?.pilots ?? []), ...(ivao.data?.pilots ?? [])].filter((p) => p.callsign !== (L.plan?.callsign ?? L.flight?.callsign));
  const f = L.frame;
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg } : null;
  const airports = [
    ...(L.plan ? [{ code: L.plan.origin.icao, lat: L.plan.origin.lat, lon: L.plan.origin.lon, role: "dep" as const }, { code: L.plan.destination.icao, lat: L.plan.destination.lat, lon: L.plan.destination.lon, role: "arr" as const }] : []),
  ];

  return (
    <div className="map-wrap">
      <MapView trail={trail} plan={L.plan} aircraft={aircraft} airports={airports} traffic={traffic} follow={follow} onSelectTraffic={setSel} onUserMove={() => setFollow(false)} />
      <div className="map-hud glass strong pad" style={{ padding: "14px 16px" }}>
        {L.flight ? (
          <>
            <div className="between">
              <span className="data" style={{ fontWeight: 700 }}>{L.flight.departureIcao ?? "····"} → {L.flight.arrivalIcao ?? L.plan?.destination.icao ?? "····"}</span>
              <span className="pill phase">{PHASE_LABEL[L.phase]}</span>
            </div>
            <div className="grid cols-4" style={{ gap: 8, marginTop: 12 }}>
              <Mini k="ALT" v={fmt(f?.position.altMslFt)} />
              <Mini k="GS" v={fmt(f?.speed.gsKt)} />
              <Mini k="V/S" v={fmt(f?.speed.vsFpm)} />
              <Mini k="HDG" v={f?.attitude.headingMagDeg === null || !f ? "—" : String(Math.round(f.attitude.headingMagDeg) % 360).padStart(3, "0")} />
            </div>
            {L.toGoNm !== null && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>{fmt(L.toGoNm)} nm to go{L.tod && !L.tod.pastTod && L.tod.minutesToTod !== null ? `, top of descent in about ${Math.max(1, Math.round(L.tod.minutesToTod))} min` : ""}</div>}
          </>
        ) : (
          <div className="muted">{mode === "none" ? "Connect your Bridge or start the demo to see your aircraft." : "No flight yet."}</div>
        )}
        {mode === "demo" && <div className="est" style={{ marginTop: 8 }}>Demo flight: synthetic data</div>}
      </div>
      <div className="map-tools">
        <button className={`btn glass${follow ? " on" : ""}`} aria-pressed={follow} aria-label="Follow my aircraft" title="Follow my aircraft" onClick={() => setFollow(!follow)}><span style={{ width: 22, height: 22 }}>{Icon.target()}</span></button>
        <button className={`btn glass${layers ? " on" : ""}`} aria-expanded={layers} aria-label="Map layers" title="Map layers" onClick={() => setLayers(!layers)}><span style={{ width: 22, height: 22 }}>{Icon.layers()}</span></button>
        {layers && (
          <div className="glass strong pad" style={{ width: 230, position: "absolute", right: 54, top: 52 }}>
            <div className="seg" role="group" aria-label="Base map" style={{ width: "100%", marginBottom: 12 }}>
              <button className={s.mapStyle !== "map" ? "on" : ""} onClick={() => settingsStore.set({ mapStyle: "satellite" })}>Satellite</button>
              <button className={s.mapStyle === "map" ? "on" : ""} onClick={() => settingsStore.set({ mapStyle: "map" })}>Map</button>
            </div>
            <Toggle label="VATSIM traffic" on={s.showVatsim} set={(v) => settingsStore.set({ showVatsim: v })} />
            <Toggle label="IVAO traffic" on={s.showIvao} set={(v) => settingsStore.set({ showIvao: v })} />
            <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>{bridge ? `${traffic.length.toLocaleString()} aircraft online` : "Traffic needs your Bridge."}{vatsim.error ? ` VATSIM: ${vatsim.error}` : ""}</p>
          </div>
        )}
      </div>
      {sel && (
        <div className="map-sheet glass strong pad">
          <div className="between"><span className="data" style={{ fontWeight: 700, fontSize: 18 }}>{sel.callsign}</span><button className="btn small" aria-label="Close" onClick={() => setSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          <div className="muted" style={{ marginTop: 2 }}>{sel.type ?? "Unknown type"} on {sel.network.toUpperCase()}</div>
          <div className="grid cols-3" style={{ gap: 8, marginTop: 12 }}>
            <Mini k="FROM" v={sel.dep ?? "—"} /><Mini k="TO" v={sel.arr ?? "—"} /><Mini k="ALT" v={fmt(sel.altFt)} />
          </div>
          <div className="muted data" style={{ fontSize: 13, marginTop: 10 }}>{fmt(sel.gsKt)} kt, heading {fmt(sel.hdg)}°</div>
        </div>
      )}
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div><div className="faint data" style={{ fontSize: 11 }}>{k}</div><div className="data" style={{ fontSize: 16 }}>{v}</div></div>;
}
function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="between" style={{ padding: "6px 0", cursor: "pointer" }}><span>{label}</span><input className="switch" type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /></label>;
}
