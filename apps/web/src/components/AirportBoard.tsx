/**
 * Airport board: live departures and arrivals on VATSIM or IVAO, from the
 * networks' public data (refreshed every minute), plus the controllers online
 * at the airport. Status comes from each pilot's live position and speed.
 */
import { useEffect, useMemo, useState } from "react";
import { activeBridge } from "../data/bridge";
import { airportDetail, type AirportDetail } from "../data/airports";
import { getMetar, type Metar } from "../data/external";
import { distanceNm } from "@glidepath/flight-engine";
import { getLiveNetwork } from "../data/networks";
import { NETWORK_LABEL, usePoll, type Network, type NetworkPilot } from "../data/external";

interface Row { p: NetworkPilot; status: string; tone: "ground" | "air" | "done"; etaMin: number | null; other: string | null; dist: number }

function rows(pilots: NetworkPilot[], code: string, lat: number, lon: number, kind: "dep" | "arr"): Row[] {
  const out: Row[] = [];
  for (const p of pilots) {
    if ((kind === "dep" ? p.dep : p.arr)?.toUpperCase() !== code) continue;
    const dist = distanceNm({ lat, lon }, { lat: p.lat, lon: p.lon });
    const near = dist < 6;
    const ground = p.gsKt < 50;
    let status: string; let tone: Row["tone"]; let etaMin: number | null = null;
    if (kind === "dep") {
      if (near && ground) { status = p.gsKt > 3 ? "Taxiing" : "At the gate"; tone = "ground"; }
      else if (near && !ground) { status = "Departed"; tone = "air"; }
      else { status = ground ? "Not at the airport" : "En route"; tone = ground ? "ground" : "air"; }
    } else {
      if (near && ground) { status = "Landed"; tone = "done"; }
      else if (!ground && p.gsKt > 60) { etaMin = (dist / p.gsKt) * 60 + 4; status = dist < 40 ? "Approaching" : "En route"; tone = "air"; }
      else { status = "Not departed"; tone = "ground"; }
    }
    out.push({ p, status, tone, etaMin, other: kind === "dep" ? p.arr : p.dep, dist });
  }
  return kind === "arr"
    ? out.sort((a, b) => (a.etaMin ?? 1e9) - (b.etaMin ?? 1e9))
    : out.sort((a, b) => ({ ground: 0, air: 1, done: 2 }[a.tone] - { ground: 0, air: 1, done: 2 }[b.tone]) || a.dist - b.dist);
}

/** AI aircraft in the sim at or near the airport. */
function simRows(pilots: NetworkPilot[], lat: number, lon: number): Row[] {
  return pilots.map((p) => ({ p, dist: distanceNm({ lat, lon }, { lat: p.lat, lon: p.lon }) })).filter((x) => x.dist < 30)
    .map(({ p, dist }) => {
      const ground = p.gsKt < 50;
      const status = dist < 4 && ground ? (p.gsKt > 3 ? "Taxiing" : "At the airport") : dist < 8 && !ground ? "On approach or climbing out" : "Nearby";
      return { p, status, tone: (ground ? "ground" : "air") as Row["tone"], etaMin: null, other: null, dist };
    }).sort((a, b) => a.dist - b.dist);
}

const hm = (min: number) => { const d = new Date(Date.now() + min * 60_000); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

/** An ATIS read out from the live METAR, for AI ATC and when no controller is online. */
function atisFrom(m: Metar): string {
  const parts: string[] = [];
  if (m.windKt !== null) parts.push(m.windKt < 3 ? "Wind calm" : `Wind ${m.windDir === "VRB" ? "variable" : String(m.windDir).padStart(3, "0")} at ${m.windKt} knots${m.gustKt ? `, gusting ${m.gustKt}` : ""}`);
  if (m.visibility) parts.push(`Visibility ${/\+|10/.test(m.visibility) ? "10 km or more" : `${m.visibility}${/SM/i.test(m.visibility) ? "" : " statute miles"}`}`);
  const COVER: Record<string, string> = { FEW: "Few", SCT: "Scattered", BKN: "Broken", OVC: "Overcast", OVX: "Sky obscured" };
  const cl = m.clouds.filter((c) => COVER[c.cover]).map((c) => `${COVER[c.cover]}${c.baseFt !== null ? ` ${c.baseFt.toLocaleString("en-US")} ft` : ""}`);
  parts.push(cl.length ? `Cloud ${cl.join(", ")}` : /CAVOK/.test(m.raw) ? "CAVOK" : "No significant cloud");
  if (m.tempC !== null) parts.push(`Temperature ${m.tempC}, dew point ${m.dewC ?? "—"}`);
  if (m.qnhHpa !== null) parts.push(`QNH ${m.qnhHpa}`);
  return parts.join(". ") + ".";
}
const FREQ_ORDER = ["ATIS", "DEL", "CLD", "GND", "TWR", "APP", "DEP", "CTR"];

export function AirportBoard({ code, lat, lon }: { code: string; lat: number; lon: number }) {
  const [net, setNet] = useState<Network>("vatsim");
  const [tab, setTab] = useState<"dep" | "arr">("dep");
  const bridge = !!activeBridge();
  const live = usePoll(() => getLiveNetwork(net), net === "sim" ? 15_000 : 60_000, [net]);
  const list = useMemo(() => (live.data ? net === "sim" ? simRows(live.data.pilots, lat, lon) : rows(live.data.pilots, code.toUpperCase(), lat, lon, tab) : []), [live.data, code, tab, net]);
  const [apt, setApt] = useState<AirportDetail | null>(null);
  useEffect(() => { let off = false; void airportDetail(code).then((a) => { if (!off) setApt(a); }); return () => { off = true; }; }, [code]);
  const metar = usePoll(() => getMetar([code.toUpperCase()]).then((l) => l[0] ?? null), 5 * 60_000, [code]);
  const freqs = (apt?.frequencies ?? []).filter((f) => FREQ_ORDER.some((k) => f.type.toUpperCase().startsWith(k))).sort((a, b) => FREQ_ORDER.findIndex((k) => a.type.toUpperCase().startsWith(k)) - FREQ_ORDER.findIndex((k) => b.type.toUpperCase().startsWith(k))).slice(0, 8);
  const counts = useMemo(() => live.data ? { dep: rows(live.data.pilots, code.toUpperCase(), lat, lon, "dep").length, arr: rows(live.data.pilots, code.toUpperCase(), lat, lon, "arr").length } : null, [live.data, code]);
  const atc = (live.data?.controllers ?? []).filter((c) => c.callsign.toUpperCase().startsWith(`${code.toUpperCase()}_`));

  return (
    <section className="glass ab" aria-label="Live airport board">
      <div className="board-head">
        <div>
          <h2 className="h2" style={{ margin: 0 }}>Live board</h2>
          <span className="faint" style={{ fontSize: 12.5 }}>{live.data ? `${NETWORK_LABEL[net]} · updated ${new Date(live.data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : live.error ?? "Loading…"}</span>
        </div>
        <div className="seg" role="group" aria-label="Network">
          {(["vatsim", "ivao", ...(bridge ? ["sim"] : [])] as Network[]).map((n) => <button key={n} className={net === n ? "on" : ""} onClick={() => setNet(n)}>{n === "sim" ? "Sim AI" : NETWORK_LABEL[n]}</button>)}
        </div>
      </div>
      {atc.length > 0 ? (
        <div className="board-atc">{atc.map((c) => <span key={c.callsign} className="board-ctl"><b>{c.callsign}</b>{c.frequency ? ` ${c.frequency}` : ""}</span>)}</div>
      ) : (freqs.length > 0 || metar.data) && (
        <div className="ab-ai">
          <div className="ab-ai-h"><b>{net === "sim" || net === "sayintentions" ? "AI ATC" : "No controller online"}</b><span className="faint">AI ATC such as SayIntentions uses the airport's real frequencies.</span></div>
          {freqs.length > 0 && <div className="board-atc">{freqs.map((f) => <span key={f.type + f.mhz} className="board-ctl"><b>{f.type.toUpperCase().slice(0, 4)}</b> {f.mhz.toFixed(3)}</span>)}</div>}
          {metar.data && <p className="ab-atis"><b>ATIS</b> <span className="faint">(read from the live METAR{metar.data.observed ? `, ${new Date(metar.data.observed).toISOString().slice(11, 16)}Z` : ""})</span><br />{code.toUpperCase()}. {atisFrom(metar.data)}</p>}
        </div>
      )}
      {net !== "sim" && <div className="seg board-tabs" role="tablist">
        <button className={tab === "dep" ? "on" : ""} onClick={() => setTab("dep")}>Departures{counts ? ` (${counts.dep})` : ""}</button>
        <button className={tab === "arr" ? "on" : ""} onClick={() => setTab("arr")}>Arrivals{counts ? ` (${counts.arr})` : ""}</button>
      </div>}
      <div className="board-list">
        <div className="board-row hd"><span>Flight</span><span>{net === "sim" ? "Distance" : tab === "dep" ? "To" : "From"}</span><span>Type</span><span>{net === "sim" ? "Altitude" : tab === "arr" ? "Expected" : "Altitude"}</span><span>Status</span></div>
        {list.slice(0, 40).map((r) => (
          <div key={r.p.callsign} className="board-row">
            <span className="data">{r.p.callsign}</span>
            <span className="data">{net === "sim" ? `${r.dist.toFixed(1)} nm` : r.other ?? "—"}</span>
            <span>{r.p.type ?? "—"}</span>
            <span className="data">{tab === "arr" ? (r.etaMin !== null ? hm(r.etaMin) : "—") : r.tone === "air" ? `${Math.round(r.p.altFt / 100) * 100} ft` : "—"}</span>
            <span><i className={`board-st ${r.tone}`}>{r.status}</i></span>
          </div>
        ))}
        {live.data && list.length === 0 && <p className="faint" style={{ padding: "10px 12px", margin: 0 }}>{net === "sim" ? "No AI aircraft within 30 nm in your sim right now." : `No ${tab === "dep" ? "departures" : "arrivals"} filed on ${NETWORK_LABEL[net]} right now.`}</p>}
      </div>
      <p className="faint ab-foot">{net === "sim" ? "AI aircraft come from your simulator through the Bridge, every 15 seconds." : "Expected times are estimates from each pilot's distance and groundspeed, plus 4 minutes."}</p>
    </section>
  );
}
