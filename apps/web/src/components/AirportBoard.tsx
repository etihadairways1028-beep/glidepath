/**
 * Airport board: live departures and arrivals on VATSIM or IVAO, from the
 * networks' public data (refreshed every minute), plus the controllers online
 * at the airport. Status comes from each pilot's live position and speed.
 */
import { useMemo, useState } from "react";
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

const hm = (min: number) => { const d = new Date(Date.now() + min * 60_000); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };

export function AirportBoard({ code, lat, lon }: { code: string; lat: number; lon: number }) {
  const [net, setNet] = useState<Network>("vatsim");
  const [tab, setTab] = useState<"dep" | "arr">("dep");
  const live = usePoll(() => getLiveNetwork(net), 60_000, [net]);
  const list = useMemo(() => (live.data ? rows(live.data.pilots, code.toUpperCase(), lat, lon, tab) : []), [live.data, code, tab]);
  const counts = useMemo(() => live.data ? { dep: rows(live.data.pilots, code.toUpperCase(), lat, lon, "dep").length, arr: rows(live.data.pilots, code.toUpperCase(), lat, lon, "arr").length } : null, [live.data, code]);
  const atc = (live.data?.controllers ?? []).filter((c) => c.callsign.toUpperCase().startsWith(`${code.toUpperCase()}_`));

  return (
    <section className="glass board" aria-label="Live airport board">
      <div className="board-head">
        <div>
          <h2 className="h2" style={{ margin: 0 }}>Live board</h2>
          <span className="faint" style={{ fontSize: 12.5 }}>{live.data ? `${NETWORK_LABEL[net]} · updated ${new Date(live.data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : live.error ?? "Loading…"}</span>
        </div>
        <div className="seg" role="group" aria-label="Network">
          {(["vatsim", "ivao"] as Network[]).map((n) => <button key={n} className={net === n ? "on" : ""} onClick={() => setNet(n)}>{NETWORK_LABEL[n]}</button>)}
        </div>
      </div>
      {atc.length > 0 && (
        <div className="board-atc">{atc.map((c) => <span key={c.callsign} className="board-ctl"><b>{c.callsign}</b>{c.frequency ? ` ${c.frequency}` : ""}</span>)}</div>
      )}
      <div className="seg board-tabs" role="tablist">
        <button className={tab === "dep" ? "on" : ""} onClick={() => setTab("dep")}>Departures{counts ? ` (${counts.dep})` : ""}</button>
        <button className={tab === "arr" ? "on" : ""} onClick={() => setTab("arr")}>Arrivals{counts ? ` (${counts.arr})` : ""}</button>
      </div>
      <div className="board-list">
        <div className="board-row hd"><span>Flight</span><span>{tab === "dep" ? "To" : "From"}</span><span>Type</span><span>{tab === "arr" ? "Expected" : "Altitude"}</span><span>Status</span></div>
        {list.slice(0, 40).map((r) => (
          <div key={r.p.callsign} className="board-row">
            <span className="data">{r.p.callsign}</span>
            <span className="data">{r.other ?? "—"}</span>
            <span>{r.p.type ?? "—"}</span>
            <span className="data">{tab === "arr" ? (r.etaMin !== null ? hm(r.etaMin) : "—") : r.tone === "air" ? `${Math.round(r.p.altFt / 100) * 100} ft` : "—"}</span>
            <span><i className={`board-st ${r.tone}`}>{r.status}</i></span>
          </div>
        ))}
        {live.data && list.length === 0 && <p className="faint" style={{ padding: "10px 4px", margin: 0 }}>No {tab === "dep" ? "departures" : "arrivals"} filed on {NETWORK_LABEL[net]} right now.</p>}
      </div>
      <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Expected times are estimates from each pilot's distance and groundspeed, plus 4 minutes.</p>
    </section>
  );
}
