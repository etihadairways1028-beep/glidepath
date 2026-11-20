import { useEffect, useState } from "react";
import type { PilotDetails } from "@glidepath/protocol";
import { Icon } from "./ui";
import { fmt } from "../data/derive";
import { NETWORK_LABEL, type NetworkPilot } from "../data/external";
import { getPilotDetails } from "../data/networks";
import { nm, trackOf } from "../data/trafficTracks";
import { aircraftName, airlineOf, wakeName } from "../data/aviation";
import { toggleFav, useFavs } from "./TrafficPanel";

interface Place { code?: string; name?: string; city?: string; lat: number; lon: number }
export interface TrafficInfo { dep: Place | null; arr: Place | null; toGo: number | null; total: number | null; etaMin: number | null; sinceMs: number | null; climbing: number; hasBefore: boolean; hasAhead: boolean }

const level = (ft: number) => (ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${fmt(ft)} ft`);
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min} min`);
const zulu = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
const hhmm = (s: string) => `${s.slice(0, 2)}:${s.slice(2)}Z`;

/** Vertical speed from the positions seen so far (the networks don't send it). */
function vsFpm(p: NetworkPilot): number | null {
  const pts = trackOf(p).pts;
  if (pts.length < 2) return null;
  const b = pts.at(-1)!;
  const a = [...pts].reverse().find((q) => b[3] - q[3] >= 20_000);
  if (!a) return null;
  return Math.round(((b[2] - a[2]) / ((b[3] - a[3]) / 60_000)) / 50) * 50;
}

export function TrafficSheet({ p, info, me, onClose }: { p: NetworkPilot; info: TrafficInfo; me: { lat: number; lon: number } | null; onClose: () => void }) {
  const [d, setD] = useState<PilotDetails | null | undefined>(undefined);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setD(undefined); setErr(false);
    const load = () => getPilotDetails(p).then((x) => { if (live) { setD(x); setErr(false); } }).catch(() => { if (live) setErr(true); });
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [p.network, p.callsign]);

  const favs = useFavs();
  const fav = favs.includes(p.callsign.toUpperCase());
  const airline = airlineOf(p.callsign, d?.operator);
  const type = d?.type ?? p.type;
  const typeName = aircraftName(type, d?.model);
  const vs = vsFpm(p);
  const ground = d?.onGround ?? (p.gsKt < 50 && vs !== null && Math.abs(vs) < 100);
  const phase = ground ? "On the ground" : vs !== null && vs > 300 ? "Climbing" : vs !== null && vs < -300 ? "Descending" : p.altFt > 10000 ? "Cruising" : "In flight";
  const pct = info.total && info.toGo !== null ? Math.max(0, Math.min(1, 1 - info.toGo / info.total)) : null;
  const eta = info.etaMin !== null ? new Date(Date.now() + info.etaMin * 60_000) : null;
  const fromMe = me ? nm(me, p) : null;
  const online = d?.onlineSince ? Math.max(0, Math.round((Date.now() - Date.parse(d.onlineSince)) / 60_000)) : null;
  const reg = d?.registration ?? null;

  return (
    <div className="map-sheet glass strong pad traffic-sheet" role="dialog" aria-label={`${p.callsign} details`}>
      <div className="ts-hero">
      <div className="ts-kicker">{p.network === "sim" ? "Sim AI aircraft" : "Flight"}</div>
      <div className="ts-head">
        <span className="ts-logo" aria-hidden="true">{(airline?.code ?? p.callsign).slice(0, 3)}</span>
        <div className="ts-id">
          <b className="data">{p.callsign}</b>
          <span className="muted">{airline?.name ?? NETWORK_LABEL[p.network]}</span>
        </div>
        <button className={`btn small round ts-star${fav ? " on" : ""}`} aria-pressed={fav} aria-label={fav ? `Stop following ${p.callsign}` : `Follow ${p.callsign}`} title={fav ? "Following" : "Follow this pilot"} onClick={() => toggleFav(p.callsign)}>{fav ? "★" : "☆"}</button>
        <button className="btn small round" aria-label="Close" onClick={onClose}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button>
      </div>
      <div className="ts-type">{typeName ? `${typeName}${type ? ` (${type})` : ""}` : type ?? "Unknown type"}{reg ? ` · ${reg}` : ""}</div>
      <div className="ts-chips">
        <span className={`ts-chip net-${p.network}`}>{NETWORK_LABEL[p.network]}</span>
        {d?.rules && <span className="ts-chip">{d.rules}</span>}
        <span className={`ts-chip ph-${phase.split(" ")[0]!.toLowerCase()}`}>{d?.state && d.state !== "En Route" ? d.state : phase}</span>
        {wakeName(d?.wake ?? null) && <span className="ts-chip">{wakeName(d!.wake)}</span>}
        {d?.voice && <span className="ts-chip">{d.voice}</span>}
        {p.squawk && ["7500", "7600", "7700"].includes(p.squawk) && <span className="ts-chip emerg">Squawk {p.squawk}</span>}
      </div>

      <div className="ts-route">
        <div><b className="data">{p.dep ?? "—"}</b><small className="faint">{info.dep?.city ?? info.dep?.name ?? ""}</small></div>
        <div className="ts-bar"><span style={{ width: `${pct === null ? 0 : Math.max(3, pct * 100)}%` }} /><i style={{ left: `${pct === null ? 50 : Math.max(3, Math.min(97, pct * 100))}%` }} /></div>
        <div style={{ textAlign: "right" }}><b className="data">{p.arr ?? "—"}</b><small className="faint">{info.arr?.city ?? info.arr?.name ?? ""}</small></div>
      </div>
      <div className="ts-times faint">
        <span>{d?.depTimeZ ? `Departure ${hhmm(d.depTimeZ)} (filed)` : " "}</span>
        <span>{eta ? `Arrives ${zulu(eta)} est.` : ""}</span>
      </div>
      {info.total !== null && info.toGo !== null && <div className="ts-dist faint">{fmt(Math.max(0, info.total - info.toGo))} nm flown · {fmt(info.toGo)} nm to go{fromMe !== null ? ` · ${fmt(fromMe)} nm from you` : ""}</div>}
      </div>

      <div className="ts-sub ts-live">Live data</div>
      <div className="ts-grid">
        <Cell k="Altitude" v={`${level(p.altFt)}${vs !== null && vs > 300 ? " ↑" : vs !== null && vs < -300 ? " ↓" : ""}`} />
        <Cell k="Speed" v={`${fmt(p.gsKt)} kt`} />
        <Cell k="V/S" v={vs === null ? "—" : `${vs > 0 ? "+" : ""}${fmt(vs)} fpm`} />
        <Cell k="Heading" v={`${String(Math.round(p.hdg) % 360).padStart(3, "0")}°`} />
        <Cell k="Squawk" v={d?.squawk ?? (d === undefined ? "…" : "—")} />
        <Cell k="Filed level" v={d?.cruiseLevel ?? (d === undefined ? "…" : "—")} />
        <Cell k="Filed speed" v={d?.cruiseTasKt ? `${d.cruiseTasKt} kt` : d === undefined ? "…" : "—"} />
        <Cell k="Arrives in" v={info.etaMin !== null ? dur(info.etaMin) : "—"} />
      </div>

      {d === undefined && !err && <p className="faint ts-note">Loading the flight plan…</p>}
      {err && <p className="faint ts-note">The flight plan couldn't be loaded right now.</p>}
      {d === null && <p className="faint ts-note">{p.network === "sim" ? "An AI aircraft in your simulator. Position, altitude and speed come from the sim through your Bridge." : `${p.callsign} has no flight plan on ${NETWORK_LABEL[p.network]}.`}</p>}
      {d && (d.route || d.alternate || d.eteMin || d.enduranceMin || d.pob || d.remarks) && (
        <details className="ts-more" open>
          <summary>Flight plan</summary>
          <div className="ts-kv">
            {d.eteMin && <div><span>Planned flight time</span><b>{dur(d.eteMin)}</b></div>}
            {d.enduranceMin && <div><span>Fuel endurance</span><b>{dur(d.enduranceMin)}</b></div>}
            {d.alternate && <div><span>Alternate</span><b className="data">{d.alternate}</b></div>}
            {d.pob && <div><span>People on board</span><b>{d.pob}</b></div>}
            {d.assignedSquawk && <div><span>Assigned squawk</span><b className="data">{d.assignedSquawk}</b></div>}
            {d.qnhHpa && <div><span>Altimeter</span><b className="data">{Math.round(d.qnhHpa)} hPa</b></div>}
          </div>
          {d.route && <><div className="ts-sub">Route</div><p className="data ts-routestr">{d.route}</p></>}
          {d.remarks && <><div className="ts-sub">Remarks</div><p className="data ts-routestr">{d.remarks}</p></>}
        </details>
      )}
      {d && (d.pilotId || d.rating || online !== null || d.server) && (
        <details className="ts-more">
          <summary>Pilot</summary>
          <div className="ts-kv">
            {d.pilotId && <div><span>{p.network === "vatsim" ? "VATSIM ID" : p.network === "ivao" ? "IVAO ID" : "ID"}</span><b className="data">{d.pilotId}</b></div>}
            {d.rating && <div><span>Rating</span><b>{d.rating}</b></div>}
            {online !== null && <div><span>Online for</span><b>{dur(online)}</b></div>}
            {d.server && <div><span>Server</span><b className="data">{d.server}</b></div>}
          </div>
        </details>
      )}

      <div className="ts-legend faint"><span><i className="l-flown" />Flown{info.sinceMs && info.sinceMs > 60_000 ? ` (seen for ${Math.round(info.sinceMs / 60_000)} min)` : ""}</span>{info.hasBefore ? <span><i className="l-before" />From {p.dep}, estimated</span> : null}{info.hasAhead ? <span><i className="l-ahead" />To {p.arr}</span> : null}</div>
      <p className="faint ts-note">Networks share each aircraft's current position only. The flown track is what your Bridge (while it runs) and this device have seen; vertical speed and arrival time are worked out from it.</p>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return <div className="ts-cell"><span>{k}</span><b className="data">{v}</b></div>;
}
