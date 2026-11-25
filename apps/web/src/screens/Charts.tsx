/**
 * Charts: airport diagrams, SIDs, STARs and approaches for your flight's
 * airports, picked automatically from the flight (or the last one you logged).
 *
 * US airports: the FAA's official charts (free, public), listed by your
 * Bridge and opened straight from the FAA. Everywhere else: one tap to
 * ChartFox (free, sign in with VATSIM) or Navigraph Charts (your subscription),
 * because no free worldwide chart service allows other apps to show them.
 */
import { useEffect, useMemo, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { useLive } from "../data/derive";
import { Kv, Notice } from "../components/ui";
import { MapView } from "../components/MapView";
import { RunwayDiagram } from "../components/Imagery";
import { TaxiChart } from "../components/TaxiChart";
import { ProcChart, useSidStar } from "../components/ProcChart";
import { loadChoice, useProcs } from "../components/Procedures";
import { airportDetail, type AirportDetail } from "../data/airports";

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

/** Procedure charts: pick an approach, STAR or SID and see it drawn as a chart. */
function ProcCharts({ code }: { code: string }) {
  const live = useApp((s) => s.mode) === "bridge";
  const procs = useProcs(code, live);
  const ss = useSidStar(code);
  const [sel, setSel] = useState<{ kind: "app" | "sid" | "star"; name: string } | null>(() => { try { const v = JSON.parse(localStorage.getItem("glidepath.chartPick") ?? "null"); if (v?.icao === code) { localStorage.removeItem("glidepath.chartPick"); return { kind: v.kind, name: v.name }; } } catch { /* none */ } return null; });
  const [trans, setTrans] = useState<string | null>(null);
  useEffect(() => { setTrans(null); }, [sel?.name]);
  const apps = procs.data?.approaches ?? [];
  const stars = (ss.data?.filter((p) => p.kind === "star").map((p) => p.name) ?? procs.data?.arrivals.map((p) => p.name) ?? []);
  const sids = (ss.data?.filter((p) => p.kind === "sid").map((p) => p.name) ?? procs.data?.departures.map((p) => p.name) ?? []);
  const transFor = sel?.kind === "app" ? apps.find((a) => a.name === sel.name)?.transitions ?? [] : (ss.data?.find((p) => p.name === sel?.name)?.runways.map((r) => r.runway) ?? []);
  if (!apps.length && !stars.length && !sids.length) return <div className="pc-empty"><p>{procs.loading ? "Reading procedures from the simulator…" : ss.err ?? procs.err ?? "No procedures yet."}</p>{!procs.loading && <button className="btn small" onClick={() => { procs.retry(); ss.retry(); }}>Try again</button>}</div>;
  const group = (label: string, kind: "app" | "sid" | "star", names: string[]) => names.length > 0 && (
    <div className="pcl-g"><span className="pcl-k">{label}</span><div className="pcl-list">{names.map((n) => <button key={n} className={sel?.kind === kind && sel.name === n ? "on" : ""} onClick={() => setSel({ kind, name: n })}>{n}</button>)}</div></div>
  );
  return (
    <div className="pcl">
      {group("Approaches", "app", apps.map((a) => a.name))}
      {group("Arrivals (STAR)", "star", stars)}
      {group("Departures (SID)", "sid", sids)}
      {sel && transFor.length > 1 && <div className="pcl-g"><span className="pcl-k">{sel.kind === "app" ? "Transition" : "Runway"}</span><div className="pcl-list"><button className={!trans ? "on" : ""} onClick={() => setTrans(null)}>All</button>{transFor.map((t) => <button key={t} className={trans === t ? "on" : ""} onClick={() => setTrans(t)}>{t}</button>)}</div></div>}
      {sel ? <ProcChart icao={code} kind={sel.kind} name={sel.name} trans={trans} /> : <p className="muted" style={{ margin: "6px 0 0" }}>Pick a procedure to see its chart.</p>}
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
  const [q, setQ] = useState("");
  const code = pick ?? arr ?? dep ?? null;
  // Official charts first where they're free to show (US, with the Bridge); the airport sheet everywhere else.
  const mode = useApp((s) => s.mode);
  const [view, setView] = useState<"taxi" | "procs" | "sheet" | "official">(() => { try { return localStorage.getItem("glidepath.chartPick") ? "procs" : "taxi"; } catch { return "taxi"; } });
  useEffect(() => { setView((v) => (v === "official" && !(code && isUS(code)) ? "taxi" : v)); }, [code, mode]);

  return (
    <>
      <div className="page-head">
        <div><h1 className="title">Charts</h1><p className="muted" style={{ margin: "4px 0 0" }}>{dep || arr ? "Your flight's airports, ready when you are." : "Search an airport, or start a flight and its charts appear here."}</p></div>
        <form className="wx-add" onSubmit={(e) => { e.preventDefault(); const c = q.trim().toUpperCase(); if (/^[A-Z0-9]{3,4}$/.test(c)) setPick(c); setQ(""); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ICAO, e.g. KJFK" maxLength={4} aria-label="Airport ICAO code" />
          <button className="btn small primary" disabled={!q.trim()}>Show</button>
        </form>
      </div>
      {(dep || arr) && (
        <div className="seg" style={{ marginBottom: 14, alignSelf: "flex-start" }}>
          {dep && <button className={code === dep ? "on" : ""} onClick={() => setPick(dep)}>Departure · {dep}</button>}
          {arr && <button className={code === arr ? "on" : ""} onClick={() => setPick(arr)}>Arrival · {arr}</button>}
          {pick && pick !== dep && pick !== arr && <button className="on">{pick}</button>}
        </div>
      )}
      {code && (
        <div className="seg ch-mode" role="tablist" aria-label="What to show">
          <button className={view === "taxi" ? "on" : ""} onClick={() => setView("taxi")}>Taxi chart</button>
          <button className={view === "procs" ? "on" : ""} onClick={() => setView("procs")}>Procedure charts</button>
          <button className={view === "sheet" ? "on" : ""} onClick={() => setView("sheet")}>Airport sheet</button>
          <button className={view === "official" ? "on" : ""} onClick={() => setView("official")}>Official charts</button>
        </div>
      )}
      {code ? (view === "taxi" ? <section className="glass pad tc-wrap"><TaxiChart icao={code} /></section> : view === "procs" ? <section className="glass pad"><ProcCharts code={code} /></section> : view === "sheet" ? <AirportSheet code={code} dep={dep} /> : <section className="glass pad"><ChartsFor icao={code} /></section>) : <p className="muted">No airport yet.</p>}
    </>
  );
}
