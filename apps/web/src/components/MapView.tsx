/**
 * Map: MapLibre GL (open source), no API keys.
 *  - Satellite: Sentinel-2 cloudless imagery by EOX (Copernicus data), with
 *    OpenFreeMap labels, borders and runways drawn over it.
 *  - Map: OpenFreeMap's Dark or Positron style, following the app theme.
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

const OFM = "https://tiles.openfreemap.org";
const OFM_ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
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

type Kind = "satellite" | "dark" | "light" | "fiord" | "liberty" | "bright" | "offline";
const LIGHT_KINDS: Kind[] = ["light", "liberty", "bright"];
function styleFor(k: Kind): StyleSpecification | string {
  if (k === "satellite") return satelliteStyle();
  if (k === "offline") return OFFLINE;
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
  follow?: boolean;
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

export function MapView({ trail, plan, aircraft, airports = [], traffic = [], follow, threeD = false, stands = [], agl = null, onGround = false, onSelectTraffic, onUserMove, interactive = true }: MapViewProps) {
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
  const data = useRef<{ route: number[][]; trail: number[][]; traffic: unknown; stands: unknown }>({ route: [], trail: [], traffic: empty(), stands: empty() });
  const threeDRef = useRef(threeD);
  threeDRef.current = threeD;
  const glideRaf = useRef(0);
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
  const handlers = useRef({ onSelectTraffic, onUserMove });
  handlers.current = { onSelectTraffic, onUserMove };

  // Follow the app's light/dark theme.
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(themeNow()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const wanted: Kind = !tilesOk ? "offline" : mapStyle === "map" ? theme : (mapStyle as Kind);

  const addOverlays = (m: MLMap) => {
    for (const [net, col] of Object.entries(NET_COLOR)) if (!m.hasImage(`traffic-${net}`)) m.addImage(`traffic-${net}`, trafficIcon(col), { pixelRatio: 2 });
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
    m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round" }, paint: { "line-color": "#E05CFF", "line-width": 2, "line-dasharray": [2.2, 1.6], "line-opacity": 0.95 } });
    m.addLayer({ id: "trail-glow", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#5AC8FA", "line-width": 12, "line-opacity": light ? 0.25 : 0.35, "line-blur": 6 } });
    m.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": 3.4, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#64D2FF", 0.6, "#0A84FF", 1, "#BF5AF2"] } });
    m.addLayer({ id: "traffic", type: "symbol", source: "traffic", layout: { "icon-image": ["concat", "traffic-", ["get", "net"]], "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.55, 9, 1] }, paint: { "icon-opacity": 0.95 } });
  };

  useEffect(() => {
    if (!el.current) return;
    kindRef.current = wanted;
    const m = new maplibregl.Map({
      container: el.current, style: styleFor(wanted), center: aircraft ? [aircraft.lon, aircraft.lat] : [0, 30], zoom: aircraft ? 7 : 1.6,
      attributionControl: { compact: true }, interactive, dragRotate: false, pitchWithRotate: false, fadeDuration: 150,
    });
    map.current = m;
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
    m.on("mouseenter", "traffic", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "traffic", () => (m.getCanvas().style.cursor = ""));
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
      d.innerHTML = `<span class="own-ac-pulse"></span><svg viewBox="0 0 48 48" width="44" height="44"><path d="M24 2.5c1.7 0 2.8 1.7 2.8 4v11.2l15.7 9.1v4.4l-15.7-4.7v9.4l4.7 3.6v3L24 41.6 16.5 43.5v-3l4.7-3.6v-9.4L5.5 32.2v-4.4l15.7-9.1V6.5c0-2.3 1.1-4 2.8-4z" fill="#FFFFFF" stroke="#0A84FF" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
      acMarker.current = new maplibregl.Marker({ element: d, rotationAlignment: "map" }).setLngLat([aircraft.lon, aircraft.lat]).addTo(m);
    }
    acMarker.current.setLngLat([aircraft.lon, aircraft.lat]).setRotation(aircraft.hdg);
    if (follow && threeDRef.current) {
      // Chase camera: behind the aircraft, closer on the ground, wider in the cruise.
      const h = agl ?? 0;
      const zoom = onGround ? 16.2 : h < 1500 ? 14 : h < 5000 ? 12.2 : h < 15000 ? 10.4 : 8.6;
      glide(m, { center: [aircraft.lon, aircraft.lat], bearing: aircraft.hdg, pitch: onGround ? 58 : 64, zoom, top: 140 }, 950);
    } else if (follow) {
      m.easeTo({ center: [aircraft.lon, aircraft.lat], duration: 600, zoom: Math.max(m.getZoom(), 5) });
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
function addAirportLayers(m: MLMap, kind: Kind) {
  if (kind === "offline") return;
  const light = LIGHT_KINDS.includes(kind);
  if (!m.getSource("gp-omt")) m.addSource("gp-omt", { type: "vector", url: `${OFM}/planet` });
  if (!m.getSource("gp-dem")) m.addSource("gp-dem", { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium", attribution: DEM_ATTR });
  const before = m.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  const add = (l: Parameters<MLMap["addLayer"]>[0], under = true) => { if (!m.getLayer(l.id)) m.addLayer(l, under ? before : undefined); };
  if (!m.getSource("gp-dem-hs")) m.addSource("gp-dem-hs", { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium" });
  add({ id: "gp-hillshade", type: "hillshade", source: "gp-dem-hs", maxzoom: 14, paint: { "hillshade-exaggeration": kind === "satellite" ? 0.12 : light ? 0.3 : 0.45, "hillshade-shadow-color": light ? "#5a6b85" : "#000814", "hillshade-highlight-color": light ? "#ffffff" : "#4a6aa8", "hillshade-accent-color": light ? "#7a8aa5" : "#0b1430" } });
  const src = { source: "gp-omt", "source-layer": "aeroway" } as const;
  add({ id: "gp-apron", type: "fill", ...src, minzoom: 11.5, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "class"], "apron"]], paint: { "fill-color": kind === "satellite" ? "rgba(30,36,48,.35)" : light ? "rgba(120,130,150,.18)" : "rgba(140,160,200,.10)" } });
  add({ id: "gp-taxiway-casing", type: "line", ...src, minzoom: 12, filter: ["==", ["get", "class"], "taxiway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": light ? "rgba(60,60,60,.35)" : "rgba(0,0,0,.55)", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 1.6, 15, 6, 17, 16, 19, 40] } });
  add({ id: "gp-taxiway", type: "line", ...src, minzoom: 12, filter: ["==", ["get", "class"], "taxiway"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": light ? "#E0A800" : "#F5C542", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.8, 15, 3.5, 17, 11, 19, 30] } });
  add({ id: "gp-runway", type: "line", ...src, minzoom: 8, filter: ["==", ["get", "class"], "runway"], layout: { "line-cap": "butt" }, paint: { "line-color": light ? "#4a5263" : "#2a2f3a", "line-width": ["interpolate", ["exponential", 1.7], ["zoom"], 8, 1.5, 12, 6, 15, 38, 17, 140, 19, 520] } });
  add({ id: "gp-runway-cl", type: "line", ...src, minzoom: 13.5, filter: ["==", ["get", "class"], "runway"], paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 13.5, 0.8, 17, 3, 19, 8], "line-dasharray": [6, 5] } });
  add({ id: "gp-gate", type: "circle", ...src, minzoom: 15, filter: ["==", ["get", "class"], "gate"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 3, 18, 7], "circle-color": "#30D158", "circle-stroke-color": "rgba(0,0,0,.6)", "circle-stroke-width": 1 } });
  // Labels on top of everything.
  add({ id: "gp-taxiway-label", type: "symbol", ...src, minzoom: 14.5, filter: ["all", ["==", ["get", "class"], "taxiway"], ["has", "ref"]], layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 10, 18, 15], "text-keep-upright": true }, paint: { "text-color": "#111111", "text-halo-color": "#F5C542", "text-halo-width": 3 } }, false);
  add({ id: "gp-runway-label", type: "symbol", ...src, minzoom: 12, filter: ["all", ["==", ["get", "class"], "runway"], ["has", "ref"]], layout: { "symbol-placement": "line-center", "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 18], "text-letter-spacing": 0.08, "text-keep-upright": true }, paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,.85)", "text-halo-width": 2 } }, false);
  add({ id: "gp-gate-label", type: "symbol", ...src, minzoom: 16, filter: ["all", ["==", ["get", "class"], "gate"], ["has", "ref"]], layout: { "text-field": ["get", "ref"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.1] }, paint: { "text-color": "#DFFBE6", "text-halo-color": "rgba(0,30,10,.85)", "text-halo-width": 1.6 } }, false);
  add({ id: "gp-airport-name", type: "symbol", source: "gp-omt", "source-layer": "aerodrome_label", minzoom: 7, maxzoom: 14, layout: { "text-field": ["format", ["coalesce", ["get", "icao"], ["get", "iata"], ""], { "font-scale": 1.05 }, "\n", {}, ["coalesce", ["get", "name:en"], ["get", "name"]], { "font-scale": 0.8 }], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-max-width": 9, "text-allow-overlap": false }, paint: { "text-color": light ? "#1b2a4a" : "#EAF2FF", "text-halo-color": light ? "rgba(255,255,255,.9)" : "rgba(0,8,24,.85)", "text-halo-width": 1.6 } }, false);
}

function empty() {
  return { type: "FeatureCollection" as const, features: [] };
}
function line(coords: number[][]) {
  return { type: "FeatureCollection" as const, features: coords.length > 1 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } }] : [] };
}
/** One colour per network so you can tell them apart at a glance. */
export const NET_COLOR: Record<string, string> = { vatsim: "#30D158", ivao: "#64D2FF", sayintentions: "#FF9F0A" };

function trafficIcon(fill: string): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  g.translate(24, 24);
  g.fillStyle = fill;
  g.strokeStyle = "rgba(5,11,25,0.9)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -18); g.lineTo(3, -6); g.lineTo(16, 2); g.lineTo(16, 6); g.lineTo(3, 3); g.lineTo(3, 12); g.lineTo(7, 16); g.lineTo(7, 18);
  g.lineTo(0, 16); g.lineTo(-7, 18); g.lineTo(-7, 16); g.lineTo(-3, 12); g.lineTo(-3, 3); g.lineTo(-16, 6); g.lineTo(-16, 2); g.lineTo(-3, -6); g.closePath();
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, 48, 48);
}
