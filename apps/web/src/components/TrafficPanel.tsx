/**
 * "Online now" on the live map: search any callsign or airport, the busiest airports right now,
 * the pilots you've starred, and anyone squawking an emergency (7500, 7600, 7700).
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./ui";
import { NETWORK_LABEL, type NetworkPilot } from "../data/external";
import { searchAirports } from "../data/airports";
import type { Airport } from "@glidepath/aviation-data";
import { airlineOf } from "../data/aviation";

const FAV = "glidepath.favs";
export const readFavs = (): string[] => { try { return JSON.parse(localStorage.getItem(FAV) ?? "[]") as string[]; } catch { return []; } };
export function toggleFav(callsign: string): boolean {
  const cs = callsign.toUpperCase(), list = readFavs();
  const on = !list.includes(cs);
  try { localStorage.setItem(FAV, JSON.stringify(on ? [...list, cs].slice(-50) : list.filter((x) => x !== cs))); } catch { /* storage off */ }
  window.dispatchEvent(new Event("glidepath-favs"));
  return on;
}
export function useFavs(): string[] {
  const [f, setF] = useState(readFavs);
  useEffect(() => { const h = () => setF(readFavs()); window.addEventListener("glidepath-favs", h); window.addEventListener("storage", h); return () => { window.removeEventListener("glidepath-favs", h); window.removeEventListener("storage", h); }; }, []);
  return f;
}
const EMERGENCY: Record<string, string> = { "7500": "Unlawful interference", "7600": "Radio failure", "7700": "Emergency" };

export function TrafficPanel({ traffic, atcCount, onPick, onAirport, onClose }: { traffic: NetworkPilot[]; atcCount: number; onPick: (p: NetworkPilot) => void; onAirport: (a: { code: string; lat: number; lon: number }) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [apts, setApts] = useState<Airport[]>([]);
  const favs = useFavs();
  const qq = q.trim().toUpperCase();
  useEffect(() => {
    if (qq.length < 2) { setApts([]); return; }
    let off = false;
    const t = window.setTimeout(() => void searchAirports(qq).then((r) => { if (!off) setApts(r.slice(0, 5)); }).catch(() => undefined), 200);
    return () => { off = true; clearTimeout(t); };
  }, [qq]);
  const found = useMemo(() => qq.length < 2 ? [] : traffic.filter((p) => p.callsign.toUpperCase().includes(qq) || airlineOf(p.callsign)?.name.toUpperCase().includes(qq)).slice(0, 8), [traffic, qq]);
  const busiest = useMemo(() => {
    const m = new Map<string, { dep: number; arr: number }>();
    for (const p of traffic) {
      if (p.network === "sim") continue;
      if (p.dep) { const e = m.get(p.dep) ?? { dep: 0, arr: 0 }; e.dep++; m.set(p.dep, e); }
      if (p.arr) { const e = m.get(p.arr) ?? { dep: 0, arr: 0 }; e.arr++; m.set(p.arr, e); }
    }
    return [...m.entries()].sort((a, b) => b[1].dep + b[1].arr - (a[1].dep + a[1].arr)).slice(0, 8);
  }, [traffic]);
  const starred = traffic.filter((p) => favs.includes(p.callsign.toUpperCase()));
  const mayday = traffic.filter((p) => p.squawk && EMERGENCY[p.squawk]);
  const nets = useMemo(() => { const c: Record<string, number> = {}; for (const p of traffic) c[p.network] = (c[p.network] ?? 0) + 1; return c; }, [traffic]);
  const goAirport = async (code: string) => { const a = (await searchAirports(code).catch(() => [])).find((x) => x.code === code); if (a) onAirport({ code, lat: a.lat, lon: a.lon }); };
  const Row = ({ p, extra }: { p: NetworkPilot; extra?: string }) => (
    <button className="tp-row" onClick={() => onPick(p)}>
      <b className="data">{p.callsign}</b>
      <span>{[p.type, p.dep && p.arr ? `${p.dep} → ${p.arr}` : null].filter(Boolean).join(" · ") || NETWORK_LABEL[p.network]}</span>
      {extra && <i className="tp-emerg">{extra}</i>}
    </button>
  );
  return (
    <div className="glass strong layers-pop traffic-panel" role="dialog" aria-label="Online now">
      <div className="lp-top"><span>Online now</span><button className="btn small round" aria-label="Close" onClick={onClose}>{Icon.close()}</button></div>
      <input className="tp-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Callsign, airline or airport" aria-label="Search callsign, airline or airport" />
      {qq.length >= 2 ? (
        <div className="tp-list">
          {found.map((p) => <Row key={`${p.network}:${p.callsign}`} p={p} />)}
          {apts.map((a) => <button key={a.code} className="tp-row" onClick={() => onAirport({ code: a.code, lat: a.lat, lon: a.lon })}><b className="data">{a.code}</b><span>{a.name}</span></button>)}
          {!found.length && !apts.length && <p className="faint" style={{ fontSize: 13, margin: "6px 2px" }}>Nothing matches "{q.trim()}" right now.</p>}
        </div>
      ) : (<>
        <div className="tp-stats">
          {Object.entries(nets).map(([n, c]) => <span key={n}><b className="data">{c.toLocaleString()}</b> {NETWORK_LABEL[n as NetworkPilot["network"]]}</span>)}
          {atcCount > 0 && <span><b className="data">{atcCount}</b> controllers</span>}
          {!traffic.length && <span className="faint">Turn on a network in Layers to see traffic.</span>}
        </div>
        {mayday.length > 0 && <><p className="lp-h">Emergencies</p><div className="tp-list">{mayday.map((p) => <Row key={`m${p.network}${p.callsign}`} p={p} extra={`${p.squawk} · ${EMERGENCY[p.squawk!]}`} />)}</div></>}
        {starred.length > 0 && <><p className="lp-h">Your favourites online</p><div className="tp-list">{starred.map((p) => <Row key={`f${p.network}${p.callsign}`} p={p} />)}</div></>}
        {busiest.length > 0 && <><p className="lp-h">Busiest airports</p><div className="tp-busy">{busiest.map(([code, c]) => <button key={code} className="tp-apt" onClick={() => void goAirport(code)}><b className="data">{code}</b><span>{c.dep} dep · {c.arr} arr</span></button>)}</div></>}
        {favs.length > 0 && starred.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>None of your favourites are online.</p>}
        {favs.length === 0 && <p className="faint" style={{ fontSize: 12.5 }}>Tap ★ on any aircraft to follow it here.</p>}
      </>)}
    </div>
  );
}
