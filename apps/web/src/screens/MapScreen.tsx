import { MiniApproach } from "./Approach";
import { MapRoutePanel, SimbriefImport } from "../components/RouteOverview";
import type { RunwayLine } from "../components/FlightSetup";
import { isThin, usePlanNote } from "../data/plan";
import { startDemo } from "../data/demo";
import { useMemo, useState } from "react";
import { MapView } from "../components/MapView";
import { TrafficSheet } from "../components/TrafficSheet";
import { TrafficPanel } from "../components/TrafficPanel";
import { LoadPlanCard } from "../components/FlightPlanCard";
import { courseDeg, deg3, holdEntry, magToTrue, trueToMag, type Hold } from "../data/hold";
import { usePublishedHolds, type PubHold } from "../components/FlightSetup";
import { routeProgress } from "@glidepath/flight-engine";
import { Icon } from "../components/ui";
import { fmt, PHASE_LABEL, useLive } from "../data/derive";
import { getStands, NETWORK_LABEL, usePoll, type NetworkPilot, type Stand } from "../data/external";
import { arc, nm, recordTraffic, seedTrack, trackKey, trackOf } from "../data/trafficTracks";
import { activeBridge } from "../data/bridge";
import { loadAirportDb } from "../data/airports";
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
  const [panel, setPanel] = useState(false);
  const [fly, setFly] = useState<{ lon: number; lat: number; zoom: number; key: number } | null>(null);
  const [fitRoute, setFitRoute] = useState(0);
  const thin = isThin(L.plan);
  const pnote = usePlanNote();
  const [routeOpen, setRouteOpen] = useState(() => { try { const o = localStorage.getItem("glidepath.openRoute") === "1"; localStorage.removeItem("glidepath.openRoute"); return o; } catch { return false; } });
  const [rwLines, setRwLines] = useState<RunwayLine[]>([]);
  const [fitBox, setFitBox] = useState<{ box: [number, number, number, number]; key: number } | null>(null);
  // A newly loaded plan: show all of it once.
  const planKey = L.plan ? `${L.plan.origin.icao}-${L.plan.destination.icao}-${L.plan.fetchedAt}` : "";
  const seenPlan = useRef(planKey);
  useEffect(() => { if (planKey && seenPlan.current !== planKey) { seenPlan.current = planKey; setFollow(false); setFitRoute(Date.now()); } }, [planKey]);
  const showRoute = () => { setFollow(false); setFitRoute(Date.now()); };
  const [fixSel, setFixSel] = useState<number | null>(null);
  const [planAsk, setPlanAsk] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setPanel(true); setLayers(false); } else if (e.key === "Escape") { setPanel(false); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const [holds, setHolds] = useState<Hold[]>(() => { try { return JSON.parse(sessionStorage.getItem("glidepath.holds") ?? "[]") as Hold[]; } catch { return []; } });
  const pubLive = useApp((st) => st.mode) === "bridge";
  const pubHolds = usePublishedHolds(L.plan ?? null, pubLive);
  // The chosen approach's published holds draw by themselves (unless you've set your own there).
  const autoHolds: Hold[] = pubHolds.onApproach.filter((p) => !holds.some((h) => h.ident === p.ident)).map((p) => ({ ident: p.ident, lat: p.lat, lon: p.lon, inboundDeg: p.trueCourse ? p.courseDeg : magToTrue(p.courseDeg, p.lat, p.lon), right: p.right, legMin: p.legMin ?? 1, legNm: p.legNm, kt: Math.min(230, p.speedKt ?? 230), altFt: p.altFt, source: "published", speedKt: p.speedKt, minAltFt: p.altFt, maxAltFt: p.alt2Ft }));
  const saveHolds = (h: Hold[]) => { setHolds(h); try { sessionStorage.setItem("glidepath.holds", JSON.stringify(h)); } catch { /* storage off */ } };
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
  // Off with the Bridge's sim-safety setting: nothing to ask for.
  const simAi = usePoll(null as null | (() => ReturnType<typeof getLiveNetwork>), 10_000, [bridge, s.showSimTraffic]);
  const traffic = [...(vatsim.data?.pilots ?? []), ...(ivao.data?.pilots ?? []), ...(si.data?.pilots ?? []), ...(simAi.data?.pilots ?? [])].filter((p) => p.callsign !== (L.plan?.callsign ?? L.flight?.callsign));
  // Remember where every aircraft has been, so tapping one shows its track.
  useEffect(() => { recordTraffic(traffic); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vatsim.data, ivao.data, si.data, simAi.data]);
  const [db, setDb] = useState<Awaited<ReturnType<typeof loadAirportDb>> | null>(null);
  useEffect(() => { void loadAirportDb().then(setDb).catch(() => undefined); }, []);
  // Keep the tapped aircraft up to date as new positions arrive.
  const selLive = sel ? traffic.find((p) => trackKey(p) === trackKey(sel)) ?? sel : null;
  // The Bridge records every aircraft's track while it runs, even with the app closed: add that in front.
  const [trackTick, setTrackTick] = useState(0);
  const selKey = sel ? trackKey(sel) : null;
  useEffect(() => {
    const b = activeBridge();
    if (!sel || !b) return;
    let live = true;
    b.get<{ points: Array<[number, number, number, number]> }>(`/api/ext/track?network=${sel.network}&callsign=${encodeURIComponent(sel.callsign)}`)
      .then((r) => { if (live && seedTrack(sel, r.points)) setTrackTick((n) => n + 1); })
      .catch(() => undefined); // older Bridges don't record traffic
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);
  const selInfo = useMemo(() => {
    if (!selLive) return null;
    const { pts, sinceMs } = trackOf(selLive);
    const dep = selLive.dep && db ? db.get(selLive.dep) : null, arr = selLive.arr && db ? db.get(selLive.arr) : null;
    const flown = [...pts.map((p) => [p[0], p[1]]), [selLive.lon, selLive.lat]];
    const first = flown[0]!;
    const before = dep && nm(dep, { lon: first[0]!, lat: first[1]! }) > 2 ? arc(dep, { lon: first[0]!, lat: first[1]! }) : [];
    const ahead = arr ? arc(selLive, arr) : [];
    const toGo = arr ? nm(selLive, arr) : null;
    const total = dep && arr ? nm(dep, arr) : null;
    const etaMin = toGo !== null && selLive.gsKt > 60 ? Math.round((toGo / selLive.gsKt) * 60) : null;
    const climbing = pts.length > 1 ? Math.sign(selLive.altFt - pts[Math.max(0, pts.length - 4)]![2]) : 0;
    return { track: { key: trackKey(selLive), flown, before, ahead, at: [selLive.lon, selLive.lat] as [number, number] }, dep, arr, toGo, total, etaMin, sinceMs, climbing };
  }, [selLive, db, vatsim.data, ivao.data, si.data, trackTick]);
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
      getMetarsInView(view.bbox).then((m) => { setMetars(m); setWxErr(null); }).catch(() => setWxErr("Couldn't load weather stations right now."));
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
  const planRoute = useMemo(() => L.plan ? [{ lat: L.plan.origin.lat, lon: L.plan.origin.lon }, ...L.plan.fixes, { lat: L.plan.destination.lat, lon: L.plan.destination.lon }] : null, [L.plan]);
  const nextFix = planRoute && f && !L.completed && !f.position.onGround ? routeProgress(planRoute, f.position)?.legIndex ?? null : null;
  const aircraft = f && f.attitude.headingTrueDeg !== null ? { lat: f.position.lat, lon: f.position.lon, hdg: f.attitude.headingTrueDeg, alt: f.position.altMslFt } : null;
  const airports = [
    ...(L.plan ? [{ code: L.plan.origin.icao, lat: L.plan.origin.lat, lon: L.plan.origin.lon, role: "dep" as const }, { code: L.plan.destination.icao, lat: L.plan.destination.lat, lon: L.plan.destination.lon, role: "arr" as const }] : []),
  ];

  return (
    <div className="map-wrap">
      <MapView trail={trail} plan={L.plan} aircraft={aircraft} airports={airports} traffic={traffic} atc={atc} centres={centres} metars={metars} radarTiles={s.showRadar ? radar.data ?? null : null} onSelectAtc={(c) => { setAtcSel(c); setSel(null); setWxSel(null); }} onSelectMetar={(w) => { setWxSel(w); setSel(null); setAtcSel(null); }} onView={(bbox, zoom) => setView({ bbox, zoom })} follow={follow} threeD={s.map3d} stands={stands} agl={f?.position.altAglFt ?? null} onGround={!!f?.position.onGround} onSelectTraffic={(p) => { setSel(p); if (p) { setAtcSel(null); setWxSel(null); } }} onUserMove={() => setFollow(false)} selTrack={selInfo?.track ?? null} flyTo={fly} fitRoute={fitRoute} holds={[...holds, ...autoHolds]} nextFix={nextFix} runwayLines={routeOpen ? rwLines : []} fitBox={fitBox} onSelectFix={(i) => { setFixSel(i); setSel(null); setAtcSel(null); setWxSel(null); }} />
      {!sel && !atcSel && !wxSel && fixSel === null && <div className="map-ap"><MiniApproach /></div>}
      {/* The flight panel steps aside while a traffic, ATC or weather card is open, so the two never overlap. */}
      <div className={`map-hud glass strong pad${selLive || atcSel || wxSel ? " behind" : ""}`} style={{ padding: "14px 16px" }}>
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
            {nextFix !== null && L.plan && f && (() => {
              const nx = nextFix < L.plan.fixes.length ? L.plan.fixes[nextFix]! : null;
              const to = nx ?? L.plan.destination;
              const d = nm(f.position, to), gs = f.speed.gsKt ?? 0;
              const alt = nx?.altitudeFt;
              return (
                <button className="hud-next" onClick={() => { if (nx) { setFixSel(nextFix); setFollow(false); setFly({ lon: nx.lon, lat: nx.lat, zoom: 8.5, key: Date.now() }); } }}>
                  <span>Next</span><b className="data">{nx ? (/^TO?[CD]$|^T\/[CD]$/.test(nx.ident) ? (/C$/.test(nx.ident) ? "T/C" : "T/D") : nx.ident) : L.plan.destination.icao}</b>
                  <span className="data">{fmt(d)} nm{gs > 40 ? ` · ${Math.max(1, Math.round((d / gs) * 60))} min` : ""}{alt != null ? ` · ${alt >= 10000 ? `FL${String(Math.round(alt / 100)).padStart(3, "0")}` : `${fmt(alt)} ft`}` : ""}</span>
                </button>
              );
            })()}
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
      <button className={`map-search glass strong${selLive && selInfo ? " shifted" : ""}`} onClick={() => { setPanel(true); setLayers(false); }} aria-label="Search callsign, airline or airport"><span className="i">{Icon.search()}</span>Search callsign, airline or airport<kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} F</kbd></button>
      <div className="map-tools">
        {L.plan && <button className={`btn glass map-route-btn${routeOpen ? " on" : ""}`} aria-expanded={routeOpen} aria-label="Flight plan" title="Your flight plan: show the whole route" onClick={() => { const o = !routeOpen; setRouteOpen(o); if (o) { showRoute(); setSel(null); setAtcSel(null); setWxSel(null); setFixSel(null); } }}><span style={{ width: 22, height: 22 }}>{Icon.route()}</span></button>}
        <div className="map-zoom glass"><button className="btn glass" aria-label="Zoom in" onClick={() => window.dispatchEvent(new CustomEvent("glidepath-zoom", { detail: 1 }))}>+</button><button className="btn glass" aria-label="Zoom out" onClick={() => window.dispatchEvent(new CustomEvent("glidepath-zoom", { detail: -1 }))}>−</button></div>
        <button className={`btn glass${follow ? " on" : ""}`} aria-pressed={follow} aria-label="Follow my aircraft" title="Follow my aircraft" onClick={() => setFollow(!follow)}><span style={{ width: 22, height: 22 }}>{Icon.target()}</span></button>
        <button className={`btn glass map3d${s.map3d ? " on" : ""}`} aria-pressed={s.map3d} aria-label="3D chase view" title="3D chase view" onClick={() => { settingsStore.set({ map3d: !s.map3d }); if (!s.map3d) setFollow(true); }}>3D</button>
        <button className={`btn glass${panel ? " on" : ""}`} aria-expanded={panel} aria-label="Search and online now" title="Search callsigns and airports, busiest airports, favourites" onClick={() => { setPanel(!panel); setLayers(false); }}><span style={{ width: 22, height: 22 }}>{Icon.search()}</span></button>
        {panel && <div className="layers-backdrop" onClick={() => setPanel(false)} aria-hidden="true" />}
        {panel && <TrafficPanel traffic={traffic} atcCount={atc.length} onClose={() => setPanel(false)}
          onPick={(p) => { setSel(p); setAtcSel(null); setWxSel(null); setFollow(false); setFly({ lon: p.lon, lat: p.lat, zoom: 7, key: Date.now() }); setPanel(false); }}
          onAirport={(a) => { setFollow(false); setFly({ lon: a.lon, lat: a.lat, zoom: 11, key: Date.now() }); setPanel(false); }} />}
        <button className={`btn glass${s.showRadar || s.showMetars ? " on" : ""}`} aria-pressed={s.showRadar || s.showMetars} aria-label="Weather on the map" title="Weather: rain radar and airport reports" onClick={() => { const on = !(s.showRadar || s.showMetars); settingsStore.set({ showRadar: on, showMetars: on }); }}><span style={{ width: 22, height: 22 }}>{Icon.cloud()}</span></button>
        <button className={`btn glass${layers ? " on" : ""}`} aria-expanded={layers} aria-label="Map layers" title="Map layers" onClick={() => { setLayers(!layers); setPanel(false); }}><span style={{ width: 22, height: 22 }}>{Icon.layers()}</span></button>
        {layers && <div className="layers-backdrop" onClick={() => setLayers(false)} aria-hidden="true" />}
        {layers && (
          <div className="glass strong layers-pop" role="dialog" aria-label="Map layers">
            <div className="lp-top"><span>Layers</span><button className="btn small round" aria-label="Close layers" onClick={() => setLayers(false)}>{Icon.close()}</button></div>
            <p className="lp-h">Map</p>
            <BaseMapPicker />
            <p className="lp-h" style={{ marginTop: 16 }}>Traffic</p>
            <TrafficSources counts={{ vatsim: vatsim.data?.pilots.length, ivao: ivao.data?.pilots.length, sayintentions: si.data?.pilots.length, sim: bridge ? simAi.data?.pilots.length : undefined }} errors={{ vatsim: vatsim.error, ivao: ivao.error, sayintentions: si.error, sim: simAi.error }} />
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
      {routeOpen && L.plan && !sel && !atcSel && !wxSel && fixSel === null && (
        <MapRoutePanel plan={L.plan} nextFix={nextFix} onClose={() => setRouteOpen(false)} onFit={showRoute} onLines={setRwLines} onFitBox={(box) => { setFollow(false); setFitBox({ box, key: Date.now() }); }} onFocus={(lat, lon, zoom) => { setFollow(false); setFly({ lon, lat, zoom, key: Date.now() }); }}
          onPick={(i) => { const fx = L.plan!.fixes[i]; if (!fx) return; setFixSel(i); setFollow(false); setFly({ lon: fx.lon, lat: fx.lat, zoom: 8.5, key: Date.now() }); }} />
      )}
      {(!L.plan || thin) && mode !== "demo" && !sel && !atcSel && !wxSel && !routeOpen && (
        <button className="map-noplan glass strong" onClick={() => setPlanAsk(!planAsk)}><span className="dot-warn" />{!L.plan ? "No flight plan on the map" : `Only a straight line ${L.plan.origin.icao} → ${L.plan.destination.icao}`}<b>{thin && pnote?.kind === "mismatch" ? "Why?" : "Get full route"}</b></button>
      )}
      {planAsk && (!L.plan || thin) && (
        <div className="map-sheet glass strong pad plan-ask">
          <div className="between"><b style={{ fontSize: 17 }}>{thin ? "Show your full route" : "Add your flight plan"}</b><button className="btn small" aria-label="Close" onClick={() => setPlanAsk(false)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          {thin ? (
            <p className="muted" style={{ fontSize: 13.5, margin: "8px 0 10px" }}>
              {pnote?.kind === "mismatch"
                ? <>Your latest SimBrief plan is <b>{pnote.simbrief}</b>, but you're flying <b>{pnote.flying}</b>. Make a new flight plan in SimBrief for this flight, then press Import.</>
                : <>The sim only knows <b>{L.plan!.origin.icao} direct to {L.plan!.destination.icao}</b>. That's normal when you put the route into the aircraft's own MCDU (Fenix, PMDG, iniBuilds and others): the sim never sees it. Import the same plan from SimBrief and the map shows every waypoint, SID and STAR.{pnote?.kind === "failed" ? ` (Last try: ${pnote.msg})` : ""}</>}
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 13.5, margin: "8px 0 10px" }}><b>Planned in MSFS?</b> Set your route in the world map and start the flight. The Bridge picks it up by itself within a few seconds.</p>
          )}
          <SimbriefImport />
        </div>
      )}
      {fixSel !== null && L.plan && L.plan.fixes[fixSel] && (() => {
        const plan = L.plan!, fx = plan.fixes[fixSel]!;
        const prev = fixSel === 0 ? plan.origin : plan.fixes[fixSel - 1]!;
        const inboundTrue = courseDeg(prev, fx);
        const held = holds.find((h) => h.ident === fx.ident && Math.abs(h.lat - fx.lat) < 1e-3);
        const pub = pubHolds.all.find((h) => h.ident === fx.ident);
        const kt = Math.round(Math.max(180, Math.min(265, f?.speed.tasKt ?? f?.speed.gsKt ?? 230)));
        const put = (h: Hold) => saveHolds([...holds.filter((x) => x !== held), h]);
        const fromPub = (p: PubHold): Hold => ({ ident: fx.ident, lat: fx.lat, lon: fx.lon, inboundDeg: p.trueCourse ? p.courseDeg : magToTrue(p.courseDeg, fx.lat, fx.lon), right: p.right, legMin: p.legMin ?? 1, legNm: p.legNm, kt: Math.min(kt, p.speedKt ?? kt), altFt: p.altFt, source: "published", speedKt: p.speedKt, minAltFt: p.altFt, maxAltFt: p.alt2Ft });
        const mine = (): Hold => ({ ident: fx.ident, lat: fx.lat, lon: fx.lon, inboundDeg: inboundTrue, right: true, legMin: (fx.altitudeFt ?? 0) > 14000 ? 1.5 : 1, kt, altFt: fx.altitudeFt ?? null, source: "you" });
        const hdg = f?.attitude.headingTrueDeg ?? null;
        const alt = fx.altitudeFt;
        const altTxt = (v: number | null | undefined) => (v == null ? null : v >= 10000 ? `FL${String(Math.round(v / 100)).padStart(3, "0")}` : `${fmt(v)} ft`);
        const legTxt = (h: Hold) => (h.legNm ? `${h.legNm} nm legs` : `${h.legMin} min legs`);
        const limits = (h: { speedKt?: number | null; minAltFt?: number | null; maxAltFt?: number | null }) => [h.speedKt ? `max ${h.speedKt} kt` : null, h.minAltFt || h.maxAltFt ? [altTxt(h.minAltFt), altTxt(h.maxAltFt)].filter(Boolean).join(" to ") : null].filter(Boolean).join(" · ");
        const magIn = held ? trueToMag(held.inboundDeg, held.lat, held.lon) : 0;
        return (
          <div className="map-sheet glass strong pad fix-sheet">
            <div className="between"><span><span className="data" style={{ fontWeight: 700, fontSize: 20 }}>{fx.ident}</span>{fx.name && fx.name !== fx.ident && <span className="muted" style={{ marginLeft: 8, fontSize: 13.5 }}>{fx.name}</span>}</span><button className="btn small" aria-label="Close" onClick={() => setFixSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
            <div className="grid cols-2" style={{ gap: 8, marginTop: 12 }}>
              <Mini k="PLANNED" v={altTxt(alt) ?? "—"} />
              <Mini k="VIA" v={fx.via ?? (fx.proc === "sid" ? plan.sid ?? "SID" : fx.proc === "star" ? plan.star ?? "STAR" : "DCT")} />
              <Mini k="COURSE IN" v={`${deg3(trueToMag(inboundTrue, fx.lat, fx.lon))}°M`} />
              <Mini k="FROM YOU" v={f ? `${fmt(nm(f.position, fx))} nm` : "—"} />
            </div>
            <p className="lp-h" style={{ marginTop: 14 }}>Hold at {fx.ident}</p>
            {held ? (<>
              <p className="hold-src">{held.source === "published" ? <><span className="pill hs-pub">Published</span>From the sim's navdata. Check it against your chart.</> : <><span className="pill hs-you">Your hold</span>Set it to what your chart or ATC gives you.</>}</p>
              <p style={{ margin: "0 0 10px", fontSize: 14.5 }}>Inbound <b className="data">{deg3(magIn)}°M</b>, {held.right ? "right" : "left"} turns, {legTxt(held)}{limits(held) ? <>, {limits(held)}</> : null}.{hdg !== null && <> Entry from your heading: <b>{holdEntry(held, hdg)}</b>.</>}</p>
              <div className="hold-edit">
                <label>Inbound °M<input className="input data" inputMode="numeric" defaultValue={deg3(magIn)} key={`in-${held.inboundDeg}`} onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 360) put({ ...held, inboundDeg: magToTrue(v, held.lat, held.lon), source: "you" }); }} /></label>
                <label>Leg<input className="input data" inputMode="decimal" defaultValue={held.legNm ?? held.legMin} key={`leg-${held.legNm}-${held.legMin}`} onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v < 30) put(held.legNm ? { ...held, legNm: v, source: "you" } : { ...held, legMin: v, source: "you" }); }} /></label>
                <div className="seg" role="group" aria-label="Leg unit"><button className={!held.legNm ? "on" : ""} onClick={() => put({ ...held, legNm: null, source: "you" })}>min</button><button className={held.legNm ? "on" : ""} onClick={() => put({ ...held, legNm: held.legNm ?? Math.round(((held.kt * held.legMin) / 60) * 10) / 10, source: "you" })}>nm</button></div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button className="btn small" onClick={() => put({ ...held, right: !held.right, source: "you" })}>{held.right ? "Left turns" : "Right turns"}</button>
                <button className="btn small" onClick={() => put({ ...held, inboundDeg: (held.inboundDeg + 180) % 360, source: "you" })}>Reverse inbound</button>
                {pub && held.source !== "published" && <button className="btn small" onClick={() => put(fromPub(pub))}>Use published hold</button>}
                <button className="btn small danger" onClick={() => saveHolds(holds.filter((x) => x !== held))}>Remove hold</button>
              </div>
            </>) : pub ? (<>
              <p style={{ margin: "0 0 10px", fontSize: 14.5 }}><span className="pill hs-pub">Published</span> Inbound <b className="data">{deg3(pub.trueCourse ? trueToMag(pub.courseDeg, fx.lat, fx.lon) : pub.courseDeg)}°M</b>, {pub.right ? "right" : "left"} turns, {pub.legNm ? `${pub.legNm} nm` : `${pub.legMin ?? 1} min`} legs{limits({ speedKt: pub.speedKt, minAltFt: pub.altFt, maxAltFt: pub.alt2Ft }) ? `, ${limits({ speedKt: pub.speedKt, minAltFt: pub.altFt, maxAltFt: pub.alt2Ft })}` : ""}.</p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary small" onClick={() => put(fromPub(pub))}>Show published hold</button>
                <button className="btn small" onClick={() => put(mine())}>Set my own</button>
              </div>
            </>) : (<>
              <p className="muted" style={{ margin: "0 0 10px", fontSize: 13.5 }}>{pubLive ? "No published hold at this fix in the sim's navdata." : "Published holds come from the sim's navdata through your Bridge."} Add one and set the inbound course, turns and leg length from your chart or ATC.</p>
              <button className="btn primary small" onClick={() => put(mine())}>Add hold</button>
            </>)}
          </div>
        );
      })()}
      {wxSel && (
        <div className="map-sheet glass strong pad">
          <div className="between"><span className="data" style={{ fontWeight: 700, fontSize: 18 }}>{wxSel.icao} <span className={`pill wx-${wxSel.category || "na"}`} style={{ fontSize: 12, marginLeft: 6 }}>{wxSel.category || "No category"}</span></span><button className="btn small" aria-label="Close" onClick={() => setWxSel(null)}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button></div>
          <div className="grid cols-2" style={{ gap: 8, marginTop: 12 }}><Mini k="WIND" v={wxSel.wind || "—"} /><Mini k="TEMP" v={wxSel.temp || "—"} /></div>
          <p className="data" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.45 }}>{wxSel.raw}</p>
          <a className="btn small" href={`#/airports/${wxSel.icao}`}>Airport page</a>
        </div>
      )}
      {selLive && selInfo && <TrafficSheet p={selLive} info={{ dep: selInfo.dep, arr: selInfo.arr, toGo: selInfo.toGo, total: selInfo.total, etaMin: selInfo.etaMin, sinceMs: selInfo.sinceMs, climbing: selInfo.climbing, hasBefore: selInfo.track.before.length > 0, hasAhead: selInfo.track.ahead.length > 0 }} me={f ? { lat: f.position.lat, lon: f.position.lon } : null} onClose={() => setSel(null)} />}
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div><div className="faint data" style={{ fontSize: 11 }}>{k}</div><div className="data" style={{ fontSize: 16 }}>{v}</div></div>;
}
function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="between" style={{ padding: "6px 0", cursor: "pointer" }}><span>{label}</span><input className="switch" type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /></label>;
}
