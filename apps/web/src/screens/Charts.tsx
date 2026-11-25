/**
 * Charts: airport diagrams, SIDs, STARs and approaches for your flight's
 * airports, picked automatically from the flight (or the last one you logged).
 *
 * US airports: the FAA's official charts (free, public), listed by your
 * Bridge and opened straight from the FAA. Everywhere else: one tap to
 * ChartFox (free, sign in with VATSIM) or Navigraph Charts (your subscription),
 * because no free worldwide chart service allows other apps to show them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { useLive } from "../data/derive";
import { Kv, Notice } from "../components/ui";
import { MapView } from "../components/MapView";
import { RunwayDiagram } from "../components/Imagery";
import { TaxiChart } from "../components/TaxiChart";
import { ProcChart, useSidStar } from "../components/ProcChart";
import { loadChoice, useProcs } from "../components/Procedures";
import { airportDetail, searchAirports, type AirportDetail } from "../data/airports";

type Kind = "airport" | "departure" | "arrival" | "approach" | "minimums" | "other";
interface Chart { name: string; kind: Kind; code: string; url: string }
interface AirportCharts { icao: string; source: string; cycle: string; effective: string | null; charts: Chart[] }

const KIND_LABEL: Record<Kind, string> = { airport: "Airport", departure: "SID", arrival: "STAR", approach: "Approach", minimums: "Minimums", other: "Other" };
const KINDS: Kind[] = ["airport", "departure", "arrival", "approach", "minimums", "other"];
const isUS = (c: string) => /^(K|PA|PH|PG|TJ|TI|PF|PP|PO|PW)/.test(c) && c.length === 4;

/** Charts load through your Bridge, so a failed download shows a clear message instead of an error page. */
function frameUrl(c: Chart, cycle: string, bridge: ReturnType<typeof activeBridge>): string {
  const file = c.url.split("/").pop() ?? "";
  return bridge ? `${bridge.authedUrl(`/api/ext/chartpdf?cycle=${cycle}&file=${encodeURIComponent(file)}`)}#view=FitH` : `${c.url}#view=FitH`;
}

/** Through the account relay the chart is downloaded first, then shown from this device. */
function ChartFrame({ c, cycle, bridge }: { c: Chart; cycle: string; bridge: ReturnType<typeof activeBridge> }) {
  const relay = !!bridge?.isRelay;
  const [src, setSrc] = useState<string | null>(relay ? null : frameUrl(c, cycle, bridge));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge?.isRelay) { setSrc(frameUrl(c, cycle, bridge)); return; }
    let url: string | null = null, stop = false;
    setSrc(null); setErr(null);
    const file = c.url.split("/").pop() ?? "";
    bridge.viewUrl(`/api/ext/chartpdf?cycle=${cycle}&file=${encodeURIComponent(file)}`)
      .then((u) => { url = u; if (stop) URL.revokeObjectURL(u); else setSrc(`${u}#view=FitH`); })
      .catch((e: Error) => { if (!stop) setErr(e.message); });
    return () => { stop = true; if (url) URL.revokeObjectURL(url); };
  }, [c.url, cycle, bridge]);
  if (err) return <p className="muted" style={{ padding: 20 }}>Couldn't load this chart through your PC: {err}. Try Open full screen.</p>;
  if (!src) return <p className="muted" style={{ padding: 20 }}>Loading the chart from your PC…</p>;
  return <iframe src={src} title={c.name} />;
}

export function ChartsFor({ icao, compact = false }: { icao: string; compact?: boolean }) {
  const mode = useApp((s) => s.mode);
  const bridge = mode === "bridge" ? activeBridge() : null;
  const [data, setData] = useState<AirportCharts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("airport");
  const [open, setOpen] = useState<Chart | null>(null);
  const code = icao.toUpperCase();

  useEffect(() => {
    setData(null); setErr(null); setOpen(null);
    if (!bridge || !isUS(code)) return;
    let stop = false;
    bridge.get<AirportCharts>(`/api/ext/charts?icao=${encodeURIComponent(code)}`)
      .then((d) => { if (stop) return; setData(d); const first = KINDS.find((k) => d.charts.some((c) => c.kind === k)) ?? "airport"; setKind(first); setOpen(d.charts.find((c) => c.kind === "airport") ?? null); })
      .catch((e) => {
        if (stop) return;
        const m = e instanceof Error ? e.message : String(e);
        setErr(/^Not found$/i.test(m) ? "Your Bridge is older than this app. Download the latest Bridge from the website for charts."
          : /No FAA charts/i.test(m) ? `The FAA has no charts for ${code}.`
          : `Couldn't load the FAA charts right now (${m}). Your Bridge downloads the chart list the first time (about 15 MB), so try again in a minute.`);
      });
    return () => { stop = true; };
  }, [bridge, code]);

  const list = useMemo(() => data?.charts.filter((c) => c.kind === kind) ?? [], [data, kind]);
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, data?.charts.filter((c) => c.kind === k).length ?? 0])), [data]);

  return (
    <div className={`charts${compact ? " compact" : ""}`}>
      <div className="ch-links">
        <a className="btn small" href={`https://chartfox.org/${code}`} target="_blank" rel="noreferrer">ChartFox · {code}</a>
        <a className="btn small" href="https://charts.navigraph.com/" target="_blank" rel="noreferrer">Navigraph Charts</a>
        {/^LF/.test(code) && <a className="btn small" href="https://www.sia.aviation-civile.gouv.fr/vaip" target="_blank" rel="noreferrer">French AIP charts (SIA, free)</a>}
        {isUS(code) && <a className="btn small" href={`https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/search/results/?cycle=&ident=${code}`} target="_blank" rel="noreferrer">FAA website</a>}
      </div>
      {!isUS(code) && <p className="muted ch-note">{/^LF/.test(code) ? <>France publishes its official charts free in the SIA's AIP viewer: tap {code} on its map to open every chart (approach, arrival, departure, aerodrome). </> : null}Jeppesen charts like Navigraph's can't be shown inside other apps: open them in Navigraph Charts with your subscription. ChartFox has official charts for most countries (free, sign in with VATSIM).</p>}
      {isUS(code) && !bridge && <p className="muted ch-note">Connect your PC to see {code}'s FAA charts here. Your Bridge fetches the FAA's free chart list.</p>}
      {err && <Notice>{err}</Notice>}
      {isUS(code) && bridge && !data && !err && <div className="skeleton" style={{ height: 160 }} />}
      {data && (
        <div className="ch-body">
          <div className="ch-side">
            <div className="seg ch-kinds" role="tablist">
              {KINDS.filter((k) => counts[k]).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND_LABEL[k]} <small>{counts[k]}</small></button>)}
            </div>
            <ul className="ch-list">
              {list.map((c) => (
                <li key={c.url}><button className={open?.url === c.url ? "on" : ""} onClick={() => setOpen(c)}><span className={`ch-tag ${c.kind}`}>{KIND_LABEL[c.kind]}</span>{c.name}</button></li>
              ))}
            </ul>
            <p className="faint ch-src">FAA d-TPP cycle {data.cycle}{data.effective ? `, effective ${data.effective}` : ""}. For flight simulation only.</p>
          </div>
          <div className="ch-view">
            {open ? (<>
              <div className="between ch-view-top"><b>{open.name}</b><a className="btn small primary" href={open.url} target="_blank" rel="noreferrer">Open full screen</a></div>
              <ChartFrame key={open.url} c={open} cycle={data.cycle} bridge={bridge} />
            </>) : <p className="muted" style={{ padding: 20 }}>Pick a chart.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The airport sheet: what Glidepath can show for any airport in the world, from open data.
 * Not an official chart: the map is OpenStreetMap, runways and frequencies are OurAirports,
 * procedures are the ones in your simulator's navigation data.
 */
function AirportSheet({ code, dep }: { code: string; dep: string | null }) {
  const mode = useApp((s) => s.mode);
  const [apt, setApt] = useState<AirportDetail | null | undefined>(undefined);
  useEffect(() => { let off = false; setApt(undefined); airportDetail(code).then((a) => { if (!off) setApt(a); }).catch(() => { if (!off) setApt(null); }); return () => { off = true; }; }, [code]);
  const live = mode === "bridge";
  const P = useProcs(code, live);
  const choice = loadChoice(dep, null);
  const picked = new Set([choice.sid, choice.star, choice.approach].filter(Boolean) as string[]);
  if (apt === undefined) return <div className="skeleton" style={{ height: 320 }} />;
  if (apt === null) return <Notice>No airport with the code {code}.</Notice>;
  const freqs = apt.frequencies.slice(0, 12);
  const group = (title: string, tone: string, names: string[]) => names.length ? (
    <div className="as-procs">
      <div className={`as-proc-h t-${tone}`}>{title} <small>{names.length}</small></div>
      <div className="as-proc-list">{names.map((n) => <span key={n} className={`as-proc t-${tone}${picked.has(n) ? " on" : ""}`}>{n}</span>)}</div>
    </div>
  ) : null;
  return (
    <div className="as">
      <div className="as-map glass">
        <MapView key={apt.code} trail={[]} center={[apt.lon, apt.lat]} zoom={apt.size === "small" ? 14.6 : apt.size === "medium" ? 14 : 13.4} interactive />
        <span className="as-map-tag">Airport map · OpenStreetMap · not for navigation</span>
      </div>
      <div className="as-side">
        <section className="glass pad">
          <div className="between"><h3 className="h3" style={{ margin: 0 }}>Runways</h3><span className="faint" style={{ fontSize: 12 }}>to scale, OurAirports</span></div>
          {apt.runways.length === 0 ? <p className="muted">No runway data for this airport.</p> : (<>
            <div className="as-rwy"><RunwayDiagram runways={apt.runways} label={apt.code} /></div>
            <table className="as-rwy-t"><tbody>{apt.runways.map((r) => (
              <tr key={r.ends.map((e) => e.ident).join("/")}><td><b>{r.ends.map((e) => e.ident).join(" / ")}</b></td><td>{r.lengthFt ? `${r.lengthFt.toLocaleString()} ft` : "—"}</td><td>{r.ends.map((e) => `${Math.round(e.headingTrueDeg).toString().padStart(3, "0")}°`).join(" / ")}</td></tr>
            ))}</tbody></table>
          </>)}
        </section>
        {freqs.length > 0 && (
          <section className="glass pad">
            <h3 className="h3" style={{ margin: "0 0 6px" }}>Frequencies</h3>
            <div className="as-freqs">{freqs.map((f, i) => <Kv key={i} k={f.type} v={<span className="data">{f.mhz.toFixed(3)}</span>} />)}</div>
          </section>
        )}
        <section className="glass pad">
          <div className="between"><h3 className="h3" style={{ margin: 0 }}>Procedures in your sim</h3>{picked.size > 0 && <span className="faint" style={{ fontSize: 12 }}>yours highlighted</span>}</div>
          {!live ? <p className="muted" style={{ margin: "6px 0 0" }}>Connect your Bridge with the sim running to list {apt.code}'s SIDs, STARs and approaches.</p>
            : P.loading ? <p className="muted" style={{ margin: "6px 0 0" }}>Reading {apt.code} from the simulator…</p>
            : P.err ? <p className="muted" style={{ margin: "6px 0 0" }}>{P.err}</p>
            : P.data ? (<>{group("SIDs", "sid", P.data.departures.map((d) => d.name))}{group("STARs", "star", P.data.arrivals.map((d) => d.name))}{group("Approaches", "app", P.data.approaches.map((d) => d.name))}</>) : null}
        </section>
      </div>
    </div>
  );
}

export function ChartsScreen() {
  const L = useLive();
  const flights = useApp((s) => s.lastFlight);
  const f = L.flight ?? flights;
  const dep = f?.departureIcao ?? L.plan?.origin.icao ?? null;
  const arr = f?.arrivalIcao ?? L.plan?.destination.icao ?? null;
  const [pick, setPick] = useState<string | null>(() => { try { return (JSON.parse(localStorage.getItem("glidepath.chartPick") ?? "null") as { icao?: string } | null)?.icao ?? null; } catch { return null; } });
  const code = pick ?? arr ?? dep ?? null;
  const recent = useMemo<string[]>(() => { try { return JSON.parse(localStorage.getItem("glidepath.layouts") ?? "[]"); } catch { return []; } }, [code]);

  return (
    <>
      <div className="page-head">
        <div><h1 className="title">Charts</h1><p className="muted" style={{ margin: "4px 0 0" }}>{dep || arr ? "Your flight's airports, ready when you are." : "Search an airport, or start a flight and its charts appear here."}</p></div>
        <AirportFind onPick={setPick} />
      </div>
      {(dep || arr || recent.length > 0) && (
        <div className="seg" style={{ marginBottom: 14, alignSelf: "flex-start" }}>
          {dep && <button className={code === dep ? "on" : ""} onClick={() => setPick(dep)}>Departure · {dep}</button>}
          {arr && <button className={code === arr ? "on" : ""} onClick={() => setPick(arr)}>Arrival · {arr}</button>}
          {pick && pick !== dep && pick !== arr && <button className="on">{pick}</button>}
          {recent.filter((c) => c !== dep && c !== arr && c !== pick).slice(0, 3).map((c) => <button key={c} onClick={() => setPick(c)}>{c}</button>)}
        </div>
      )}
      {code ? <ChartLibrary key={code} code={code} dep={dep} arr={arr} /> : <p className="muted">No airport yet.</p>}
    </>
  );
}

/** Find any airport by code, name or city. With the Bridge connected this searches every airport in MSFS's world list. */
function AirportFind({ onPick }: { onPick: (icao: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ code: string; name: string; city?: string | null; country?: string | null }>>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setHits([]); return; }
    let off = false;
    const id = window.setTimeout(() => { searchAirports(t).then((r) => { if (!off) setHits(r.slice(0, 8)); }).catch(() => { if (!off) setHits([]); }); }, 160);
    return () => { off = true; clearTimeout(id); };
  }, [q]);
  const go = (c: string) => { onPick(c.toUpperCase()); setQ(""); setHits([]); setOpen(false); };
  return (
    <form className="af" onSubmit={(e) => { e.preventDefault(); const c = q.trim().toUpperCase(); if (hits[0]) go(hits[0].code); else if (/^[A-Z0-9]{3,4}$/.test(c)) go(c); }}>
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} placeholder="Any airport: code, name or city" aria-label="Find an airport" autoComplete="off" spellCheck={false} />
      <button className="btn small primary" disabled={!q.trim()}>Show</button>
      {open && hits.length > 0 && (
        <ul className="af-list" role="listbox">
          {hits.map((h) => <li key={h.code}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.code)}><b>{h.code}</b><span>{h.name}</span><small>{[h.city, h.country].filter(Boolean).join(", ")}</small></button></li>)}
        </ul>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Chart library: every chart for one airport, like a chart app.        */
/* ------------------------------------------------------------------ */
type Entry = { id: string; group: "flight" | "airport" | "arrival" | "approach" | "departure"; tag: string; tone: string; title: string; sub?: string; kind?: "app" | "sid" | "star"; name?: string; view?: "taxi" | "sheet" | "official" };
const GROUPS: Array<[Entry["group"], string]> = [["flight", "Your flight"], ["airport", "Airport"], ["arrival", "Arrivals (STAR)"], ["approach", "Approaches"], ["departure", "Departures (SID)"]];

function ChartLibrary({ code, dep, arr }: { code: string; dep: string | null; arr: string | null }) {
  const live = useApp((s) => s.mode) === "bridge";
  const procs = useProcs(code, live);
  const ss = useSidStar(code);
  const [q, setQ] = useState("");
  const selKey = `glidepath.chartSel.${code}`;
  const fromFlight = useRef(false);
  const [sel, setSel] = useState<string | null>(() => {
    try {
      const pick = JSON.parse(localStorage.getItem("glidepath.chartPick") ?? "null") as { icao?: string; kind?: string; name?: string } | null;
      if (pick?.icao === code && pick.kind && pick.name) { localStorage.removeItem("glidepath.chartPick"); fromFlight.current = true; return `${pick.kind}:${pick.name}`; }
      return localStorage.getItem(selKey) ?? "taxi";
    } catch { return "taxi"; }
  });
  const [listOpen, setListOpen] = useState(() => !fromFlight.current); // phones: the list, or the chart
  useEffect(() => { try { if (sel) localStorage.setItem(selKey, sel); } catch { /* private */ } }, [sel, selKey]);
  const [trans, setTrans] = useState<string | null>(null);
  useEffect(() => { setTrans(null); }, [sel]);

  const entries = useMemo(() => {
    const e: Entry[] = [
      { id: "taxi", group: "airport", tag: "TAXI", tone: "taxi", title: "Airport diagram", sub: "Runways, taxiways, holds, gates", view: "taxi" },
      { id: "sheet", group: "airport", tag: "INFO", tone: "info", title: "Airport information", sub: "Runways, frequencies, map", view: "sheet" },
    ];
    if (isUS(code)) e.push({ id: "official", group: "airport", tag: "FAA", tone: "info", title: "Official FAA charts", sub: "Free, from the FAA", view: "official" });
    else e.push({ id: "official", group: "airport", tag: "LINK", tone: "info", title: "Official charts", sub: "ChartFox, Navigraph, national AIP", view: "official" });
    const stars = ss.data?.filter((p) => p.kind === "star") ?? procs.data?.arrivals.map((p) => ({ name: p.name, runways: p.runways.map((r) => ({ runway: r })) })) ?? [];
    const sids = ss.data?.filter((p) => p.kind === "sid") ?? procs.data?.departures.map((p) => ({ name: p.name, runways: p.runways.map((r) => ({ runway: r })) })) ?? [];
    const rw = (l: Array<{ runway: string }>) => { const r = [...new Set(l.map((x) => x.runway).filter(Boolean))]; return r.length ? `Runway${r.length > 1 ? "s" : ""} ${r.join(", ")}` : "All runways"; };
    for (const p of stars) e.push({ id: `star:${p.name}`, group: "arrival", tag: "STAR", tone: "star", title: p.name, sub: rw(p.runways), kind: "star", name: p.name });
    for (const a of procs.data?.approaches ?? []) e.push({ id: `app:${a.name}`, group: "approach", tag: appTag(a.name), tone: "app", title: a.name, sub: a.runway ? `Runway ${a.runway}${a.transitions.length ? ` · ${a.transitions.length} transition${a.transitions.length > 1 ? "s" : ""}` : ""}` : undefined, kind: "app", name: a.name });
    for (const p of sids) e.push({ id: `sid:${p.name}`, group: "departure", tag: "SID", tone: "sid", title: p.name, sub: rw(p.runways), kind: "sid", name: p.name });
    // Pinned: the procedures picked for this flight
    const ch = loadChoice(dep, arr);
    const mine = code === dep ? [ch.sid && `sid:${ch.sid}`] : code === arr ? [ch.star && `star:${ch.star}`, ch.approach && `app:${ch.approach}`] : [];
    for (const id of mine.filter(Boolean) as string[]) { const x = e.find((y) => y.id === id); if (x) e.unshift({ ...x, id: `pin:${x.id}`, group: "flight" }); }
    return e;
  }, [code, dep, arr, procs.data, ss.data]);

  const shown = useMemo(() => { const t = q.trim().toUpperCase(); return t ? entries.filter((x) => `${x.title} ${x.sub ?? ""} ${x.tag}`.toUpperCase().includes(t)) : entries; }, [entries, q]);
  const cur = entries.find((x) => x.id === sel || x.id === `pin:${sel}`) ?? entries.find((x) => x.id === sel?.replace(/^pin:/, "")) ?? entries[0]!;
  const realId = cur.id.replace(/^pin:/, "");
  const counts = { arrival: entries.filter((x) => x.group === "arrival").length, approach: entries.filter((x) => x.group === "approach").length, departure: entries.filter((x) => x.group === "departure").length };
  const transFor = cur.kind === "app" ? procs.data?.approaches.find((a) => a.name === cur.name)?.transitions ?? [] : cur.kind ? ss.data?.find((p) => p.name === cur.name)?.runways.map((r) => r.runway) ?? [] : [];
  const reading = live && (procs.loading || (!ss.data && !ss.err));
  const idx = shown.findIndex((x) => x.id.replace(/^pin:/, "") === realId);
  const step = (d: number) => { const n = shown.filter((x) => x.group !== "flight"); const i = n.findIndex((x) => x.id === realId); const nx = n[(i + d + n.length) % n.length]; if (nx) setSel(nx.id); };

  return (
    <div className={`clib${listOpen ? " list-open" : " chart-open"}`}>
      <aside className="clib-list glass" aria-label={`Charts for ${code}`}>
        <div className="clib-search"><input className="pc-plain" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${code} charts`} aria-label="Filter charts" spellCheck={false} /></div>
        <p className="clib-count">{plural(counts.approach, "approach", "approaches")} · {plural(counts.arrival, "STAR", "STARs")} · {plural(counts.departure, "SID", "SIDs")}{reading ? " · reading from the sim…" : ""}</p>
        {!live && entries.length <= 3 && <p className="clib-hint">Connect your Bridge with the sim running to list every SID, STAR and approach. Airports you've opened before stay here.</p>}
        {ss.err && procs.err && live && <p className="clib-hint">{procs.err} <button className="linkish" onClick={() => { procs.retry(); ss.retry(); }}>Try again</button></p>}
        <div className="clib-groups">
          {GROUPS.map(([g, label]) => {
            const list = shown.filter((x) => x.group === g); if (!list.length) return null;
            return (
              <section key={g} className={`clib-g g-${g}`}>
                <h4>{label} <small>{list.length}</small></h4>
                {list.map((x) => (
                  <button key={x.id} className={`clib-row${x.id.replace(/^pin:/, "") === realId ? " on" : ""}`} onClick={() => { setSel(x.id.replace(/^pin:/, "")); setListOpen(false); }}>
                    <span className={`clib-tag t-${x.tone}`}>{x.tag}</span>
                    <span className="clib-t"><b>{x.title}</b>{x.sub && <small>{x.sub}</small>}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </aside>
      <section className="clib-view">
        <div className="clib-bar">
          <button className="btn small clib-back" onClick={() => setListOpen(true)}>‹ All charts</button>
          <span className={`clib-tag t-${cur.tone}`}>{cur.tag}</span>
          <b className="clib-title">{cur.title}</b>
          <span className="clib-nav">
            <button className="btn small" onClick={() => step(-1)} aria-label="Previous chart" disabled={idx < 0 && shown.length < 2}>‹</button>
            <button className="btn small" onClick={() => step(1)} aria-label="Next chart">›</button>
          </span>
        </div>
        {cur.kind && transFor.length > 1 && (
          <div className="clib-trans" role="tablist" aria-label={cur.kind === "app" ? "Transition" : "Runway"}>
            <span>{cur.kind === "app" ? "Transition" : "Runway"}</span>
            <button className={!trans ? "on" : ""} onClick={() => setTrans(null)}>All</button>
            {transFor.map((t) => <button key={t} className={trans === t ? "on" : ""} onClick={() => setTrans(t)}>{t}</button>)}
          </div>
        )}
        <div className="clib-body">
          {cur.view === "taxi" ? <div className="glass pad tc-wrap"><TaxiChart icao={code} /></div>
            : cur.view === "sheet" ? <AirportSheet code={code} dep={dep} />
            : cur.view === "official" ? <div className="glass pad"><ChartsFor icao={code} /></div>
            : cur.kind && cur.name ? <ZoomBox key={cur.id + (trans ?? "")}><ProcChart icao={code} kind={cur.kind} name={cur.name} trans={trans} /></ZoomBox> : null}
        </div>
      </section>
    </div>
  );
}

/** Chart list tag for an approach: ILS, RNAV, VOR, NDB, LOC… */
function appTag(n: string): string { const m = /^(ILS|LOC|RNAV|RNP|GPS|VOR|NDB|LDA|SDF|TACAN|IGS|GLS|VISUAL)/i.exec(n.trim()); return (m?.[1] ?? "APP").toUpperCase(); }

/** Pinch, scroll or drag to look closely at a chart; double-tap to fit. */
function ZoomBox({ children }: { children: React.ReactNode }) {
  const [z, setZ] = useState({ k: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  const clampZ = (v: { k: number; x: number; y: number }) => { const k = Math.min(4, Math.max(1, v.k)); if (k === 1) return { k, x: 0, y: 0 }; const el = box.current; const w = el?.clientWidth ?? 0, h = el?.clientHeight ?? 0; return { k, x: Math.min(0, Math.max(w - w * k, v.x)), y: Math.min(0, Math.max(h - h * k, v.y)) }; };
  const zoomAt = (f: number, cx: number, cy: number) => setZ((v) => { const k = Math.min(4, Math.max(1, v.k * f)); const r = k / v.k; return clampZ({ k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }); });
  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey && z.k === 1) return; e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel);
  });
  const skip = (t: EventTarget) => (t as HTMLElement).closest?.("input,button,a,select,textarea");
  return (
    <div className={`zbox${z.k > 1 ? " zoomed" : ""}`} ref={box}
      onPointerDown={(e) => { if (skip(e.target)) return; pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (z.k > 1 || pts.current.size > 1) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const now = performance.now(); if (now - lastTap.current < 300 && pts.current.size === 1) { const r = box.current!.getBoundingClientRect(); if (z.k > 1) setZ({ k: 1, x: 0, y: 0 }); else zoomAt(2.2, e.clientX - r.left, e.clientY - r.top); } lastTap.current = now; }}
      onPointerMove={(e) => { const p = pts.current.get(e.pointerId); if (!p) return; const r = box.current!.getBoundingClientRect();
        if (pts.current.size === 2) { const o = [...pts.current.entries()].find(([id]) => id !== e.pointerId)![1]; const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y); if (d0 > 0) zoomAt(d1 / d0, (e.clientX + o.x) / 2 - r.left, (e.clientY + o.y) / 2 - r.top); }
        else if (z.k > 1) setZ((v) => clampZ({ ...v, x: v.x + e.clientX - p.x, y: v.y + e.clientY - p.y }));
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerUp={(e) => pts.current.delete(e.pointerId)} onPointerCancel={(e) => pts.current.delete(e.pointerId)}>
      <div className="zbox-in" style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.k})` }}>{children}</div>
      <div className="zbox-tools">
        <button className="btn small" onClick={() => { const el = box.current!; zoomAt(1.5, el.clientWidth / 2, el.clientHeight / 3); }} aria-label="Zoom in">+</button>
        <button className="btn small" onClick={() => { const el = box.current!; zoomAt(1 / 1.5, el.clientWidth / 2, el.clientHeight / 3); }} aria-label="Zoom out">−</button>
        {z.k > 1 && <button className="btn small" onClick={() => setZ({ k: 1, x: 0, y: 0 })}>Fit</button>}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
