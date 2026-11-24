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
import { getMetar, type Metar } from "../data/external";
import { useApp } from "../data/store";
import { loadChoice, saveChoice, useChoice, useProcs, type ProcChoice } from "./Procedures";

type End = AirportDetail["runways"][number]["ends"][number];
type Proc = { name: string; runways: string[]; transitions: string[] };
type Appr = { name: string; type: string; runway: string; transitions: string[] };
type View = "main" | "dep-rwy" | "sid" | "arr-rwy" | "star" | "app";

/** A line drawn on the map for a runway: its final approach course, or its departure direction. */
export interface RunwayLine { id: string; kind: "app" | "dep"; state: "preview" | "hot" | "set"; label: string; coords: Array<[number, number]> }

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
    if (ae) out.push({ id: `a-${ae.ident}`, kind: "app", state: "set", label: approach ?? `RWY ${ae.ident}`, coords: finalLine(ae) });
    return out;
  }, [view, hot, O.airport, D.airport, Q.data, depRwy, arrRwy, approach]);
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

  const why = (s: typeof P) => !live ? "Procedure lists come from Microsoft Flight Simulator. Connect your Bridge with the sim running to see them." : s.loading ? "Reading procedures from the simulator…" : s.err ?? null;
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
      body = !list.length ? <p className="fs-note">{why(S) ?? "No procedures."}</p> : (
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
          {endsOf(D.airport).length > 0 && <p className="fs-note">You can still choose the landing runway; the map shows its final approach course.</p>}
          {endsOf(D.airport).length > 0 && <button className="btn small" onClick={() => setView("arr-rwy")}>Choose landing runway</button>}
        </>
      ) : order.map((rw) => {
        const e = endOf(D.airport, rw);
        return (
          <div className="fs-rwgrp" key={rw} onMouseEnter={() => setHot(rw)} onMouseLeave={() => setHot(null)}>
            <div className="fs-gh">Runway {rw}{rw === arrRwy ? <em>planned</em> : null}<Wind end={e} metar={D.metar} /></div>
            {byRw.get(rw)!.map((a) => <ProcRow key={a.name} p={{ name: a.name, runways: [a.runway], transitions: a.transitions }} badge={a.type} cur={a.name === approach} curTrans={ch.appTrans} plan={plan} tone="app" none="Vectors" onFocus={() => setHot(rw)} onAdd={(t) => pickApp(a, t)} />)}
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
        {(view === "app" || view === "arr-rwy") && <p className="fs-hint"><i className="fs-key app" />Yellow lines on the map are each runway's final approach course ({FINAL_NM} nm). Point at a runway to highlight it.</p>}
        {(view === "dep-rwy" || view === "sid") && <p className="fs-hint"><i className="fs-key dep" />Green lines show each runway's take-off direction.</p>}
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
          <div><b>{dep}{O.airport?.iata ? ` / ${O.airport.iata}` : ""}</b><Cat m={O.metar} /></div>
          <span>{O.airport ? `${O.airport.name}${O.airport.city ? `, ${O.airport.city}` : ""}` : plan.origin.name ?? ""}</span>
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
          <div><b>{arr}{D.airport?.iata ? ` / ${D.airport.iata}` : ""}</b><Cat m={D.metar} /></div>
          <span>{D.airport ? `${D.airport.name}${D.airport.city ? `, ${D.airport.city}` : ""}` : plan.destination.name ?? ""}</span>
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

function ProcRow({ p, cur, curTrans, plan, tone, onAdd, badge, none = "None", onFocus }: { p: Proc; cur: boolean; curTrans: string | undefined; plan: FlightPlan; tone: string; onAdd: (t: string | undefined) => void; badge?: string; none?: string; onFocus?: () => void }) {
  const [t, setT] = useState<string | undefined>(() => (cur ? curTrans : undefined) ?? planTrans(p, plan) ?? (p.transitions.length === 1 && none === "None" ? p.transitions[0] : undefined));
  return (
    <div className={`fs-proc t-${tone}${cur ? " cur" : ""}`} onFocus={onFocus}>
      <div className="fs-ph">
        <b>{p.name}</b>
        {badge && <span className="fs-badge">{badge === "GPS" ? "RNAV" : badge}</span>}
        {tone !== "app" && p.runways.length > 0 && <span className="fs-sub">RWY {p.runways.join(", ")}</span>}
        {cur ? <span className="fs-in">In your route</span> : null}
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
