/**
 * Glidepath's own street map, drawn from OpenFreeMap vector tiles
 * (OpenMapTiles schema). Soft, quiet colours in the spirit of Apple Maps:
 * warm land, clear blue water, white streets, gentle greens, and labels
 * that stay readable without shouting. One palette for light, one for dark.
 */
import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";

export const OFM = "https://tiles.openfreemap.org";
export const OFM_ATTR = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

interface Palette {
  land: string; water: string; waterLine: string; waterText: string;
  park: string; wood: string; grass: string; farmland: string; sand: string; ice: string;
  residential: string; industrial: string; commercial: string; hospital: string; school: string; airportArea: string;
  building: string; buildingEdge: string;
  motorway: string; motorwayCase: string; trunk: string; trunkCase: string; road: string; roadCase: string; minor: string; minorCase: string; path: string; rail: string;
  border: string; stateBorder: string;
  text: string; textSoft: string; halo: string; roadText: string; cityText: string;
}

const LIGHT: Palette = {
  land: "#F4F2EC", water: "#A9D3F5", waterLine: "#8FC2EE", waterText: "#3D7FB8",
  park: "#CFE8C0", wood: "#C3E2B3", grass: "#D7EDCB", farmland: "#EFEEE3", sand: "#F2EBD3", ice: "#FFFFFF",
  residential: "#EFECE5", industrial: "#ECE8EF", commercial: "#F3EAE4", hospital: "#F6E3E3", school: "#F3EDDA", airportArea: "#E9E6EE",
  building: "#E5E1D9", buildingEdge: "#D8D2C6",
  motorway: "#FBD583", motorwayCase: "#E2B25A", trunk: "#FDE3A7", trunkCase: "#E3C27F", road: "#FFFFFF", roadCase: "#D6D0C4", minor: "#FFFFFF", minorCase: "#E0DBD0", path: "#D2CCC0", rail: "#C9C3B8",
  border: "#A79FB5", stateBorder: "#C9C2D3",
  text: "#3A3A3C", textSoft: "#6E6E73", halo: "rgba(255,255,255,0.92)", roadText: "#5B5B60", cityText: "#1C1C1E",
};

const DARK: Palette = {
  land: "#1F2227", water: "#1B3D63", waterLine: "#2A5785", waterText: "#8DB6E0",
  park: "#1F3A2A", wood: "#1D3527", grass: "#223A2C", farmland: "#23272B", sand: "#2E2C26", ice: "#2F343B",
  residential: "#24272D", industrial: "#28272F", commercial: "#2C272B", hospital: "#30262A", school: "#2C2A25", airportArea: "#292A36",
  building: "#30343C", buildingEdge: "#3B4049",
  motorway: "#9C7A3F", motorwayCase: "#5F4A27", trunk: "#6B5E48", trunkCase: "#433C31", road: "#4A505A", roadCase: "#2B2F36", minor: "#3D424B", minorCase: "#2A2E34", path: "#41464E", rail: "#555A63",
  border: "#6E6680", stateBorder: "#4A4558",
  text: "#D5D8DE", textSoft: "#9A9FA8", halo: "rgba(18,20,24,0.9)", roadText: "#AEB3BB", cityText: "#F2F3F5",
};

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];
const zoomW = (stops: Array<[number, number]>): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.6], ["zoom"], ...stops.flat()] as unknown as ExpressionSpecification;
const cls = (...c: string[]): ExpressionSpecification => ["in", ["get", "class"], ["literal", c]];
const notTunnel: ExpressionSpecification = ["!=", ["get", "brunnel"], "tunnel"];

export function streetStyle(mode: "light" | "dark"): StyleSpecification {
  const p = mode === "light" ? LIGHT : DARK;
  const src = { source: "omt" } as const;
  return {
    version: 8,
    name: `glidepath-${mode}`,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sources: { omt: { type: "vector", url: `${OFM}/planet`, attribution: OFM_ATTR } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": p.land } },
      // Ground cover
      { id: "landcover-farm", type: "fill", ...src, "source-layer": "landcover", filter: cls("farmland"), paint: { "fill-color": p.farmland, "fill-opacity": 0.7 } },
      { id: "landcover-wood", type: "fill", ...src, "source-layer": "landcover", filter: cls("wood"), paint: { "fill-color": p.wood, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.9] } },
      { id: "landcover-grass", type: "fill", ...src, "source-layer": "landcover", filter: cls("grass", "wetland"), paint: { "fill-color": p.grass, "fill-opacity": 0.8 } },
      { id: "landcover-sand", type: "fill", ...src, "source-layer": "landcover", filter: cls("sand"), paint: { "fill-color": p.sand } },
      { id: "landcover-ice", type: "fill", ...src, "source-layer": "landcover", filter: cls("ice", "glacier"), paint: { "fill-color": p.ice } },
      { id: "landuse-res", type: "fill", ...src, "source-layer": "landuse", minzoom: 9, filter: cls("residential", "suburb", "neighbourhood"), paint: { "fill-color": p.residential } },
      { id: "landuse-ind", type: "fill", ...src, "source-layer": "landuse", minzoom: 10, filter: cls("industrial", "railway", "garages"), paint: { "fill-color": p.industrial } },
      { id: "landuse-com", type: "fill", ...src, "source-layer": "landuse", minzoom: 10, filter: cls("commercial", "retail"), paint: { "fill-color": p.commercial } },
      { id: "landuse-hosp", type: "fill", ...src, "source-layer": "landuse", minzoom: 12, filter: cls("hospital"), paint: { "fill-color": p.hospital } },
      { id: "landuse-school", type: "fill", ...src, "source-layer": "landuse", minzoom: 12, filter: cls("school", "university", "college", "kindergarten"), paint: { "fill-color": p.school } },
      { id: "landuse-green", type: "fill", ...src, "source-layer": "landuse", minzoom: 10, filter: cls("cemetery", "stadium", "pitch", "playground"), paint: { "fill-color": p.grass } },
      { id: "park", type: "fill", ...src, "source-layer": "park", paint: { "fill-color": p.park, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 9, 1] } },
      { id: "airport-area", type: "fill", ...src, "source-layer": "aeroway", minzoom: 9, filter: ["all", ["==", ["geometry-type"], "Polygon"], cls("aerodrome")], paint: { "fill-color": p.airportArea } },
      // Water
      { id: "water", type: "fill", ...src, "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": p.water } },
      { id: "waterway", type: "line", ...src, "source-layer": "waterway", minzoom: 8, filter: notTunnel, layout: { "line-cap": "round" }, paint: { "line-color": p.waterLine, "line-width": zoomW([[8, 0.6], [12, 1.4], [16, 4]]) } },
      // Buildings
      { id: "building", type: "fill", ...src, "source-layer": "building", minzoom: 14, maxzoom: 15.5, paint: { "fill-color": p.building, "fill-outline-color": p.buildingEdge, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1] } },
      // Real building heights from OpenStreetMap, raised when you zoom in (and in the 3D view).
      { id: "building-3d", type: "fill-extrusion", ...src, "source-layer": "building", minzoom: 15, paint: {
        "fill-extrusion-color": p.building,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.8, 0.9],
        "fill-extrusion-vertical-gradient": true,
      } },
      // Roads: casings first, then fills
      { id: "road-minor-case", type: "line", ...src, "source-layer": "transportation", minzoom: 13, filter: ["all", notTunnel, cls("minor", "service")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.minorCase, "line-width": zoomW([[13, 1.5], [16, 8], [18, 20]]) } },
      { id: "road-case", type: "line", ...src, "source-layer": "transportation", minzoom: 9, filter: ["all", notTunnel, cls("primary", "secondary", "tertiary")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadCase, "line-width": zoomW([[9, 1], [12, 3], [16, 14], [18, 30]]) } },
      { id: "road-trunk-case", type: "line", ...src, "source-layer": "transportation", minzoom: 6, filter: ["all", notTunnel, cls("trunk")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.trunkCase, "line-width": zoomW([[6, 1], [10, 3], [14, 9], [18, 34]]) } },
      { id: "road-motorway-case", type: "line", ...src, "source-layer": "transportation", minzoom: 5, filter: ["all", notTunnel, cls("motorway")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.motorwayCase, "line-width": zoomW([[5, 1], [10, 3.5], [14, 10], [18, 38]]) } },
      { id: "path", type: "line", ...src, "source-layer": "transportation", minzoom: 15, filter: cls("path", "track"), paint: { "line-color": p.path, "line-width": 1, "line-dasharray": [2, 1.5] } },
      { id: "rail", type: "line", ...src, "source-layer": "transportation", minzoom: 11, filter: ["all", notTunnel, cls("rail", "transit")], paint: { "line-color": p.rail, "line-width": zoomW([[11, 0.6], [16, 2]]) } },
      { id: "road-minor", type: "line", ...src, "source-layer": "transportation", minzoom: 13, filter: ["all", notTunnel, cls("minor", "service")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.minor, "line-width": zoomW([[13, 0.8], [16, 6], [18, 17]]) } },
      { id: "road", type: "line", ...src, "source-layer": "transportation", minzoom: 9, filter: ["all", notTunnel, cls("primary", "secondary", "tertiary")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.road, "line-width": zoomW([[9, 0.5], [12, 2], [16, 11], [18, 26]]) } },
      { id: "road-trunk", type: "line", ...src, "source-layer": "transportation", minzoom: 6, filter: ["all", notTunnel, cls("trunk")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.trunk, "line-width": zoomW([[6, 0.6], [10, 2], [14, 7], [18, 30]]) } },
      { id: "road-motorway", type: "line", ...src, "source-layer": "transportation", minzoom: 5, filter: ["all", notTunnel, cls("motorway")], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.motorway, "line-width": zoomW([[5, 0.6], [10, 2.4], [14, 8], [18, 34]]) } },
      // Borders
      { id: "border-state", type: "line", ...src, "source-layer": "boundary", minzoom: 4, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": p.stateBorder, "line-width": 0.8, "line-dasharray": [3, 2] } },
      { id: "border-country", type: "line", ...src, "source-layer": "boundary", filter: ["all", ["<=", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]], paint: { "line-color": p.border, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 1.6] } },
      // Labels
      { id: "water-name", type: "symbol", ...src, "source-layer": "water_name", layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 10, 14], "text-letter-spacing": 0.08, "text-max-width": 8 }, paint: { "text-color": p.waterText, "text-halo-color": p.halo, "text-halo-width": 1 } },
      { id: "road-name", type: "symbol", ...src, "source-layer": "transportation_name", minzoom: 13, filter: cls("primary", "secondary", "tertiary", "minor", "trunk"), layout: { "symbol-placement": "line", "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13], "text-max-angle": 30 }, paint: { "text-color": p.roadText, "text-halo-color": p.halo, "text-halo-width": 1.4 } },
      { id: "place-small", type: "symbol", ...src, "source-layer": "place", minzoom: 11, filter: cls("suburb", "neighbourhood", "quarter", "village", "hamlet"), layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 14], "text-max-width": 8 }, paint: { "text-color": p.textSoft, "text-halo-color": p.halo, "text-halo-width": 1.4 } },
      { id: "place-town", type: "symbol", ...src, "source-layer": "place", minzoom: 7, filter: cls("town"), layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 15], "text-max-width": 8 }, paint: { "text-color": p.text, "text-halo-color": p.halo, "text-halo-width": 1.5 } },
      { id: "place-city", type: "symbol", ...src, "source-layer": "place", minzoom: 3, filter: cls("city"), layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 8, 14, 12, 19], "text-max-width": 8 }, paint: { "text-color": p.cityText, "text-halo-color": p.halo, "text-halo-width": 1.6 } },
      { id: "place-state", type: "symbol", ...src, "source-layer": "place", minzoom: 4, maxzoom: 7, filter: cls("state"), layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 }, paint: { "text-color": p.textSoft, "text-halo-color": p.halo, "text-halo-width": 1.2 } },
      { id: "place-country", type: "symbol", ...src, "source-layer": "place", maxzoom: 7, filter: cls("country"), layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 15], "text-max-width": 7 }, paint: { "text-color": p.text, "text-halo-color": p.halo, "text-halo-width": 1.6 } },
    ],
  };
}
