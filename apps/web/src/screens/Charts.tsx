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
import { Notice } from "../components/ui";

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
        {isUS(code) && <a className="btn small" href={`https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/search/results/?cycle=&ident=${code}`} target="_blank" rel="noreferrer">FAA website</a>}
      </div>
      {!isUS(code) && <p className="muted ch-note">Official charts outside the US aren't available to apps for free. ChartFox has them for most countries (free, sign in with VATSIM); Navigraph needs your Ultimate subscription.</p>}
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
              <iframe key={open.url} src={frameUrl(open, data.cycle, bridge)} title={open.name} />
            </>) : <p className="muted" style={{ padding: 20 }}>Pick a chart.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChartsScreen() {
  const L = useLive();
  const flights = useApp((s) => s.lastFlight);
  const f = L.flight ?? flights;
  const dep = f?.departureIcao ?? L.plan?.origin.icao ?? null;
  const arr = f?.arrivalIcao ?? L.plan?.destination.icao ?? null;
  const [pick, setPick] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const code = pick ?? arr ?? dep ?? null;

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
      {code ? <section className="glass pad"><ChartsFor icao={code} /></section> : <p className="muted">No airport yet.</p>}
    </>
  );
}
