import { startDemo } from "../data/demo";
import { useState } from "react";
import { MapView } from "../components/MapView";
import { Icon } from "../components/ui";
import { fmt, PHASE_LABEL, useLive } from "../data/derive";
import { getStands, NETWORK_LABEL, usePoll, type NetworkPilot, type Stand } from "../data/external";
import { getLiveNetwork, getMetarsInView, type MetarDot, type PlacedController } from "../data/networks";
import { useEffect, useRef } from "react";
import { BaseMapPicker, TrafficSources } from "../components/MapLayers";
import { settingsStore, useApp, useSettings } from "../data/store";

export function MapScreen() {
  const L = useLive();
  const trail = useApp((s) => s.trail);
  const mode = useApp((s) => s.mode);
  const s = useSettings();
  const [follow, setFollow] = useState(true);
  const [sel, setSel] = useState<NetworkPilot | null>(null);
  const [layers, setLayers] = useState(false);
  useEffect(() => {
    if (!layers) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setLayers(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [layers]);
  const bridge = mode === "bridge";
  // Traffic and ATC: through the Bridge when connected, otherwise straight from each network's public feed.
  const vatsim = usePoll(s.showVatsim ? () => getLiveNetwork("vatsim") : null, 20_000, [bridge, s.showVatsim]);
  const ivao = usePoll(s.showIvao ? () => getLiveNetwork("ivao") : null, 30_000, [bridge, s.showIvao]);
  const si = usePoll(s.showSayIntentions ? () => getLiveNetwork("sayintentions") : null, 30_000, [bridge, s.showSayIntentions]);
  const traffic = [...(vatsim.data?.pilots ?? []), ...(ivao.data?.pilots ?? []), ...(si.data?.pilots ?? [])].filter((p) => p.callsign !== (L.plan?.callsign ?? L.flight?.callsign));
  const atc = s.showAtc ? [...(vatsim.data?.atc ?? []), ...(ivao.data?.atc ?? [])] : [];
  const centres = s.showAtc ? [...(vatsim.data?.controllers ?? []), ...(ivao.data?.controllers ?? [])] : [];
  const [atcSel, setAtcSel] = useState<PlacedController | null>(null);
  const [wxSel, setWxSel] = useState<MetarDot | null>(null);
  // Weather stations in view.
  const [view, setView] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [metars, setMetars] = useState<MetarDot[]>([]);
  const [wxErr, setWxErr] = useState<string | null>(null);
  useEffect(() => {
    if (!s.showMetars || !view) { setMetars([]); return; }
    if (view.zoom < 4.5) { setMetars([]); setWxErr("Zoom in to see weather stations."); return; }
    const t = window.setTimeout(() => {
      getMetarsInView(view.bbox).then((m) => { setMetars(m); setWxErr(null); }).catch(() => setWxErr(bridge ? "Couldn't load weather right now." : "Weather stations come through your Bridge. Connect it to see them."));
    }, 600);
    return () => clearTimeout(t);
  }, [s.showMetars, view?.bbox.map((v) => v.toFixed(1)).join(","), bridge]);
  // Rain radar from RainViewer (free, no key): newest frame.
  const radar = usePoll(s.showRadar ? async () => {
    const r = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
    const j = await r.json() as { host: string; radar: { past: Array<{ path: string }> } };
    const last = j.radar.past.at(-1);
    return last ? `${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png` : null;
  } : null, 10 * 60_000, [s.showRadar]);
  const f = L.frame;
  // Gates and stands from OpenStreetMap when you're at (or near) an airport.
  const [stands, setStands] = useState<Stand[]>([]);
  const standsAt = useRef<{ lat: number; lon: number } | null>(null);
  const nearGround = !!f && (f.position.onGround || (f.position.altAglFt ?? 99999) < 3000);
  useEffect(() => {
    if (!bridge || !f || !nearGround) return;
    const here = { lat: f.position.lat, lon: f.position.lon };
    const prev = standsAt.current;
    if (prev && Math.hypot(prev.lat - here.lat, (prev.lon - here.lon) * Math.cos((here.lat * Math.PI) / 180)) < 0.03) return; // ~3 km
    standsAt.current = here;
    getStands(here.lat, here.lon).then(setStands).catch(() => undefined);
  }, [bridge, nearGround, f ? Math.round(f.position.lat * 50) : 0, f ? Math.round(f.position.lon * 50) : 0]);
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg } : null;
  const airports = [
    ...(L.plan ? [{ code: L.plan.origin.icao, lat: L.plan.origin.lat, lon: L.plan.origin.lon, role: "dep" as const }, { code: L.plan.destination.icao, lat: L.plan.destination.lat, lon: L.plan.destination.lon, role: "arr" as const }] : []),
  ];

  return (
    <div className="map-wrap">
      <MapView trail={trail} plan={L.plan} aircraft={aircraft} airports={airports} traffic={traffic} atc={atc} centres={centres} metars={metars} radarTiles={s.showRadar ? radar.data ?? null : null} onSelectAtc={(c) => { setAtcSel(c); setSel(null); setWxSel(null); }} onSelectMetar={(w) => { setWxSel(w); setSel(null); setAtcSel(null); }} onView={(bbox, zoom) => setView({ bbox, zoom })} follow={follow} threeD={s.map3d} stands={stands} agl={f?.position.altAglFt ?? null} onGround={!!f?.position.onGround} onSelectTraffic={(p) => { setSel(p); if (p) { setAtcSel(null); setWxSel(null); } }} onUserMove={() => setFollow(false)} />
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
          mode === "none" ? (
            <div>
              <div style={{ fontWeight: 650, fontSize: 16 }}>No aircraft yet</div>
              <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Connect to your PC to see your flight here. Live traffic and weather work already.</div>
              <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
                <a className="btn small primary" href="#/home">Connect to my PC</a>
                <button className="btn small" onClick={() => startDemo()}>Watch a demo</button>
              </div>
            </div>
          ) : <div className="muted">Waiting for your flight to start in the sim.</div>
        )}
        {mode === "demo" && <div className="est" style={{ marginTop: 8 }}>Demo flight: synthetic data</div>}
      </div>
      <div className="map-tools">
        <button className={`btn glass${follow ? " on" : ""}`} aria-pressed={follow} aria-label="Follow my aircraft" title="Follow my aircraft" onClick={() => setFollow(!follow)}><span style={{ width: 22, height: 22 }}>{Icon.target()}</span></button>
        <button className={`btn glass map3d${s.map3d ? " on" : ""}`} aria-pressed={s.map3d} aria-label="3D chase view" title="3D chase view" onClick={() => { settingsStore.set({ map3d: !s.map3d }); if (!s.map3d) setFollow(true); }}>3D</button>
        <button className={`btn glass${layers ? " on" : ""}`} aria-expanded={layers} aria-label="Map layers" title="Map layers" onClick={() => setLayers(!layers)}><span style={{ width: 22, height: 22 }}>{Icon.layers()}</span></button>
        {layers && <div className="layers-backdrop" onClick={() => setLayers(false)} aria-hidden="true" />}
        {layers && (
          <div className="glass strong layers-pop" role="dialog" aria-label="Map layers">
            <div className="lp-top"><span>Layers</span><button className="btn small round" aria-label="Close layers" onClick={() => setLayers(false)}>{Icon.close()}</button></div>
            <p className="lp-h">Map</p>
            <BaseMapPicker />
            <p className="lp-h" style={{ marginTop: 16 }}>Traffic</p>
            <TrafficSources counts={{ vatsim: vatsim.data?.pilots.length, ivao: ivao.data?.pilots.length, sayintentions: si.data?.pilots.length }} errors={{ vatsim: vatsim.error, ivao: ivao.error, sayintentions: si.error }} />
            <p className="lp-h" style={{ marginTop: 16 }}>Overlays</p>
            <Toggle label={`Air traffic control${atc.length ? ` (${atc.length})` : ""}`} on={s.showAtc} set={(v) => settingsStore.set({ showAtc: v })} />
            <Toggle label="Rain radar" on={s.showRadar} set={(v) => settingsStore.set({ showRadar: v })} />
            <Toggle label="Weather stations (METAR)" on={s.showMetars} set={(v) => settingsStore.set({ showMetars: v })} />
            {s.showMetars && wxErr && <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>{wxErr}</p>}
            {s.showRadar && radar.error && <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>Couldn't load the radar right now.</p>}
          </div>
        )}
      </div>
      {atcSel && (
        <div className="map-sheet glass strong pad">
          <div className="between"><span className="data" style={{ fontWeight: 700, fontSize: 18 }}>{atcSel.callsign}</span><button className="btn small" aria-label="Close" onClick={() => setAtcSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          <div className="muted" style={{ marginTop: 2 }}>{atcSel.facility} on {NETWORK_LABEL[atcSel.network]}</div>
          {atcSel.frequency && <div className="data" style={{ fontSize: 26, fontWeight: 700, marginTop: 10 }}>{atcSel.frequency}</div>}
          {atcSel.atis.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 8, maxHeight: 120, overflow: "auto" }}>{atcSel.atis.join(" ")}</p>}
        </div>
      )}
      {wxSel && (
        <div className="map-sheet glass strong pad">
          <div className="between"><span className="data" style={{ fontWeight: 700, fontSize: 18 }}>{wxSel.icao} <span className={`pill wx-${wxSel.category || "na"}`} style={{ fontSize: 12, marginLeft: 6 }}>{wxSel.category || "No category"}</span></span><button className="btn small" aria-label="Close" onClick={() => setWxSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          <div className="grid cols-2" style={{ gap: 8, marginTop: 12 }}><Mini k="WIND" v={wxSel.wind || "—"} /><Mini k="TEMP" v={wxSel.temp || "—"} /></div>
          <p className="data" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.45 }}>{wxSel.raw}</p>
          <a className="btn small" href={`#/airports/${wxSel.icao}`}>Airport page</a>
        </div>
      )}
      {sel && (
        <div className="map-sheet glass strong pad">
          <div className="between"><span className="data" style={{ fontWeight: 700, fontSize: 18 }}>{sel.callsign}</span><button className="btn small" aria-label="Close" onClick={() => setSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          <div className="muted" style={{ marginTop: 2 }}>{sel.type ?? "Unknown type"} on {NETWORK_LABEL[sel.network]}</div>
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
