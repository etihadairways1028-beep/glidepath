/**
 * Map: MapLibre GL (open source) with a custom night style.
 *  - Base: Natural Earth land + borders (public domain), bundled, so the map
 *    works even when vector tiles can't load.
 *  - Detail: OpenFreeMap vector tiles (OpenStreetMap data, no key, attribution shown).
 *  - Own aircraft and airport labels are HTML markers: they never depend on remote fonts.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FlightPlan } from "@glidepath/protocol";
import type { TrailPoint } from "../data/store";
import type { NetworkPilot } from "../data/external";

const STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    land: { type: "geojson", data: "data/land.geojson" },
    borders: { type: "geojson", data: "data/borders.geojson" },
    omt: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · Natural Earth' },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#050b19" } },
    { id: "land", type: "fill", source: "land", paint: { "fill-color": "#0c1631" } },
    { id: "land-edge", type: "line", source: "land", paint: { "line-color": "#1b2a52", "line-width": 0.8 } },
    { id: "omt-water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#060d1f" } },
    { id: "omt-landuse-urban", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["residential", "commercial", "industrial"]]], paint: { "fill-color": "#101d3d", "fill-opacity": 0.6 } },
    { id: "omt-aerodrome", type: "fill", source: "omt", "source-layer": "aeroway", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#13224a", "fill-opacity": 0.8 } },
    { id: "omt-roads", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]], minzoom: 6, paint: { "line-color": "#16264d", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 2] } },
    { id: "omt-runway", type: "line", source: "omt", "source-layer": "aeroway", filter: ["in", ["get", "class"], ["literal", ["runway"]]], paint: { "line-color": "#3b5291", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 9, 1, 14, 22] } },
    { id: "omt-taxiway", type: "line", source: "omt", "source-layer": "aeroway", filter: ["in", ["get", "class"], ["literal", ["taxiway"]]], minzoom: 12, paint: { "line-color": "#2a3d70", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 6] } },
    { id: "borders", type: "line", source: "borders", paint: { "line-color": "#2a3a66", "line-width": 0.8, "line-dasharray": [3, 2] } },
    { id: "omt-boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["<=", ["get", "admin_level"], 2], paint: { "line-color": "#2c3d6c", "line-width": 0.8 } },
    { id: "omt-place", type: "symbol", source: "omt", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["city", "town"]]], minzoom: 4,
      layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 13] },
      paint: { "text-color": "#6c7a9c", "text-halo-color": "#050b19", "text-halo-width": 1.2 } },
  ],
};

export interface MapViewProps {
  trail: TrailPoint[];
  plan?: FlightPlan | null;
  aircraft?: { lat: number; lon: number; hdg: number } | null;
  airports?: Array<{ code: string; lat: number; lon: number; role: "dep" | "arr" }>;
  traffic?: NetworkPilot[];
  follow?: boolean;
  onSelectTraffic?: (p: NetworkPilot | null) => void;
  onUserMove?: () => void;
  interactive?: boolean;
}

export function MapView({ trail, plan, aircraft, airports = [], traffic = [], follow, onSelectTraffic, onUserMove, interactive = true }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const acMarker = useRef<maplibregl.Marker | null>(null);
  const aptMarkers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  const [tilesOk, setTilesOk] = useState(true);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE, center: aircraft ? [aircraft.lon, aircraft.lat] : [0, 30], zoom: aircraft ? 7 : 1.6,
      attributionControl: { compact: true }, interactive, dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
    });
    map.current = m;
    m.on("error", (e) => {
      const msg = String((e as { error?: { message?: string } }).error?.message ?? "");
      if (/openfreemap|Failed to fetch|NetworkError|AJAXError/i.test(msg)) setTilesOk(false);
    });
    m.on("load", () => {
      m.addImage("traffic", trafficIcon(), { pixelRatio: 2 });
      m.addSource("route", { type: "geojson", data: empty() });
      m.addSource("trail", { type: "geojson", data: empty() });
      m.addSource("traffic", { type: "geojson", data: empty() });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#E05CFF", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
      m.addLayer({ id: "trail-glow", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#6FB6FF", "line-width": 9, "line-opacity": 0.18, "line-blur": 4 } });
      m.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#8CC6FF", "line-width": 2.6 } });
      m.addLayer({ id: "traffic", type: "symbol", source: "traffic", layout: { "icon-image": "traffic", "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.55, 9, 1] },
        paint: { "icon-opacity": 0.9 } });
      m.on("click", "traffic", (e) => {
        const f = e.features?.[0];
        if (f) onSelectTraffic?.(JSON.parse(String(f.properties?.raw ?? "null")));
      });
      m.on("click", (e) => {
        if (!m.queryRenderedFeatures(e.point, { layers: ["traffic"] }).length) onSelectTraffic?.(null);
      });
      m.on("mouseenter", "traffic", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "traffic", () => (m.getCanvas().style.cursor = ""));
      setReady(true);
    });
    m.on("dragstart", () => onUserMove?.());
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route (plan) and trail
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const route = plan ? [[plan.origin.lon, plan.origin.lat], ...plan.fixes.map((f) => [f.lon, f.lat]), [plan.destination.lon, plan.destination.lat]] : [];
    (m.getSource("route") as GeoJSONSource).setData(line(route));
    (m.getSource("trail") as GeoJSONSource).setData(line(trail.map((p) => [p.lon, p.lat])));
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
    (m.getSource("traffic") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: traffic.map((p) => ({ type: "Feature", properties: { hdg: p.hdg, raw: JSON.stringify(p) }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
    });
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
      d.innerHTML = `<svg viewBox="0 0 48 48" width="40" height="40"><path d="M24 3c1.6 0 2.6 1.6 2.6 3.8v11.4l15.4 9v4.3l-15.4-4.6v9.6l4.6 3.6V43L24 41.2 16.8 43v-2.9l4.6-3.6v-9.6L6 31.5v-4.3l15.4-9V6.8C21.4 4.6 22.4 3 24 3z" fill="#EEF3FC" stroke="#6FB6FF" stroke-width="1.6"/></svg>`;
      acMarker.current = new maplibregl.Marker({ element: d, rotationAlignment: "map" }).setLngLat([aircraft.lon, aircraft.lat]).addTo(m);
    }
    acMarker.current.setLngLat([aircraft.lon, aircraft.lat]).setRotation(aircraft.hdg);
    if (follow) m.easeTo({ center: [aircraft.lon, aircraft.lat], duration: 600, zoom: Math.max(m.getZoom(), 5) });
  }, [aircraft?.lat, aircraft?.lon, aircraft?.hdg, follow]);

  return (
    <>
      <div ref={el} className="map" />
      {!tilesOk && <div className="map-note"><div className="notice info">Detailed map tiles couldn't load, so you're seeing coastlines only. Your flight, trail and traffic are still live.</div></div>}
    </>
  );
}

function empty() {
  return { type: "FeatureCollection" as const, features: [] };
}
function line(coords: number[][]) {
  return { type: "FeatureCollection" as const, features: coords.length > 1 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: coords } }] : [] };
}
function trafficIcon(): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d")!;
  g.translate(24, 24);
  g.fillStyle = "#F5B54A";
  g.strokeStyle = "rgba(5,11,25,0.9)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -18); g.lineTo(3, -6); g.lineTo(16, 2); g.lineTo(16, 6); g.lineTo(3, 3); g.lineTo(3, 12); g.lineTo(7, 16); g.lineTo(7, 18);
  g.lineTo(0, 16); g.lineTo(-7, 18); g.lineTo(-7, 16); g.lineTo(-3, 12); g.lineTo(-3, 3); g.lineTo(-16, 6); g.lineTo(-16, 2); g.lineTo(-3, -6); g.closePath();
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, 48, 48);
}
