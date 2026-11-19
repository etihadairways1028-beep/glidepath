/** METAR and TAF from aviationweather.gov, in the shape the Bridge and the app share. */
export interface Metar { icao: string; raw: string; observed: string | null; windDir: number | "VRB" | null; windKt: number | null; gustKt: number | null; visibility: string | null; tempC: number | null; dewC: number | null; qnhHpa: number | null; category: string | null; clouds: Array<{ cover: string; baseFt: number | null }> }
export interface Taf { icao: string; raw: string; issued: string | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseMetars(j: any): Metar[] {
  return (Array.isArray(j) ? j : []).map((m: any) => ({
    icao: String(m.icaoId), raw: String(m.rawOb ?? ""), observed: m.reportTime ?? null,
    windDir: m.wdir === "VRB" ? "VRB" : Number.isFinite(m.wdir) ? m.wdir : null, windKt: Number.isFinite(m.wspd) ? m.wspd : null,
    gustKt: Number.isFinite(m.wgst) ? m.wgst : null, visibility: m.visib === undefined || m.visib === null ? null : String(m.visib),
    tempC: Number.isFinite(m.temp) ? m.temp : null, dewC: Number.isFinite(m.dewp) ? m.dewp : null,
    qnhHpa: Number.isFinite(m.altim) ? Math.round(m.altim) : null, category: m.fltCat ?? null,
    clouds: Array.isArray(m.clouds) ? m.clouds.map((c: any) => ({ cover: String(c.cover), baseFt: Number.isFinite(c.base) ? c.base : null })) : [],
  }));
}

export function parseTafs(j: any): Taf[] {
  return (Array.isArray(j) ? j : []).map((t: any) => ({ icao: String(t.icaoId), raw: String(t.rawTAF ?? ""), issued: t.issueTime ?? null }));
}

