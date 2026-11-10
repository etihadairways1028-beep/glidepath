/**
 * Map: MapLibre GL (open source), no API keys.
 *  - Satellite: Sentinel-2 cloudless imagery by EOX (Copernicus data), with
 *    OpenFreeMap labels, borders and runways drawn over it.
 *  - Standard: Glidepath's own street map (streetStyle.ts) on OpenFreeMap tiles,
 *    light or dark with the app. OpenFreeMap's stock styles are also offered.
 *  - Offline: bundled Natural Earth coastlines if neither can load.
 *  Own aircraft and airport labels are HTML markers, so they never depend on remote fonts.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FlightPlan } from "@glidepath/protocol";
import type { TrailPoint } from "../data/store";
import { useSettings } from "../data/store";
import type { NetworkPilot } from "../data/external";
import type { MetarDot, PlacedController } from "../data/networks";

import { OFM, OFM_ATTR, streetStyle } from "./streetStyle";
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a> (Mapzen, USGS, others)';
const S2_ATTR = '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)';

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      s2: { type: "raster", tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"], tileSize: 256, maxzoom: 14, attribution: S2_ATTR },
      omt: { type: "vector", url: `${OFM}/planet`, attribution: OFM_ATTR },
      land: { type: "geojson", data: "data/land.geojson" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0a1830" } },
      { id: "land-under", type: "fill", source: "land", paint: { "fill-color": "#22301f" } },
      { id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.12, "raster-contrast": 0.08, "raster-brightness-max": 0.88, "raster-fade-duration": 250 } },
      { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["all", ["<=", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "rgba(255,255,255,0.35)", "line-width": 0.9 } },
      { id: "place-city", type: "symbol", source: "omt", "source-layer": "place", minzoom: 3, filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10.5, 10, 14], "text-letter-spacing": 0.02 },
        paint: { "text-color": "rgba(255,255,255,0.92)", "text-halo-color": "rgba(0,0,0,0.65)", "text-halo-width": 1.4, "text-halo-blur": 0.6 } },
      { id: "place-country", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 6, filter: ["==", ["get", "class"], "country"],
        layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.15 },
        paint: { "text-color": "rgba(255,255,255,0.7)", "text-halo-color": "rgba(0,0,0,0.6)", "text-halo-width": 1.2 } },
    ],
  };
}

/** Bundled coastlines only: used when nothing remote can load. */
const OFFLINE: StyleSpecification = {
  version: 8,
  sources: { land: { type: "geojson", data: "data/land.geojson" }, borders: { type: "geojson", data: "data/borders.geojson", attribution: "Natural Earth" } },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#071226" } },
    { id: "land", type: "fill", source: "land", paint: { "fill-color": "#132244" } },
    { id: "land-edge", type: "line", source: "land", paint: { "line-color": "#2a3d6e", "line-width": 0.8 } },
    { id: "borders", type: "line", source: "borders", paint: { "line-color": "#2f4478", "line-width": 0.7, "line-dasharray": [3, 2] } },
  ],
};

type Kind = "satellite" | "std-light" | "std-dark" | "dark" | "light" | "fiord" | "liberty" | "bright" | "offline";
const LIGHT_KINDS: Kind[] = ["std-light", "light", "liberty", "bright"];
function styleFor(k: Kind): StyleSpecification | string {
  if (k === "satellite") return satelliteStyle();
  if (k === "offline") return OFFLINE;
  if (k === "std-light" || k === "std-dark") return streetStyle(k === "std-light" ? "light" : "dark");
  return `${OFM}/styles/${k === "light" ? "positron" : k}`;
}
function themeNow(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export interface MapViewProps {
  trail: TrailPoint[];
  plan?: FlightPlan | null;
  aircraft?: { lat: number; lon: number; hdg: number } | null;
  airports?: Array<{ code: string; lat: number; lon: number; role: "dep" | "arr" }>;
  traffic?: NetworkPilot[];
  /** Air traffic controllers with a position, per network. */
  atc?: PlacedController[];
  /** Weather stations, coloured by flight category. */
  metars?: MetarDot[];
  /** RainViewer radar tile URL template, or null for off. */
  radarTiles?: string | null;
  onSelectAtc?: (c: PlacedController | null) => void;
  onSelectMetar?: (m: MetarDot | null) => void;
  /** Visible area after each move: [west, south, east, north]. */
  onView?: (bbox: [number, number, number, number], zoom: number) => void;
  follow?: boolean;
  /** Where to start when there's no aircraft (an airport page, say). */
  center?: [number, number];
  zoom?: number;
  /** Tilted chase view with 3D terrain. */
  threeD?: boolean;
  /** Gates and stands near the aircraft (from OpenStreetMap, via the Bridge). */
  stands?: Array<{ ref: string; kind: "gate" | "stand"; lat: number; lon: number }>;
  /** Height above ground and on-ground state, for the chase camera. */
  agl?: number | null;
  onGround?: boolean;
  onSelectTraffic?: (p: NetworkPilot | null) => void;
  onUserMove?: () => void;
  interactive?: boolean;
}

export function MapView({ trail, plan, aircraft, airports = [], traffic = [], atc = [], metars = [], radarTiles = null, onSelectAtc, onSelectMetar, onView, follow, center, zoom: startZoom, threeD = false, stands = [], agl = null, onGround = false, onSelectTraffic, onUserMove, interactive = true }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const acMarker = useRef<maplibregl.Marker | null>(null);
  const aptMarkers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  const [tilesOk, setTilesOk] = useState(true);
  const { mapStyle } = useSettings();
  const [theme, setTheme] = useState(themeNow);
  const kindRef = useRef<Kind>("satellite");
  const data = useRef<{ route: number[][]; trail: number[][]; traffic: unknown; stands: unknown; atc: unknown; metars: unknown; radar: string | null; fixes: unknown }>({ route: [], trail: [], traffic: empty(), stands: empty(), atc: empty(), metars: empty(), radar: null, fixes: empty() });
  const threeDRef = useRef(threeD);
  threeDRef.current = threeD;
  const glideRaf = useRef(0);
  const groundZoomed = useRef(false);
  const zoomGoal = useRef<number | null>(null);
  /** Smooth camera move drawn frame by frame. MapLibre's own easeTo can leave
   *  the 3D terrain camera stale at high zoom and draw a blank map, jumpTo can't. */
  const glide = (m: MLMap, to: { center: [number, number]; zoom: number; pitch: number; bearing: number; top: number }, ms: number) => {
    cancelAnimationFrame(glideRaf.current);
    const c0 = m.getCenter(), z0 = m.getZoom(), p0 = m.getPitch(), b0 = m.getBearing(), t0 = m.getPadding().top ?? 0;
    const db = ((to.bearing - b0 + 540) % 360) - 180;
    const start = performance.now();
    const step = () => {
      if (map.current !== m) return;
      const k = Math.min(1, (performance.now() - start) / ms);
      const e = k < 1 ? 1 - Math.pow(1 - k, 2) : 1;
      m.jumpTo({ center: [c0.lng + (to.center[0] - c0.lng) * e, c0.lat + (to.center[1] - c0.lat) * e], zoom: z0 + (to.zoom - z0) * e, pitch: p0 + (to.pitch - p0) * e, bearing: b0 + db * e, padding: { top: t0 + (to.top - t0) * e, bottom: 0, left: 0, right: 0 } });
      if (k < 1) glideRaf.current = requestAnimationFrame(step);
    };
    step();
  };
  const handlers = useRef({ onSelectTraffic, onUserMove, onSelectAtc, onSelectMetar, onView });
  handlers.current = { onSelectTraffic, onUserMove, onSelectAtc, onSelectMetar, onView };

  // Follow the app's light/dark theme.
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(themeNow()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const wanted: Kind = !tilesOk ? "offline" : mapStyle === "map" ? (theme === "light" ? "std-light" : "std-dark") : (mapStyle as Kind);

  const addOverlays = (m: MLMap) => {
    for (const [net, col] of Object.entries(NET_COLOR)) if (!m.hasImage(`traffic-${net}`)) m.addImage(`traffic-${net}`, trafficIcon(col), { pixelRatio: 2.4 });
    if (m.getSource("trail")) return;
    addAirportLayers(m, kindRef.current);
    m.addSource("stands", { type: "geojson", data: data.current.stands as ReturnType<typeof empty> });
    m.addLayer({ id: "stands", type: "circle", source: "stands", minzoom: 14, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 18, 6], "circle-color": "#64D2FF", "circle-stroke-color": "rgba(0,0,0,.6)", "circle-stroke-width": 1 } });
    m.addLayer({ id: "stands-label", type: "symbol", source: "stands", minzoom: 15, layout: { "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 14], "text-offset": [0, 1.1], "text-allow-overlap": false }, paint: { "text-color": "#E8F6FF", "text-halo-color": "rgba(0,20,40,.85)", "text-halo-width": 1.6 } });
    m.addSource("route", { type: "geojson", data: line(data.current.route) });
    m.addSource("trail", { type: "geojson", data: line(data.current.trail), lineMetrics: true });
    m.addSource("traffic", { type: "geojson", data: data.current.traffic as ReturnType<typeof empty> });
    const light = LIGHT_KINDS.includes(kindRef.current);
    m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round" }, paint: { "line-color": light ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.35)", "line-width": 4.5 } });
    m.addSource("fixes", { type: "geojson", data: data.current.fixes as ReturnType<typeof empty> });
    m.addLayer({ id: "fixes", type: "circle", source: "fixes", minzoom: 4.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4.5, 2.2, 9, 4], "circle-color": light ? "#fff" : "#1B1030", "circle-stroke-color": "#E05CFF", "circle-stroke-width": 1.6 } });
    m.addLayer({ id: "fixes-label", type: "symbol", source: "fixes", minzoom: 5.5, layout: { "text-field": ["get", "ident"], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-offset": [0, 0.95], "text-anchor": "top", "text-letter-spacing": 0.04 }, paint: { "text-color": light ? "#9B2FC2" : "#F0A6FF", "text-halo-color": light ? "rgba(255,255,255,.95)" : "rgba(10,6,20,.85)", "text-halo-width": 1.4 } });
    m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round" }, paint: { "line-color": "#E05CFF", "line-width": 2, "line-dasharray": [2.2, 1.6], "line-opacity": 0.95 } });
    m.addLayer({ id: "trail-glow", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": light ? "#FFFFFF" : "#0A84FF", "line-width": 7, "line-opacity": light ? 0.9 : 0.25, "line-blur": light ? 0 : 3 } });
    m.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": 3.4, "line-color": "#0A84FF" } });
    // Weather radar under everything we draw.
    if (data.current.radar) addRadar(m, data.current.radar);
    m.addSource("metars", { type: "geojson", data: data.current.metars as ReturnType<typeof empty> });
    m.addLayer({ id: "metars", type: "circle", source: "metars", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 9, 7], "circle-color": ["match", ["get", "cat"], "VFR", "#30D158", "MVFR", "#0A84FF", "IFR", "#FF453A", "LIFR", "#BF5AF2", "#8E8E93"], "circle-stroke-color": light ? "#fff" : "rgba(0,0,0,.65)", "circle-stroke-width": 1.2, "circle-opacity": 0.95 } });
    m.addLayer({ id: "metars-label", type: "symbol", source: "metars", minzoom: 6.5, layout: { "text-field": ["get", "icao"], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-offset": [0, 1.15], "text-anchor": "top" }, paint: { "text-color": light ? "#1C1C1E" : "#F2F2F7", "text-halo-color": light ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.75)", "text-halo-width": 1.3 } });
    m.addSource("atc", { type: "geojson", data: data.current.atc as ReturnType<typeof empty> });
    m.addLayer({ id: "atc-halo", type: "circle", source: "atc", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, ["match", ["get", "kind"], "ctr", 14, "app", 8, 4], 9, ["match", ["get", "kind"], "ctr", 46, "app", 34, 18]], "circle-color": ["get", "col"], "circle-opacity": 0.12, "circle-stroke-color": ["get", "col"], "circle-stroke-width": 1.2, "circle-stroke-opacity": 0.55 } });
    m.addLayer({ id: "atc", type: "circle", source: "atc", paint: { "circle-radius": 4, "circle-color": ["get", "col"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.4 } });
    m.addLayer({ id: "atc-label", type: "symbol", source: "atc", minzoom: 4, layout: { "text-field": ["concat", ["get", "callsign"], "\n", ["get", "freq"]], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true }, paint: { "text-color": ["get", "col"], "text-halo-color": light ? "rgba(255,255,255,.92)" : "rgba(0,0,0,.8)", "text-halo-width": 1.4 } });
    m.addLayer({ id: "traffic", type: "symbol", source: "traffic", layout: { "icon-image": ["concat", "traffic-", ["get", "net"]], "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.55, 9, 1] }, paint: { "icon-opacity": 0.95 } });
  };

  useEffect(() => {
    if (!el.current) return;
    kindRef.current = wanted;
    const m = new maplibregl.Map({
      container: el.current, style: styleFor(wanted), center: aircraft ? [aircraft.lon, aircraft.lat] : center ?? [0, 30], zoom: aircraft ? 7 : startZoom ?? (center ? 14 : 1.6),
      attributionControl: { compact: true }, interactive, dragRotate: false, pitchWithRotate: false, fadeDuration: 150,
    });
    map.current = m; if (location.search.includes("gpdebug")) (window as unknown as { __gpMap?: unknown }).__gpMap = m;
    let failures = 0;
    m.on("error", (e) => {
      const msg = String((e as { error?: { message?: string; status?: number } }).error?.message ?? "");
      // A whole style that can't load means we're offline: fall back to coastlines.
      // Only the style or the tile index failing counts; a few missing tiles are normal.
      const k = kindRef.current;
      if (k === "offline") return;
      if (k === "satellite") {
        // Labels missing is fine; imagery failing over and over means no connection.
        if (/tiles\.maps\.eox\.at/i.test(msg) && ++failures >= 8) setTilesOk(false);
      } else if (/openfreemap\.org\/(styles\/[a-z]+|planet)(?=[\s"')]|$)/i.test(msg)) {
        setTilesOk(false);
      }
    });
    m.on("style.load", () => { addOverlays(m); setReady(true); });
    m.on("click", "traffic", (e) => {
      const f = e.features?.[0];
      if (f) handlers.current.onSelectTraffic?.(JSON.parse(String(f.properties?.raw ?? "null")));
    });
    m.on("click", (e) => {
      if (m.getLayer("traffic") && !m.queryRenderedFeatures(e.point, { layers: ["traffic"] }).length) handlers.current.onSelectTraffic?.(null);
    });
    m.on("click", "atc", (e) => { const f = e.features?.[0]; if (f) handlers.current.onSelectAtc?.(JSON.parse(String(f.properties?.raw ?? "null"))); });
    m.on("click", "metars", (e) => { const f = e.features?.[0]; if (f) handlers.current.onSelectMetar?.(JSON.parse(String(f.properties?.raw ?? "null"))); });
    for (const id of ["atc", "metars"]) { m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", id, () => (m.getCanvas().style.cursor = "")); }
    const view = () => { const b = m.getBounds(); handlers.current.onView?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], m.getZoom()); };
    m.on("moveend", view); m.once("idle", view);
    m.on("mouseenter", "traffic", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "traffic", () => (m.getCanvas().style.cursor = ""));
    // A pinch or scroll by the user wins over the automatic ground zoom.
    m.on("zoomstart", (e) => { if ((e as { originalEvent?: unknown }).originalEvent) zoomGoal.current = null; });
    m.on("dragstart", () => { cancelAnimationFrame(glideRaf.current); handlers.current.onUserMove?.(); });
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3D: terrain under the map and a tilted camera; 2D: flat and north-up.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (threeD && m.getSource("gp-dem")) {
      try { m.setTerrain({ source: "gp-dem", exaggeration: 1.25 }); } catch { /* terrain unsupported */ }
      try {
        m.setSky({ "sky-color": "#1d4fbf", "horizon-color": "#9cc8ff", "fog-color": "#cfe2ff", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.25, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0.6] } as never);
      } catch { /* sky unsupported */ }
      const c = m.getCenter();
      glide(m, { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: 60, bearing: m.getBearing(), top: 0 }, 900);
    } else {
      cancelAnimationFrame(glideRaf.current);
      try { m.setTerrain(null); } catch { /* ignore */ }
      m.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 700 });
    }
  }, [threeD, ready]);

  // Stands and gates near the aircraft
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const fc = { type: "FeatureCollection" as const, features: stands.map((s) => ({ type: "Feature" as const, properties: { ref: s.ref, kind: s.kind }, geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })) };
    data.current.stands = fc;
    (m.getSource("stands") as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, stands]);

  // Switch base map when the setting, theme or connectivity changes.
  useEffect(() => {
    const m = map.current;
    if (!m || kindRef.current === wanted) return;
    kindRef.current = wanted;
    setReady(false);
    m.setStyle(styleFor(wanted));
  }, [wanted]);

  // Route (plan) and trail
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const route = plan ? [[plan.origin.lon, plan.origin.lat], ...plan.fixes.map((f) => [f.lon, f.lat]), [plan.destination.lon, plan.destination.lat]] : [];
    data.current.route = route;
    data.current.trail = trail.map((p) => [p.lon, p.lat]);
    (m.getSource("route") as GeoJSONSource | undefined)?.setData(line(route));
    const fx = { type: "FeatureCollection" as const, features: (plan?.fixes ?? []).filter((f) => !/^T\/[CD]$|^TOC$|^TOD$/.test(f.ident)).map((f) => ({ type: "Feature" as const, properties: { ident: f.ident }, geometry: { type: "Point" as const, coordinates: [f.lon, f.lat] } })) };
    data.current.fixes = fx;
    (m.getSource("fixes") as GeoJSONSource | undefined)?.setData(fx);
    (m.getSource("trail") as GeoJSONSource | undefined)?.setData(line(data.current.trail));
    if (!fitted.current && (route.length > 1 || trail.length > 1) && !aircraft) {
      fitted.current = true;
      const pts = (route.length > 1 ? route : trail.map((p) => [p.lon, p.lat])) as Array<[number, number]>;
      const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: 60, duration: 0, maxZoom: 9 });
    }
  }, [ready, plan, trail, aircraft === null || aircraft === undefined]);

  // Traffic
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const fc = {
      type: "FeatureCollection" as const,
      features: traffic.map((p) => ({ type: "Feature" as const, properties: { hdg: p.hdg, net: p.network, raw: JSON.stringify(p) }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })),
    };
    data.current.traffic = fc;
    (m.getSource("traffic") as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, traffic]);

  // ATC
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const fc = { type: "FeatureCollection" as const, features: atc.map((c) => ({ type: "Feature" as const, properties: {
      callsign: c.callsign.replace(/_/g, " "), freq: c.frequency ?? "", col: NET_COLOR[c.network], raw: JSON.stringify(c),
      kind: /CTR|FSS|Centre|Flight service/i.test(`${c.callsign} ${c.facility}`) ? "ctr" : /APP|DEP|Approach/i.test(`${c.callsign} ${c.facility}`) ? "app" : "twr",
    }, geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] } })) };
    data.current.atc = fc;
    (m.getSource("atc") as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, atc]);

  // METAR dots
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const fc = { type: "FeatureCollection" as const, features: metars.map((w) => ({ type: "Feature" as const, properties: { icao: w.icao, cat: w.category, raw: JSON.stringify(w) }, geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] } })) };
    data.current.metars = fc;
    (m.getSource("metars") as GeoJSONSource | undefined)?.setData(fc);
  }, [ready, metars]);

  // Rain radar
  useEffect(() => {
    const m = map.current;
    data.current.radar = radarTiles;
    if (!m || !ready) return;
    if (m.getLayer("radar")) m.removeLayer("radar");
    if (m.getSource("radar")) m.removeSource("radar");
    if (radarTiles) addRadar(m, radarTiles);
  }, [ready, radarTiles]);

  // Airports (HTML markers)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    aptMarkers.current.forEach((mk) => mk.remove());
    aptMarkers.current = airports.map((a) => {
      const d = document.createElement("div");
      d.className = "apt-marker";
      d.innerHTML = `<span class="apt-dot ${a.role}"></span><span class="apt-label">${a.code}</span>`;
      return new maplibregl.Marker({ element: d, anchor: "left" }).setLngLat([a.lon, a.lat]).addTo(m);
    });
  }, [airports.map((a) => a.code + a.role).join()]);

  // Own aircraft
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!aircraft) {
      acMarker.current?.remove();
      acMarker.current = null;
      return;
    }
    if (!acMarker.current) {
      const d = document.createElement("div");
      d.className = "own-ac";
      d.innerHTML = `<span class="own-ac-pulse"></span><svg viewBox="0 0 48 48" width="46" height="46"><defs><linearGradient id="gp-fus" x1="0" x2="1"><stop offset="0" stop-color="#D9E3EF"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9D5E3"/></linearGradient></defs><path d="${AIRLINER_PATH}" fill="url(#gp-fus)" stroke="#0A6CFF" stroke-width="1.4" stroke-linejoin="round"/><path d="${ENGINES}" fill="#7C8DA6"/><path d="M22.4 5.6h3.2" stroke="#2B3A55" stroke-width="1.6" stroke-linecap="round"/></svg>`;
      acMarker.current = new maplibregl.Marker({ element: d, rotationAlignment: "map" }).setLngLat([aircraft.lon, aircraft.lat]).addTo(m);
    }
    acMarker.current.setLngLat([aircraft.lon, aircraft.lat]).setRotation(aircraft.hdg);
    if (follow && threeDRef.current) {
      // Chase camera: behind the aircraft, closer on the ground, wider in the cruise.
      const h = agl ?? 0;
      const zoom = onGround ? 16.2 : h < 1500 ? 14 : h < 5000 ? 12.2 : h < 15000 ? 10.4 : 8.6;
      glide(m, { center: [aircraft.lon, aircraft.lat], bearing: aircraft.hdg, pitch: onGround ? 58 : 64, zoom, top: 140 }, 950);
    } else if (follow) {
      // On the ground, zoom in once so taxiways and gates are readable.
      if (onGround && !groundZoomed.current && m.getZoom() < 15) zoomGoal.current = 15.2;
      // After take-off, step back out so the camera can keep up.
      if (!onGround && groundZoomed.current && m.getZoom() > 11.5) zoomGoal.current = 10.5;
      groundZoomed.current = onGround;
      if (zoomGoal.current !== null && Math.abs(m.getZoom() - zoomGoal.current) < 0.05) zoomGoal.current = null;
      const z = zoomGoal.current ?? Math.max(m.getZoom(), 5);
      // Ease-out glide: starts fast, so frequent position updates never leave the camera behind.
      glide(m, { center: [aircraft.lon, aircraft.lat], zoom: z, pitch: 0, bearing: m.getBearing(), top: 0 }, 450);
    }
  }, [aircraft?.lat, aircraft?.lon, aircraft?.hdg, follow, threeD]);

  return (
    <>
      <div ref={el} className="map" />
      <div className="map-vignette" aria-hidden="true" />
      {!tilesOk && <div className="map-note"><div className="notice info">The map couldn't load, so you're seeing coastlines only. Your flight, trail and traffic are still live. <button className="linklike" onClick={() => setTilesOk(true)}>Try again</button></div></div>}
    </>
  );
}

/**
 * Airport detail on every base map: aprons, taxiways (yellow, with their names),
 * runways (with numbers and centre lines), gates, and airport names.
 * From OpenStreetMap via OpenFreeMap. Plus a soft terrain shade.
 */
function addRadar(m: MLMap, tiles: string) {
  if (m.getSource("radar")) return;
  m.addSource("radar", { type: "raster", tiles: [tiles], tileSize: 256, maxzoom: 7, attribution: '<a href="https://www.rainviewer.com" target="_blank">RainViewer</a>' });
  const before = m.getLayer("route-casing") ? "route-casing" : undefined;
  m.addLayer({ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": 0.62, "raster-fade-duration": 200 } }, before);
}

function addAirportLayers(m: MLMap, kind: Kind) {
  if (kind === "offline") return;
  const light = LIGHT_KINDS.includes(kind);
  const std = kind === "std-light" || kind === "std-dark";
  const runwayColor = kind === "satellite" ? "#2a2f3a" : light ? "#5E626C" : "#6A6F7A";
  // The Standard map already has these tiles; reuse them (one download, one credit line).
  const omt = m.getSource("omt") ? "omt" : "gp-omt";
  if (omt === "gp-omt" && !m.getSource("gp-omt")) m.addSource("gp-omt", { type: "vector", url: `${OFM}/planet` });
  if (!m.getSource("gp-dem")) m.addSource("gp-dem", { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: DEM_ATTR });
  const before = m.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  const add = (l: Parameters<MLMap["addLayer"]>[0], under = true) => { if (!m.getLayer(l.id)) m.addLayer(l, under ? before : undefined); };
  if (!m.getSource("gp-dem-hs")) m.addSource("gp-dem-hs", { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium" });
  add({ id: "gp-hillshade", type: "hillshade", source: "gp-dem-hs", maxzoom: 14, paint: { "hillshade-exaggeration": kind === "satellite" ? 0.12 : std ? (light ? 0.14 : 0.22) : light ? 0.3 : 0.45, "hillshade-shadow-color": light ? "#5a6b85" : "#000814", "hillshade-highlight-color": light ? "#ffffff" : "#4a6aa8", "hillshade-accent-color": light ? "#7a8aa5" : "#0b1430" } });
  const src = { source: omt, "source-layer": "aeroway" } as const;
  add({ id: "gp-apron", type: "fill", ...src, minzoom: 11.5, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "class"], "apron"]], paint: { "fill-color": kind === "satellite" ? "rgba(30,36,48,.35)" : light ? "rgba(120,130,150,.18)" : "rgba(140,160,200,.10)" } });
  add({ id: "gp-area", type: "fill", ...src, minzoom: 11, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]]], paint: { "fill-color": ["match", ["get", "class"], "runway", runwayColor, light ? "rgba(90,98,115,.35)" : "rgba(52,58,72,.75)"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 1] } });
  add({ id: "gp-taxiway-casing", type: "line", ...src, minzoom: 12, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "taxiway"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": light ? "rgba(70,74,84,.28)" : "rgba(0,0,0,.45)", "line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 1.4, 14, 3, 15, 5, 17, 22, 19, 92] } });
  add({ id: "gp-taxiway", type: "line", ...src, minzoom: 12, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "taxiway"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": light ? "#D9A21B" : kind === "satellite" ? "#F5C542" : "#C9A03A", "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.55, 15, 0.95], "line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 0.6, 14, 1.4, 15, 2.6, 17, 16, 19, 80] } });
  add({ id: "gp-runway", type: "line", ...src, minzoom: 8, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"]], layout: { "line-cap": "butt" }, paint: { "line-color": runwayColor, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 8, 2, 11, 3.5, 13, 7, 14, 11, 15, 18, 17, 56, 19, 215] } });
  add({ id: "gp-runway-cl", type: "line", ...src, minzoom: 13, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"]], paint: { "line-color": "#ffffff", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 17, 2.5, 19, 7], "line-dasharray": [6, 5] } });
  add({ id: "gp-gate", type: "circle", ...src, minzoom: 15, filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "class"], "gate"]], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 1.8, 18, 4.5], "circle-color": light ? "#8E8E93" : "#AEAEB2", "circle-stroke-color": light ? "#FFFFFF" : "rgba(0,0,0,.6)", "circle-stroke-width": 1 } });
  // Labels on top of everything.
  add({ id: "gp-taxiway-label", type: "symbol", ...src, minzoom: 14.5, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "taxiway"], ["has", "ref"]], layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 11, 18, 17], "text-keep-upright": true }, paint: { "text-color": "#111111", "text-halo-color": "#F5C542", "text-halo-width": 3 } }, false);
  add({ id: "gp-runway-label", type: "symbol", ...src, minzoom: 12, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "class"], "runway"], ["has", "ref"]], layout: { "symbol-placement": "line-center", "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 18], "text-letter-spacing": 0.08, "text-keep-upright": true }, paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,.85)", "text-halo-width": 2 } }, false);
  add({ id: "gp-gate-label", type: "symbol", ...src, minzoom: 16, filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "class"], "gate"], ["has", "ref"]], layout: { "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.1] }, paint: { "text-color": "#DFFBE6", "text-halo-color": "rgba(0,30,10,.85)", "text-halo-width": 1.6 } }, false);
  add({ id: "gp-airport-name", type: "symbol", source: omt, "source-layer": "aerodrome_label", minzoom: 7, maxzoom: 14, layout: { "text-field": ["format", ["coalesce", ["get", "icao"], ["get", "iata"], ""], { "font-scale": 1.05 }, "\n", {}, ["coalesce", ["get", "name:en"], ["get", "name"]], { "font-scale": 0.8 }], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-max-width": 9, "text-allow-overlap": false }, paint: { "text-color": light ? "#1b2a4a" : "#EAF2FF", "text-halo-color": light ? "rgba(255,255,255,.9)" : "rgba(0,8,24,.85)", "text-halo-width": 1.6 } }, false);
}

function empty() {
  return { type: "FeatureCollection" as const, features: [] };
}
function line(coords: number[][]) {
  return { type: "FeatureCollection" as const, features: coords.length > 1 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } }] : [] };
}
/** One colour per network so you can tell them apart at a glance. */
export const NET_COLOR: Record<string, string> = { vatsim: "#30D158", ivao: "#64D2FF", sayintentions: "#FF9F0A" };

/** Top-down narrow-body airliner, nose up, in a 48x48 box. */
export const AIRLINER_PATH = "M24 2C26 2 26.8 4.6 26.8 8L26.8 18.2L45.5 27.6L45.5 30.4L26.8 25.8L26.6 37.4L34 42.1L34 44.2L25.3 42.3L24 46L22.7 42.3L14 44.2L14 42.1L21.4 37.4L21.2 25.8L2.5 30.4L2.5 27.6L21.2 18.2L21.2 8C21.2 4.6 22 2 24 2Z";
const ENGINES = "M31 20.6h3.4v6.6H31zM13.6 20.6H17v6.6h-3.4z";

function trafficIcon(fill: string): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32); g.scale(1.25, 1.25); g.translate(-24, -24);
  const body = new Path2D(AIRLINER_PATH), eng = new Path2D(ENGINES);
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.fillStyle = fill; g.fill(body);
  g.shadowColor = "transparent";
  g.lineWidth = 1.2; g.strokeStyle = "rgba(5,11,25,.85)"; g.stroke(body);
  g.fillStyle = "rgba(5,11,25,.55)"; g.fill(eng);
  // Fuselage highlight, for a bit of depth.
  const hl = g.createLinearGradient(21, 0, 27, 0);
  hl.addColorStop(0, "rgba(255,255,255,0)"); hl.addColorStop(0.5, "rgba(255,255,255,.45)"); hl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hl; g.fillRect(22.5, 5, 3, 33);
  return g.getImageData(0, 0, 64, 64);
}

