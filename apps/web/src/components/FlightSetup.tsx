/**
 * Flight setup, the way chart apps do it: a route bar across the top, an Origin and a
 * Destination card, and a sheet for each choice (runway, departure, arrival, approach).
 * Procedure lists come from the simulator through the Bridge. Runways, lengths and the
 * final approach course lines come from OurAirports, and wind from the live METAR.
 * What you pick is Glidepath's plan; it doesn't reprogram the aircraft.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { destinationPoint, runwayWind } from "@glidepath/flight-engine";
import type { FlightPlan } from "@glidepath/protocol";
import { airportDetail, type AirportDetail } from "../data/airports";
import { getMetar, usePoll, type Metar } from "../data/external";
import { getLiveNetwork } from "../data/networks";
import { useSettings } from "../data/store";
import { useApp } from "../data/store";
import { activeBridge } from "../data/bridge";
import { loadChoice, navCached, navKeep, saveChoice, useChoice, useProcs, type ProcChoice } from "./Procedures";

type End = AirportDetail["runways"][number]["ends"][number];
type Proc = { name: string; runways: string[]; transitions: string[] };
type Appr = { name: string; type: string; runway: string; transitions: string[] };
type PathFix = { ident: string; lat: number; lon: number; altFt: number | null };
export type PubHold = { ident: string; lat: number; lon: number; courseDeg: number; trueCourse: boolean; right: boolean; legNm: number | null; legMin: number | null; altFt: number | null; alt2Ft: number | null; speedKt: number | null; from: "approach" | "missed" };
type APath = { name: string; runway: string; final: PathFix[]; transitions: Array<{ name: string; legs: PathFix[] }>; missed?: PathFix[]; holds?: PubHold[] };
type View = "main" | "dep-rwy" | "sid" | "arr-rwy" | "star" | "app";

/** A line drawn on the map for a runway: its final approach course, or its departure direction. */
export interface RunwayLine {
  id: string; kind: "app" | "dep"; state: "preview" | "hot" | "set"; label: string; coords: Array<[number, number]>;
  /** Draw the label as a box at the line's start (approach paths), not along it. */
  box?: boolean;
  /** Fixes to mark along the line, with their altitude restriction. */
  fixes?: Array<{ ident: string; lat: number; lon: number; alt: string }>;
}

const FINAL_NM = 10;
const ft2nm = (ft: number) => ft / 6076.12;

export function finalLine(e: End): Array<[number, number]> {
  const out = destinationPoint(e.threshold, (e.headingTrueDeg + 180) % 360, FINAL_NM);
  return [[out.lon, out.lat], [e.threshold.lon, e.threshold.lat]];
}
export function departLine(e: End): Array<[number, number]> {
  const end = destinationPoint(e.threshold, e.headingTrueDeg, ft2nm(e.lengthFt || 8000) + 4);
  return [[e.threshold.lon, e.threshold.lat], [end.lon, end.lat]];
}

/** Each approach's fixes, from the sim through the Bridge (null when not available). */
export function usePaths(icao: string, enabled: boolean, retry = 0): APath[] | null {
  const [v, setV] = useState<APath[] | null>(null);
  useEffect(() => {
    setV(navCached<APath[]>(icao, ".paths"));
    const b = activeBridge();
    if (!enabled || !b || !/^[A-Z0-9]{3,4}$/.test(icao)) return;
    let off = false;
    b.get<APath[]>(`/api/procedures/${icao}/paths`).then((r) => { if (!off && Array.isArray(r) && r.length) { setV(r); navKeep(icao, r, ".paths"); } }).catch(() => undefined);
    return () => { off = true; };
  }, [icao, enabled, retry]);
  return v;
}
/** Published holds at your origin and destination (from the sim's navdata), and those on your chosen approach. */
export function usePublishedHolds(plan: FlightPlan | null, live: boolean): { all: PubHold[]; onApproach: PubHold[] } {
  const dep = plan?.origin.icao.toUpperCase() ?? "", arr = plan?.destination.icao.toUpperCase() ?? "";
  const pa = usePaths(arr, live && !!arr), pd = usePaths(dep, live && !!dep);
  const ch = useChoice(dep || null, arr || null);
  return useMemo(() => {
    const all: PubHold[] = [];
    for (const p of [...(pa ?? []), ...(pd ?? [])]) for (const h of p.holds ?? []) if (!all.some((x) => x.ident === h.ident && Math.abs(x.lat - h.lat) < 1e-4)) all.push(h);
    const chosen = ch.approach ? (pa ?? []).find((p) => p.name === ch.approach) : null;
    const onApproach = chosen ? (chosen.holds ?? []).filter((h) => h.from === "missed" || !ch.appTrans || chosen.transitions.find((t) => t.name === ch.appTrans)?.legs.some((l) => l.ident === h.ident) || chosen.final.some((l) => l.ident === h.ident)) : [];
    return { all, onApproach };
  }, [pa, pd, ch.approach, ch.appTrans]);
}

const altTxt = (ft: number | null) => (ft == null ? "" : ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString()} ft`);
const ll = (f: PathFix): [number, number] => [f.lon, f.lat];
/** One path from a transition's first fix through the final approach to the runway. */
function pathCoords(p: APath, trans: string | null | undefined, lead?: [number, number] | null): { coords: Array<[number, number]>; fixes: PathFix[] } {
  const t = trans ? p.transitions.find((x) => x.name === trans) : null;
  const fx: PathFix[] = [...(t?.legs ?? [])];
  for (const f of p.final) if (!fx.length || fx[fx.length - 1]!.ident !== f.ident) fx.push(f);
  const coords = fx.map(ll);
  if (lead && coords[0] && (Math.abs(lead[0] - coords[0][0]) > 1e-4 || Math.abs(lead[1] - coords[0][1]) > 1e-4)) coords.unshift(lead);
  return { coords, fixes: fx };
}

function useAirportWx(icao: string | null) {
  const [a, setA] = useState<AirportDetail | null>(null);
  const [m, setM] = useState<Metar | null>(null);
  useEffect(() => {
    setA(null); setM(null);
    if (!icao || !/^[A-Z0-9]{3,4}$/.test(icao)) return;
    let off = false;
    void airportDetail(icao).then((d) => { if (!off) setA(d); }).catch(() => undefined);
    void getMetar([icao]).then((r) => { if (!off) setM(r[0] ?? null); }).catch(() => undefined);
    return () => { off = true; };
  }, [icao]);
  return { airport: a, metar: m };
}

const endsOf = (a: AirportDetail | null): End[] => (a?.runways ?? []).flatMap((r) => r.ends).filter((e) => e.ident && Number.isFinite(e.threshold.lat));
const runwayOf = (a: AirportDetail | null, ident: string | null | undefined) => a?.runways.find((r) => r.ends.some((e) => e.ident === ident)) ?? null;
const endOf = (a: AirportDetail | null, ident: string | null | undefined) => endsOf(a).find((e) => e.ident === ident) ?? null;
const windOf = (m: Metar | null) => (m && typeof m.windDir === "number" && m.windKt !== null ? { dirDeg: m.windDir, kt: m.windKt } : null);
const serves = (p: Proc, rw: string | null | undefined) => !rw || !p.runways.length || p.runways.includes(rw);

function Wind({ end, metar }: { end: End | null; metar: Metar | null }) {
  const w = windOf(metar);
  if (!end) return null;
  if (!w) return metar?.windDir === "VRB" ? <span className="fs-w"><span className="fs-wp">Variable {metar.windKt} kt</span></span> : null;
  const { head, cross } = runwayWind(end.headingTrueDeg, w);
  const h = Math.round(head), x = Math.round(Math.abs(cross));
  return (
    <span className="fs-w" title="Wind along and across the runway, from the latest METAR">
      <span className={`fs-wp ${h < 0 ? "tail" : "head"}`}>{h < 0 ? "↓" : "↑"} {Math.abs(h)} kt {h < 0 ? "tail" : "head"}</span>
      {x > 0 && <span className={`fs-wp cross${x >= 15 ? " strong" : ""}`}>{cross > 0 ? "←" : "→"} {x} kt cross</span>}
    </span>
  );
}

const PHONETIC: Record<string, string> = { A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf", H: "Hotel", I: "India", J: "Juliett", K: "Kilo", L: "Lima", M: "Mike", N: "November", O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo", S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu" };
const WORD_TO_LETTER: Record<string, string> = Object.fromEntries(Object.entries(PHONETIC).map(([k, v]) => [v.toUpperCase().replace("-", ""), k]));
WORD_TO_LETTER.ALPHA = "A"; WORD_TO_LETTER.JULIET = "J"; WORD_TO_LETTER.WHISKY = "W";
/** The information letter from an ATIS text ("…INFORMATION GOLF…", "ATIS G", "INFO K"). */
export function atisLetter(text: string): string | null {
  const t = text.toUpperCase().replace(/\s+/g, " ");
  const w = /\b(?:INFORMATION|INFO|ATIS)\s+(ALFA|ALPHA|BRAVO|CHARLIE|DELTA|ECHO|FOXTROT|GOLF|HOTEL|INDIA|JULIETT?|KILO|LIMA|MIKE|NOVEMBER|OSCAR|PAPA|QUEBEC|ROMEO|SIERRA|TANGO|UNIFORM|VICTOR|WHISKEY|WHISKY|X-?RAY|YANKEE|ZULU)\b/.exec(t);
  if (w) return WORD_TO_LETTER[w[1]!.replace("-", "")] ?? null;
  const l = /\b(?:INFORMATION|INFO|ATIS)\s+([A-Z])\b/.exec(t);
  return l ? l[1]! : null;
}
interface Atis { letter: string | null; text: string; callsign: string; network: string }
/** Online ATIS for these airports on VATSIM (and IVAO when you show it on the map). */
function useAtis(codes: string[]): Record<string, Atis> {
  const s = useSettings();
  const v = usePoll(() => getLiveNetwork("vatsim"), 60_000, []);
  const i = usePoll(s.showIvao ? () => getLiveNetwork("ivao") : null, 60_000, [s.showIvao]);
  return useMemo(() => {
    const out: Record<string, Atis> = {};
    for (const net of [v.data, i.data]) for (const c of net?.controllers ?? []) {
      const m = /^([A-Z0-9]{4})(?:_[A-Z])?_ATIS$/.exec(c.callsign.toUpperCase());
      if (!m || !codes.includes(m[1]!) || out[m[1]!]) continue;
      const text = c.atis.join(" ").trim();
      if (!text) continue;
      out[m[1]!] = { letter: atisLetter(text), text, callsign: c.callsign, network: c.network === "ivao" ? "IVAO" : "VATSIM" };
    }
    return out;
  }, [v.data, i.data, codes.join()]);
}

function AtisChip({ a, icao, open, onToggle }: { a: Atis | undefined; icao: string; open: boolean; onToggle: () => void }) {
  if (!a) return <span className="fs-atis none" title={`No ATIS online for ${icao} on VATSIM or IVAO right now`}>ATIS <b>—</b></span>;
  return (
    <button className="fs-atis" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }} title={`${a.callsign} on ${a.network}: tap to read`}>
      ATIS <b>{a.letter ?? "?"}</b>{a.letter && <span>{PHONETIC[a.letter]}</span>}
    </button>
  );
}
function AtisText({ a }: { a: Atis | undefined }) {
  if (!a) return null;
  return <div className="fs-atis-text"><div className="fs-atis-h"><b>{a.letter ? `Information ${PHONETIC[a.letter]}` : "ATIS"}</b><span>{a.callsign} · {a.network}</span></div><p>{a.text}</p></div>;
}

/** The weather in one line: wind, visibility, cloud, temperature, QNH. */
function WxLine({ m }: { m: Metar | null }) {
  if (!m) return null;
  const wind = m.windKt === null ? null : m.windKt === 0 ? "Calm" : `${m.windDir === "VRB" || m.windDir === null ? "VRB" : String(m.windDir).padStart(3, "0")}/${m.windKt}${m.gustKt ? `G${m.gustKt}` : ""} kt`;
  const sm = m.visibility === null ? null : parseFloat(m.visibility);
  const vis = sm === null || !Number.isFinite(sm) ? null : sm >= 6 || m.visibility?.includes("+") ? "10 km+" : `${(sm * 1.609).toFixed(sm < 1 ? 1 : 0)} km`;
  const low = m.clouds.filter((c) => /BKN|OVC|VV/.test(c.cover) && c.baseFt !== null).sort((a, b) => a.baseFt! - b.baseFt!)[0];
  const cloud = low ? `${low.cover} ${low.baseFt!.toLocaleString()} ft` : m.clouds.length ? null : "No cloud";
  const items = [wind && ["Wind", wind], vis && ["Vis", vis], cloud && ["Cloud", cloud], m.tempC !== null && ["Temp", `${m.tempC}°/${m.dewC ?? "–"}°`], m.qnhHpa !== null && ["QNH", String(m.qnhHpa)]].filter(Boolean) as Array<[string, string]>;
  return <div className="fs-wx" title={m.raw}>{items.map(([k, v]) => <span key={k}><em>{k}</em>{v}</span>)}</div>;
}

function Cat({ m }: { m: Metar | null }) {
  if (!m?.category) return null;
  return <span className={`fs-cat c-${m.category.toLowerCase()}`}><i />{m.category}</span>;
}

/** Pick a transition by default when the flight plan already goes through it. */
function planTrans(p: { transitions: string[] }, plan: FlightPlan | null): string | undefined {
  const ids = new Set((plan?.fixes ?? []).map((f) => f.ident.toUpperCase()));
  return p.transitions.find((t) => ids.has(t));
}

interface Confirm { title: string; text: string; ok: () => void }

export function FlightSetup({ plan, onLines, onFocus, onFit, onWaypoints }: {
  plan: FlightPlan;
  /** Runway lines to draw on the map. */
  onLines?: (l: RunwayLine[]) => void;
  /** Move the map to an airport. */
  onFocus?: (lat: number, lon: number, zoom: number) => void;
  /** Fit the map to these bounds: [west, south, east, north]. */
  onFit?: (box: [number, number, number, number]) => void;
  onWaypoints?: () => void;
}) {
  const mode = useApp((s) => s.mode);
  const live = mode === "bridge";
  const dep = plan.origin.icao.toUpperCase(), arr = plan.destination.icao.toUpperCase();
  const ch = useChoice(dep, arr);
  const O = useAirportWx(dep), D = useAirportWx(arr);
  const P = useProcs(dep, live), Q = useProcs(arr, live);
  const [pathTry, setPathTry] = useState(0);
  const paths = usePaths(arr, live, pathTry);
  const atis = useAtis([dep, arr]);
  const [atisOpen, setAtisOpen] = useState<string | null>(null);
  const toggleAtis = (c: string) => setAtisOpen((x) => (x === c ? null : c));
  const [hotApp, setHotApp] = useState<string | null>(null);
  const [view, setView] = useState<View>("main");
  const [hot, setHot] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const sc = root.current?.closest(".map-route"); if (sc) sc.scrollTop = 0; }, [view]);

  const depRwy = ch.depRunway === "" ? null : ch.depRunway ?? plan.origin.runway ?? null;
  const arrRwy = ch.arrRunway === "" ? null : ch.arrRunway ?? plan.destination.runway ?? null;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null;
  const star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const approach = ch.approach || null;
  const sidP = P.data?.departures.find((p) => p.name === sid) ?? null;
  const starP = Q.data?.arrivals.find((p) => p.name === star) ?? null;
  const appP = Q.data?.approaches.find((a) => a.name === approach) ?? null;

  const set = (patch: Partial<ProcChoice>) => saveChoice(dep, { ...loadChoice(dep, arr), ...patch, arr });
  const ask = (c: Confirm) => setConfirm(c);
  const open = (v: View) => {
    setView(v); setHot(null);
  };

  // What the map shows: every runway while you choose, otherwise just your picks.
  const lines = useMemo<RunwayLine[]>(() => {
    const out: RunwayLine[] = [];
    if (view === "dep-rwy" || view === "sid") {
      for (const e of endsOf(O.airport)) out.push({ id: `d-${e.ident}`, kind: "dep", state: e.ident === hot ? "hot" : e.ident === depRwy ? "set" : "preview", label: `RWY ${e.ident}`, coords: departLine(e) });
      return out;
    }
    if (view === "app" && paths) {
      for (const p of paths) {
        const st = (on: boolean) => (on ? "hot" : p.name === approach ? "set" : "preview") as RunwayLine["state"];
        const on = hotApp ? hotApp === p.name : hot === p.runway;
        for (const t of p.transitions) { const c = pathCoords(p, t.name); if (c.coords.length > 1) out.push({ id: `p-${p.name}-${t.name}`, kind: "app", state: st(on), label: `${p.name} (${t.name})`, coords: c.coords, box: true, fixes: on ? c.fixes.map((f) => ({ ...f, alt: altTxt(f.altFt) })) : undefined }); }
        const c = pathCoords(p, null);
        out.push({ id: `p-${p.name}-final`, kind: "app", state: st(on), label: `${p.name} (Final)`, coords: c.coords, box: true, fixes: on ? c.fixes.map((f) => ({ ...f, alt: altTxt(f.altFt) })) : undefined });
      }
      return out;
    }
    if (view === "arr-rwy" || view === "app" || view === "star") {
      const withApp = new Set((Q.data?.approaches ?? []).map((a) => a.runway));
      for (const e of endsOf(D.airport)) {
        if (withApp.size && !withApp.has(e.ident) && e.ident !== arrRwy && view === "app") continue;
        out.push({ id: `a-${e.ident}`, kind: "app", state: e.ident === hot ? "hot" : e.ident === arrRwy ? "set" : "preview", label: e.ident === arrRwy && approach ? approach : `RWY ${e.ident}`, coords: finalLine(e) });
      }
      return out;
    }
    const de = endOf(O.airport, depRwy), ae = endOf(D.airport, arrRwy);
    if (de) out.push({ id: `d-${de.ident}`, kind: "dep", state: "set", label: `RWY ${de.ident}`, coords: departLine(de) });
    const chosen = approach ? paths?.find((p) => p.name === approach) : null;
    if (chosen) {
      // Where to fly after the STAR: its last fix, the approach transition, the final approach, the runway.
      const starLast = [...plan.fixes].reverse().find((f) => f.proc === "star");
      const c = pathCoords(chosen, ch.appTrans, starLast ? [starLast.lon, starLast.lat] : null);
      out.push({ id: `p-${chosen.name}`, kind: "app", state: "set", label: `${chosen.name}${ch.appTrans ? ` (${ch.appTrans})` : ""}`, coords: c.coords, box: true, fixes: c.fixes.map((f) => ({ ...f, alt: altTxt(f.altFt) })) });
    } else if (ae) out.push({ id: `a-${ae.ident}`, kind: "app", state: "set", label: approach ?? `RWY ${ae.ident}`, coords: finalLine(ae) });
    return out;
  }, [view, hot, hotApp, paths, O.airport, D.airport, Q.data, depRwy, arrRwy, approach, ch.appTrans, plan]);
  const key = JSON.stringify(lines.map((l) => [l.id, l.state, l.label]));
  useEffect(() => { onLines?.(lines); }, [key]);
  useEffect(() => () => onLines?.([]), []);
  // Opening a sheet frames that airport's runways (or the whole arrival for a STAR).
  const framed = view === "main" ? "" : `${view}:${(view === "dep-rwy" || view === "sid" ? O.airport : D.airport) ? 1 : 0}`;
  useEffect(() => {
    if (view === "main") return;
    const a = view === "dep-rwy" || view === "sid" ? O.airport : D.airport;
    const pts = lines.flatMap((l) => l.coords);
    if (view === "star") for (const f of plan.fixes.filter((x) => x.proc === "star")) pts.push([f.lon, f.lat]);
    if (!pts.length) { if (a) onFocus?.(a.lat, a.lon, 10); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (onFit) onFit([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    else if (a) onFocus?.(a.lat, a.lon, 10);
  }, [framed]);

  // ---------- choices, with the same conflict checks a chart app makes ----------
  const pickDepRwy = (rw: string) => {
    const go = () => { set({ depRunway: rw, ...(sidP && rw && !serves(sidP, rw) ? { sid: "", sidTrans: undefined } : {}) }); open("main"); };
    if (sidP && rw && !serves(sidP, rw)) ask({ title: "Procedure conflict", text: `${sidP.name} doesn't start from runway ${rw}, so it will be removed.`, ok: go });
    else go();
  };
  const pickArrRwy = (rw: string) => {
    const lose = [starP && rw && !serves(starP, rw) ? starP.name : null, appP && rw && appP.runway !== rw ? appP.name : null].filter(Boolean) as string[];
    const go = () => { set({ arrRunway: rw, ...(lose.includes(starP?.name ?? "") ? { star: "", starTrans: undefined } : {}), ...(lose.includes(appP?.name ?? "") ? { approach: undefined, appTrans: undefined } : {}) }); open("main"); };
    if (lose.length) ask({ title: "Procedure conflict", text: `${lose.join(" and ")} ${lose.length > 1 ? "don't" : "doesn't"} go with runway ${rw}, so ${lose.length > 1 ? "they" : "it"} will be removed.`, ok: go });
    else go();
  };
  const best = (rws: string[], a: AirportDetail | null, m: Metar | null) => {
    const w = windOf(m);
    const ends = rws.map((r) => endOf(a, r)).filter(Boolean) as End[];
    if (!ends.length) return rws[0] ?? null;
    return [...ends].sort((x, y) => (w ? runwayWind(y.headingTrueDeg, w).head - runwayWind(x.headingTrueDeg, w).head : 0) || y.lengthFt - x.lengthFt)[0]!.ident;
  };
  const pickSid = (p: Proc, trans: string | undefined) => {
    if (serves(p, depRwy)) { set({ sid: p.name, sidTrans: trans }); open("main"); return; }
    const rw = best(p.runways, O.airport, O.metar);
    ask({ title: "Change runway?", text: `${p.name} starts from runway ${p.runways.join(", ")}. Glidepath will set runway ${rw} for departure.`, ok: () => { set({ sid: p.name, sidTrans: trans, depRunway: rw ?? undefined }); open("main"); } });
  };
  const pickStar = (p: Proc, trans: string | undefined) => {
    if (serves(p, arrRwy)) { set({ star: p.name, starTrans: trans }); open("main"); return; }
    const rw = best(p.runways, D.airport, D.metar);
    const loseApp = appP && appP.runway !== rw;
    ask({ title: "Change runway?", text: `${p.name} serves runway ${p.runways.join(", ")}. Glidepath will set runway ${rw} for landing${loseApp ? ` and remove ${appP!.name}` : ""}.`, ok: () => { set({ star: p.name, starTrans: trans, arrRunway: rw ?? undefined, ...(loseApp ? { approach: undefined, appTrans: undefined } : {}) }); open("main"); } });
  };
  const pickApp = (a: Appr, trans: string | undefined) => {
    const loseStar = starP && a.runway && !serves(starP, a.runway);
    const go = () => { set({ approach: a.name, appTrans: trans, ...(a.runway ? { arrRunway: a.runway } : {}), ...(loseStar ? { star: "", starTrans: undefined } : {}) }); open("main"); };
    if (loseStar) ask({ title: "Procedure conflict", text: `${starP!.name} doesn't go to runway ${a.runway}, so it will be removed.`, ok: go });
    else go();
  };

  // ---------- route bar ----------
  const enroute = plan.fixes.filter((f) => !f.proc && !/^T\/?[CD]$|^TO[CD]$/.test(f.ident)).length;
  const bar = (
    <nav className="fs-bar" aria-label="Your route">
      <button className="fs-c ap" onClick={() => O.airport && onFocus?.(O.airport.lat, O.airport.lon, 11)}>{dep}</button>
      <button className="fs-c rw" onClick={() => open("dep-rwy")}>{depRwy ? `RW${depRwy}` : "RW?"}</button>
      <button className={`fs-c sid${sid ? "" : " empty"}`} onClick={() => open("sid")}>{sid ? `${sid}${ch.sidTrans ? `.${ch.sidTrans}` : ""}` : "+ SID"}</button>
      {onWaypoints ? <button className="fs-c en" onClick={onWaypoints}>{enroute} {enroute === 1 ? "fix" : "fixes"}</button> : <span className="fs-c en">{enroute} {enroute === 1 ? "fix" : "fixes"}</span>}
      <button className={`fs-c star${star ? "" : " empty"}`} onClick={() => open("star")}>{star ? `${ch.starTrans ? `${ch.starTrans}.` : ""}${star}` : "+ STAR"}</button>
      <button className={`fs-c app${approach ? "" : " empty"}`} onClick={() => open("app")}>{approach ?? "+ Approach"}</button>
      <button className="fs-c rw" onClick={() => open("arr-rwy")}>{arrRwy ? `RW${arrRwy}` : "RW?"}</button>
      <button className="fs-c ap" onClick={() => D.airport && onFocus?.(D.airport.lat, D.airport.lon, 11)}>{arr}</button>
    </nav>
  );

  const why = (s: typeof P) => !live ? "SIDs, STARs and approaches come from Microsoft Flight Simulator through the Bridge on your PC. Connect your Bridge with the sim running once; after that Glidepath keeps them, even with the sim closed." : s.loading ? "Reading procedures from the simulator…" : s.err ? `${s.err} Procedures come from the sim through the Bridge: make sure the Bridge is running (and updated) and the sim is loaded, then try again.` : null;
  const retryBtn = (s: typeof P) => (s.err || !s.data) && live && !s.loading ? <button className="btn small" onClick={() => { s.retry(); setPathTry((x) => x + 1); }}>Try again</button> : null;
  const count = (s: typeof P, n: number | undefined, word: string, v: View, tone: string) => (
    <div className={`fs-avail t-${tone}`}>
      {n ? <><b className="fs-n">{n}</b><span>{n === 1 ? ({ Departures: "Departure", Arrivals: "Arrival", Approaches: "Approach" } as Record<string, string>)[word] ?? word : word} available</span></> : <span className="faint">{s.loading ? "Reading from the sim…" : live && !s.err ? `No ${word.toLowerCase()} found` : `${word} come from the sim`}</span>}
      <button className="btn small" onClick={() => open(v)}>Select</button>
    </div>
  );

  // ---------- sheets ----------
  if (view !== "main") {
    const isDep = view === "dep-rwy" || view === "sid";
    const A = isDep ? O : D, S = isDep ? P : Q;
    const title = { "dep-rwy": "Departure runway", sid: "Departure (SID)", "arr-rwy": "Landing runway", star: "Arrival (STAR)", app: "Approach" }[view];
    let body: ReactNode = null;
    if (view === "dep-rwy" || view === "arr-rwy") {
      const cur = isDep ? depRwy : arrRwy;
      body = (
        <>
          {!A.airport && <p className="fs-note">Loading runways for {isDep ? dep : arr}…</p>}
          {(A.airport?.runways ?? []).map((r, i) => (
            <div className="fs-rwgrp" key={i}>
              <div className="fs-gh">{r.ends.map((e) => e.ident).join(" / ")}<span>{r.lengthFt ? `${Math.round(r.lengthFt).toLocaleString()} ft · ${Math.round(r.lengthFt * 0.3048).toLocaleString()} m` : ""}{r.surface ? ` · ${r.surface}` : ""}</span></div>
              {r.ends.map((e) => (
                <div key={e.ident} className={`fs-row${e.ident === cur ? " cur" : ""}`} onMouseEnter={() => setHot(e.ident)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(e.ident)}>
                  <span className="fs-rwid">{e.ident}</span>
                  <span className="fs-rmid"><Wind end={e} metar={A.metar} />{!isDep && Q.data && <span className="fs-sub">{Q.data.approaches.filter((a) => a.runway === e.ident).map((a) => a.name).join(" · ") || "No approaches in the sim"}</span>}</span>
                  {e.ident === cur ? <span className="fs-in">Selected</span> : <button className="btn small primary" onClick={() => (isDep ? pickDepRwy(e.ident) : pickArrRwy(e.ident))}>Change to</button>}
                </div>
              ))}
            </div>
          ))}
        </>
      );
    } else if (view === "sid" || view === "star") {
      const list = (view === "sid" ? P.data?.departures : Q.data?.arrivals) ?? [];
      const rw = view === "sid" ? depRwy : arrRwy, curName = view === "sid" ? sid : star;
      const mine = list.filter((p) => serves(p, rw)), other = list.filter((p) => !serves(p, rw));
      const row = (p: Proc) => <ProcRow key={p.name} p={p} cur={p.name === curName} curTrans={view === "sid" ? ch.sidTrans : ch.starTrans} plan={plan} tone={view} onAdd={(t) => (view === "sid" ? pickSid(p, t) : pickStar(p, t))} />;
      body = !list.length ? <><p className="fs-note">{why(S) ?? "No procedures."}</p>{retryBtn(S)}</> : (
        <>
          {curName && <button className="btn small fs-none" onClick={() => { set(view === "sid" ? { sid: "", sidTrans: undefined } : { star: "", starTrans: undefined }); open("main"); }}>Remove {curName}{view === "sid" ? " (fly vectors)" : ""}</button>}
          {mine.length > 0 && <div className="fs-gh">{rw ? `${view === "sid" ? "From" : "To"} runway ${rw}` : "All"}<span>{mine.length}</span></div>}
          {mine.map(row)}
          {other.length > 0 && <div className="fs-gh">Other runways<span>{other.length}</span></div>}
          {other.map(row)}
        </>
      );
    } else {
      const apps = Q.data?.approaches ?? [];
      const byRw = new Map<string, Appr[]>();
      for (const a of apps) byRw.set(a.runway || "—", [...(byRw.get(a.runway || "—") ?? []), a]);
      const order = [...byRw.keys()].sort((x, y) => (x === arrRwy ? -1 : y === arrRwy ? 1 : x.localeCompare(y)));
      body = !apps.length ? (
        <>
          <p className="fs-note">{why(Q) ?? "No approaches."}</p>
          {retryBtn(Q)}
          {endsOf(D.airport).length > 0 && <p className="fs-note">You can still choose the landing runway; the map shows its final approach course.</p>}
          {endsOf(D.airport).length > 0 && <button className="btn small" onClick={() => setView("arr-rwy")}>Choose landing runway</button>}
        </>
      ) : order.map((rw) => {
        const e = endOf(D.airport, rw);
        return (
          <div className="fs-rwgrp" key={rw} onMouseEnter={() => setHot(rw)} onMouseLeave={() => setHot(null)}>
            <div className="fs-gh">Runway {rw}{rw === arrRwy ? <em>planned</em> : null}<Wind end={e} metar={D.metar} /></div>
            {byRw.get(rw)!.map((a) => <ProcRow key={a.name} onHover={(on) => setHotApp(on ? a.name : null)} p={{ name: a.name, runways: [a.runway], transitions: a.transitions }} badge={a.type} cur={a.name === approach} curTrans={ch.appTrans} plan={plan} tone="app" none="Vectors" onFocus={() => setHot(rw)} onAdd={(t) => pickApp(a, t)} />)}
          </div>
        );
      });
    }
    return (
      <div className="fs fs-sheet" ref={root}>
        <div className="fs-sh">
          <button className="btn small" onClick={() => open("main")}>Back</button>
          <b>{title}</b>
          <span className="fs-icao">{isDep ? dep : arr}</span>
        </div>
        {view === "app" && paths ? <p className="fs-hint"><i className="fs-key app" />Each approach is drawn from its first fix to the runway. Point at one to see its fixes and altitudes.</p>
          : (view === "app" || view === "arr-rwy") && <p className="fs-hint"><i className="fs-key app" />The lines on the map are each runway's final approach course ({FINAL_NM} nm). Point at a runway to highlight it.</p>}
        {(view === "dep-rwy" || view === "sid") && <p className="fs-hint"><i className="fs-key dep" />Green lines show each runway's take-off direction.</p>}
        {S.cached && <p className="fs-hint">Saved from an earlier session with the sim. Start the sim to refresh.</p>}
        <div className="fs-scroll">{body}</div>
        {confirm && <ConfirmBox c={confirm} close={() => setConfirm(null)} />}
      </div>
    );
  }

  // ---------- main ----------
  const oe = endOf(O.airport, depRwy), de = endOf(D.airport, arrRwy);
  const rwLen = (a: AirportDetail | null, id: string | null) => { const r = runwayOf(a, id); return r?.lengthFt ? `${Math.round(r.lengthFt).toLocaleString()} ft` : ""; };
  return (
    <div className="fs" ref={root}>
      {bar}
      <section className="fs-card">
        <div className="fs-k">Origin</div>
        <div className="fs-ap">
          <div><b>{dep}{O.airport?.iata ? ` / ${O.airport.iata}` : ""}</b><Cat m={O.metar} /><AtisChip a={atis[dep]} icao={dep} open={atisOpen === dep} onToggle={() => toggleAtis(dep)} /></div>
          <span>{O.airport ? `${O.airport.name}${O.airport.city ? `, ${O.airport.city}` : ""}` : plan.origin.name ?? ""}</span>
          <WxLine m={O.metar} />
          {atisOpen === dep && <AtisText a={atis[dep]} />}
        </div>
        <button className="fs-line t-rw" onClick={() => open("dep-rwy")}>
          <span className="fs-lk">Runway</span><b className="fs-big">{depRwy ?? "Choose"}</b>
          <span className="fs-lm"><Wind end={oe} metar={O.metar} /><span className="fs-sub">{rwLen(O.airport, depRwy)}</span></span><span className="fs-chev" aria-hidden>›</span>
        </button>
        {sid ? (
          <button className="fs-line t-sid" onClick={() => open("sid")}>
            <span className="fs-lk">Departure</span><b>{sid}</b>
            <span className="fs-lm">{ch.sidTrans ? <span className="fs-sub">Transition <b>{ch.sidTrans}</b></span> : sidP?.transitions.length ? <span className="fs-sub">{sidP.transitions.length} transitions</span> : null}</span><span className="fs-chev" aria-hidden>›</span>
          </button>
        ) : count(P, P.data?.departures.filter((p) => serves(p, depRwy)).length, "Departures", "sid", "sid")}
      </section>
      <section className="fs-card">
        <div className="fs-k">Destination</div>
        <div className="fs-ap">
          <div><b>{arr}{D.airport?.iata ? ` / ${D.airport.iata}` : ""}</b><Cat m={D.metar} /><AtisChip a={atis[arr]} icao={arr} open={atisOpen === arr} onToggle={() => toggleAtis(arr)} /></div>
          <span>{D.airport ? `${D.airport.name}${D.airport.city ? `, ${D.airport.city}` : ""}` : plan.destination.name ?? ""}</span>
          <WxLine m={D.metar} />
          {atisOpen === arr && <AtisText a={atis[arr]} />}
        </div>
        <button className="fs-line t-rw" onClick={() => open("arr-rwy")}>
          <span className="fs-lk">Runway</span><b className="fs-big">{arrRwy ?? "Choose"}</b>
          <span className="fs-lm"><Wind end={de} metar={D.metar} /><span className="fs-sub">{rwLen(D.airport, arrRwy)}</span></span><span className="fs-chev" aria-hidden>›</span>
        </button>
        {star ? (
          <button className="fs-line t-star" onClick={() => open("star")}>
            <span className="fs-lk">Arrival</span><b>{star}</b>
            <span className="fs-lm">{ch.starTrans ? <span className="fs-sub">Transition <b>{ch.starTrans}</b></span> : null}</span><span className="fs-chev" aria-hidden>›</span>
          </button>
        ) : count(Q, Q.data?.arrivals.filter((p) => serves(p, arrRwy)).length, "Arrivals", "star", "star")}
        {approach ? (
          <button className="fs-line t-app" onClick={() => open("app")}>
            <span className="fs-lk">Approach</span><b>{approach}</b>
            <span className="fs-lm"><span className="fs-sub">{ch.appTrans ? <>Via <b>{ch.appTrans}</b></> : "Vectors"}</span></span><span className="fs-chev" aria-hidden>›</span>
          </button>
        ) : count(Q, Q.data?.approaches.length, "Approaches", "app", "app")}
      </section>
      {plan.alternate && (
        <section className="fs-card fs-alt">
          <div className="fs-k">Alternate</div>
          <div className="fs-ap"><div><b>{plan.alternate}</b></div></div>
        </section>
      )}
      <p className="fs-foot">This is your plan in Glidepath: the live card, Landing helper and Performance use it. It doesn't change the aircraft, so enter the same in your FMC or MCDU.</p>
      {confirm && <ConfirmBox c={confirm} close={() => setConfirm(null)} />}
    </div>
  );
}

function openChart(icao: string, kind: "app" | "sid" | "star", name: string) {
  try { localStorage.setItem("glidepath.chartPick", JSON.stringify({ icao, kind, name })); } catch { /* private */ }
  location.hash = "#/charts";
}

function ProcRow({ p, cur, curTrans, plan, tone, onAdd, badge, none = "None", onFocus, onHover }: { p: Proc; cur: boolean; curTrans: string | undefined; plan: FlightPlan; tone: string; onAdd: (t: string | undefined) => void; badge?: string; none?: string; onFocus?: () => void; onHover?: (on: boolean) => void }) {
  const [t, setT] = useState<string | undefined>(() => (cur ? curTrans : undefined) ?? planTrans(p, plan) ?? (p.transitions.length === 1 && none === "None" ? p.transitions[0] : undefined));
  return (
    <div className={`fs-proc t-${tone}${cur ? " cur" : ""}`} onFocus={() => { onFocus?.(); onHover?.(true); }} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}>
      <div className="fs-ph">
        <b>{p.name}</b>
        {badge && <span className="fs-badge">{badge === "GPS" ? "RNAV" : badge}</span>}
        {tone !== "app" && p.runways.length > 0 && <span className="fs-sub">RWY {p.runways.join(", ")}</span>}
        {cur ? <span className="fs-in">In your route</span> : null}
        <button className="btn small" onClick={() => openChart(tone === "sid" ? plan.origin.icao.toUpperCase() : plan.destination.icao.toUpperCase(), tone as "app" | "sid" | "star", p.name)}>Chart</button>
        <button className={`btn small ${cur ? "" : "primary"}`} onClick={() => onAdd(t)}>{cur ? "Update" : "Add to route"}</button>
      </div>
      {p.transitions.length > 0 && (
        <div className="fs-trans" role="group" aria-label={`${p.name} transitions`}>
          <span className="fs-tk">{tone === "app" ? "Via" : "Transition"}</span>
          <button className={!t ? "on" : ""} onClick={() => setT(undefined)}>{none}</button>
          {p.transitions.map((x) => <button key={x} className={t === x ? "on" : ""} onClick={() => setT(x)}>{x}</button>)}
        </div>
      )}
    </div>
  );
}

function ConfirmBox({ c, close }: { c: Confirm; close: () => void }) {
  return (
    <div className="fs-confirm" role="alertdialog" aria-label={c.title}>
      <div className="fs-cbox">
        <b>{c.title}</b>
        <p>{c.text}</p>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="btn small" onClick={close}>Cancel</button>
          <button className="btn small primary" autoFocus onClick={() => { close(); c.ok(); }}>OK</button>
        </div>
      </div>
    </div>
  );
}
