/**
 * Your whole plan at a glance: departure runway and SID, every waypoint with
 * its airway, STAR and arrival runway, plus the numbers you brief. Also the
 * SimBrief import, so you never need Settings to load a plan.
 */
import { FlightSetup, type RunwayLine } from "./FlightSetup";
import { useId, useMemo, useState } from "react";
import type { FlightPlan, TelemetryFrame } from "@glidepath/protocol";
import { distanceNm, routeProgress } from "@glidepath/flight-engine";
import { MapView } from "./MapView";
import { DirectNote } from "./FlightPlanCard";
import { loadChoice } from "./Procedures";
import { fmt, fuel } from "../data/derive";
import { isThin, loadLatestPlan } from "../data/plan";
import { settingsStore, useApp, useSettings } from "../data/store";
import { Icon } from "./ui";

const fl = (ft: number | null | undefined) => (ft == null ? "—" : ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${fmt(ft)} ft`);
const hm = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const z = (unix: number | null | undefined) => (unix == null ? "—" : `${new Date(unix * 1000).toISOString().slice(11, 16)}Z`);
const isTop = (id: string) => /^(TOC|TOD|T\/C|T\/D)$/i.test(id);

/** SimBrief import, inline. */
export function SimbriefImport({ compact }: { compact?: boolean }) {
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const can = mode !== "demo";
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const p = await loadLatestPlan(s.simbriefUser.trim()); setMsg({ ok: true, t: `Loaded ${p.origin.icao} to ${p.destination.icao}${p.callsign ? ` (${p.callsign})` : ""}.` }); }
    catch (e) { setMsg({ ok: false, t: (e as Error).message || "Couldn't load the plan." }); }
    finally { setBusy(false); }
  };
  return (
    <div className={`sb-imp${compact ? " compact" : ""}`}>
      <form className="sb-form" onSubmit={(e) => { e.preventDefault(); if (can && s.simbriefUser.trim() && !busy) void go(); }}>
        <input className="input" aria-label="SimBrief username or Pilot ID" value={s.simbriefUser} onChange={(e) => settingsStore.set({ simbriefUser: e.target.value })} placeholder="SimBrief username or Pilot ID" autoComplete="username" />
        <button className="btn primary" type="submit" disabled={!can || !s.simbriefUser.trim() || busy}>{busy ? "Loading…" : compact ? "Reload" : "Import from SimBrief"}</button>
      </form>
      {!can && <p className="faint sb-note">Stop the demo to load your own plan.</p>}
      {msg && <p className={`sb-note ${msg.ok ? "on-time" : "late"}`} role="status">{msg.t}</p>}
    </div>
  );
}

/** Every waypoint in order: origin and runway, SID, airways, STAR, destination and runway. */
export function RouteChips({ plan, nextIdx = null, onPick }: { plan: FlightPlan; nextIdx?: number | null; onPick?: (i: number) => void }) {
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway, arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null, star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const items = plan.fixes.map((f, i) => ({ f, i })).filter(({ f }) => !isTop(f.ident));
  const kind = (p: FlightPlan["fixes"][number]) => (p.proc === "sid" ? "sid" : p.proc === "star" ? "star" : "en");
  let sidShown = false, starShown = false;
  return (
    <ol className="rt-fixes" aria-label="Every waypoint">
      <li className="rt-fix ap"><b>{plan.origin.icao}{depRwy ? `/${depRwy}` : ""}</b></li>
      {items.map(({ f, i }) => {
        const k = kind(f);
        const head = k === "sid" && !sidShown ? (sidShown = true, <li key={`sid-${i}`} className="rt-proc sid">{sid ?? "SID"}</li>)
          : k === "star" && !starShown ? (starShown = true, <li key={`star-${i}`} className="rt-proc star">{star ?? "STAR"}</li>) : null;
        const cls = `rt-fix ${k}${nextIdx !== null && i < nextIdx ? " passed" : ""}${nextIdx === i ? " next" : ""}`;
        const inner = <>{k === "en" && f.via && f.via !== "DCT" && <span className="rt-via">{f.via}</span>}<b>{f.ident}</b></>;
        return [head, (
          <li key={`${f.ident}-${i}`} className={cls} title={f.altitudeFt != null ? `${f.ident}, planned ${fl(f.altitudeFt)}` : f.ident}>
            {onPick ? <button type="button" onClick={() => onPick(i)}>{inner}</button> : inner}
          </li>
        )];
      })}
      <li className="rt-fix ap"><b>{plan.destination.icao}{arrRwy ? `/${arrRwy}` : ""}</b></li>
    </ol>
  );
}

/** The flight plan panel on the live map. */
export function MapRoutePanel({ plan, nextFix, onPick, onClose, onFit, onLines, onFocus, onFitBox }: { plan: FlightPlan; nextFix: number | null; onPick: (i: number) => void; onClose: () => void; onFit: () => void; onLines?: (l: RunwayLine[]) => void; onFocus?: (lat: number, lon: number, zoom: number) => void; onFitBox?: (box: [number, number, number, number]) => void }) {
  const [tab, setTab] = useState<"setup" | "fixes">(() => { try { return (localStorage.getItem("glidepath.routeTab") as "setup" | "fixes") || "setup"; } catch { return "setup"; } });
  const pick = (t: "setup" | "fixes") => { setTab(t); try { localStorage.setItem("glidepath.routeTab", t); } catch { /* private */ } };
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway, arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null, star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const dist = plan.distanceNm ?? Math.round(distanceNm(plan.origin, plan.destination));
  const n = plan.fixes.filter((f) => !isTop(f.ident)).length;
  return (
    <div className="map-sheet glass strong map-route" role="dialog" aria-label="Flight plan">
      <div className="mr-h">
        <div>
          <span className="rt-k">Flight plan{plan.callsign ? ` · ${plan.callsign}` : ""}</span>
          <b className="mr-t">{plan.origin.icao} <span aria-hidden>→</span> {plan.destination.icao}</b>
        </div>
        <button className="btn small" aria-label="Close" onClick={onClose}><span style={{ width: 16, height: 16 }}>{Icon.close()}</span></button>
      </div>
      <div className="seg mr-tabs" role="tablist" aria-label="Flight plan view">
        <button role="tab" aria-selected={tab === "setup"} className={tab === "setup" ? "on" : ""} onClick={() => pick("setup")}>Runways and procedures</button>
        <button role="tab" aria-selected={tab === "fixes"} className={tab === "fixes" ? "on" : ""} onClick={() => pick("fixes")}>Waypoints</button>
      </div>
      {tab === "setup" ? <FlightSetup plan={plan} onLines={onLines} onFocus={onFocus} onFit={onFitBox} onWaypoints={() => pick("fixes")} /> : (<>
      <div className="mr-ends">
          <span className="rt-tag rwy">RWY {depRwy ?? "—"}</span><span className="rt-tag sid">{sid ?? "No SID"}</span>
          <span className="mr-arrow" aria-hidden>→</span>
          <span className="rt-tag star">{star ?? "No STAR"}</span><span className="rt-tag rwy">RWY {arrRwy ?? "—"}</span>
        </div>
        <p className="mr-sub">{fmt(dist)} nm · {fl(plan.cruiseAltitudeFt)} · {n} waypoints · tap one to go there</p>
        <div className="mr-list"><RouteChips plan={plan} nextIdx={nextFix} onPick={onPick} /></div>
        <DirectNote />
      </>)}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small primary" onClick={onFit}>Show whole route</button>
        <a className="btn small" href="#/flight">Navlog</a>
        <a className="btn small" href="#/performance">Performance</a>
        <a className="btn small" href="#/approach">Landing helper</a>
      </div>
    </div>
  );
}

/**
 * The vertical profile: climb, cruise and descent along the route, with top of climb and top of
 * descent where your plan puts them (or estimated from the cruise level), and where you are now.
 */
export function RouteProfile({ plan, frame, live }: { plan: FlightPlan; frame: TelemetryFrame | null; live: boolean }) {
  const pts = [{ lat: plan.origin.lat, lon: plan.origin.lon, ident: plan.origin.icao }, ...plan.fixes, { lat: plan.destination.lat, lon: plan.destination.lon, ident: plan.destination.icao }];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + distanceNm(pts[i - 1]!, pts[i]!));
  const total = Math.max(1, cum.at(-1)!);
  const cruise = plan.cruiseAltitudeFt ?? Math.max(...plan.fixes.map((f) => f.altitudeFt ?? 0), 10000);
  const find = (re: RegExp) => { const i = plan.fixes.findIndex((f) => re.test(f.ident)); return i >= 0 ? cum[i + 1]! : null; };
  // From the plan when it has them; otherwise roughly 3.5 nm per 1,000 ft up and 3 nm per 1,000 ft down.
  let toc = find(/^(TOC|T\/C)$/i) ?? Math.min(total * 0.45, (cruise / 1000) * 3.5);
  let tod = find(/^(TOD|T\/D)$/i) ?? Math.max(total * 0.55, total - (cruise / 1000) * 3);
  const estimated = find(/^(TOC|T\/C)$/i) === null;
  if (tod <= toc) { const mid = (toc + tod) / 2; toc = mid; tod = mid; }
  const prog = live && frame ? routeProgress(pts, frame.position) : null;
  const at = prog ? Math.max(0, Math.min(total, total - prog.distanceRemainingNm)) : null;
  const W = 600, H = 92, padX = 12, top = 30, base = 68;
  const x = (nm: number) => padX + (nm / total) * (W - padX * 2);
  const yFor = (ft: number) => base - (Math.max(0, ft) / cruise) * (base - top);
  const altNow = frame?.position.altMslFt ?? null;
  const fmtFl = fl(cruise);
  const minTo = (nm: number) => (frame?.speed.gsKt && frame.speed.gsKt > 60 ? Math.round((nm / frame.speed.gsKt) * 60) : null);
  const toTod = at !== null && at < tod ? tod - at : null;
  const toToc = at !== null && at < toc ? toc - at : null;
  const yc = yFor(cruise);
  // Climb rate falls off with height and descent starts gently: curved, like a real profile.
  const path = `M${x(0)},${base} Q${x(toc * 0.42)},${yc + (base - yc) * 0.08} ${x(toc)},${yc} L${x(tod)},${yc} Q${x(tod + (total - tod) * 0.35)},${yc + (base - yc) * 0.05} ${x(total)},${base}`;
  const gid = useId().replace(/:/g, "");
  const fc = (x(toc) / W) * 100, fd = (x(tod) / W) * 100;
  const ticks = plan.fixes.map((f, i) => ({ nm: cum[i + 1]!, proc: f.proc ?? null, top: /^(TOC|TOD|T\/[CD])$/i.test(f.ident) })).filter((t) => !t.top);
  const pill = (cx: number, cy: number, label: string, cls: string) => {
    const w = label.length * 7.4 + 14;
    return <g className={`rp-pill ${cls}`}><rect x={cx - w / 2} y={cy - 9} width={w} height={18} rx={9} /><text x={cx} y={cy + 4} textAnchor="middle">{label}</text></g>;
  };
  return (
    <div className="rp">
      <svg className="rp-svg" viewBox={`0 -4 ${W} ${H + 4}`} role="img" aria-label={`Climb to ${fmtFl} by ${Math.round(toc)} nm, start down ${Math.round(total - tod)} nm before ${plan.destination.icao}`}>
        <defs>
          <linearGradient id={`${gid}s`} x1="0" x2="1" y1="0" y2="0">
            <stop offset={`${fc * 0.6}%`} stopColor="#3CE0FF" /><stop offset={`${fc}%`} stopColor="#64A8FF" />
            <stop offset={`${fd}%`} stopColor="#64A8FF" /><stop offset={`${fd + (100 - fd) * 0.4}%`} stopColor="#FFB340" />
          </linearGradient>
          <linearGradient id={`${gid}t`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity=".8" /></linearGradient>
          <linearGradient id={`${gid}f`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#64A8FF" stopOpacity=".32" /><stop offset="100%" stopColor="#64A8FF" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={`${path} L${x(0)},${base} Z`} fill={`url(#${gid}f)`} className="rp-area2" />
        <line x1={x(0)} x2={x(total)} y1={base} y2={base} className="rp-ground" />
        {ticks.map((t, i) => <line key={i} x1={x(t.nm)} x2={x(t.nm)} y1={base - 3} y2={base + 3} className={`rp-tick${t.proc ? ` ${t.proc}` : ""}`} />)}
        {at !== null && <path d={path} className="rp-flown" style={{ clipPath: `inset(0 ${100 - (x(at) / W) * 100}% 0 0)` }} />}
        <path d={path} className="rp-line2" stroke={`url(#${gid}s)`} pathLength={1} />
        {at !== null && <path d={path} className="rp-ahead" pathLength={1} style={{ clipPath: `inset(0 0 0 ${(x(at) / W) * 100}%)` }} />}
        {[["TOC", toc, "rp-c"], ["TOD", tod, "rp-d"]].map(([k, nm, c]) => (
          <g key={k as string} className={c as string}>
            <line x1={x(nm as number)} x2={x(nm as number)} y1={yc + 5} y2={base} className="rp-drop" />
            <circle cx={x(nm as number)} cy={yc} r={4} />
            {pill(x(nm as number), yc - 16, k as string, "k")}
          </g>
        ))}
        {pill((x(toc) + x(tod)) / 2, yc - 16, fmtFl, "fl")}
        <text x={x(0)} y={base + 17} className="rp-ap">{plan.origin.icao}</text>
        <text x={x(total)} y={base + 17} textAnchor="end" className="rp-ap">{plan.destination.icao}</text>
        {[[0, toc, "climb"], [toc, tod, "cruise"], [tod, total, "descent"]].map(([a, b, w]) => {
          // Fit each segment's label between the airport codes; shorten it, or leave it out, when there's no room.
          const lo = Math.max(x(a as number), x(0) + 44), hi = Math.min(x(b as number), x(total) - 44);
          const full = `${Math.round((b as number) - (a as number))} nm ${w}`, short = `${Math.round((b as number) - (a as number))} nm`;
          const t = hi - lo > full.length * 6.6 + 8 ? full : hi - lo > short.length * 6.6 + 6 ? short : null;
          return t ? <text key={w as string} x={(lo + hi) / 2} y={base + 17} textAnchor="middle" className="rp-nm">{t}</text> : null;
        })}
        {at !== null && (() => {
          // Your aircraft at its real height on the profile, nose tilted with the climb or descent.
          const onGround = !!frame?.position.onGround;
          const tilt = onGround ? 0 : Math.max(-24, Math.min(24, -(frame?.speed.vsFpm ?? 0) / 110));
          const lbl = altNow === null ? null : onGround ? "On ground" : altNow >= 18000 ? fl(altNow) : `${(Math.round(altNow / 100) * 100).toLocaleString()} ft`;
          const below = (altNow !== null ? yFor(altNow) : base) < yc + 14;
          return (
            <g className="rp-me" style={{ transform: `translate(${x(at)}px, ${altNow !== null ? Math.min(base - 4, yFor(altNow)) : base}px)` }}>
              <circle r={11} className="rp-halo" />
              <g className="rp-bob"><g transform={`rotate(${tilt})`}><line x1={-70} x2={-16} y1={0} y2={0} className="rp-trail" stroke={`url(#${gid}t)`} /></g><g transform={`rotate(${tilt}) scale(1.5)`}>
                <path className="rp-plane" d="M-13,-1.6 L7,-1.6 Q12.5,-1.6 13.5,0 Q12.5,1.6 7,1.6 L-11,1.6 Z M-11.5,-1.6 L-14.5,-7.5 L-11,-7.5 L-6.5,-1.6 Z M-2.5,0.6 L-7.5,5.6 L-4.5,5.6 L3,0.6 Z" />
              </g></g>
              {lbl && <g className="rp-alt" transform={`translate(0, ${below ? 22 : -20})`}><rect x={-(lbl.length * 3.6 + 8)} y={-9} width={lbl.length * 7.2 + 16} height={18} rx={9} /><text textAnchor="middle" y={4}>{lbl}</text></g>}
            </g>
          );
        })()}
      </svg>
      <div className="rp-facts">
        <span><i className="rp-sw c" />Top of climb <b>{Math.round(toc)} nm</b> after departure{toToc !== null ? <> · in <b>{Math.round(toToc)} nm</b>{minTo(toToc) !== null ? ` (${minTo(toToc)} min)` : ""}</> : ""}</span>
        <span><i className="rp-sw d" />Top of descent <b>{Math.round(total - tod)} nm</b> before {plan.destination.icao}{toTod !== null ? <> · in <b>{Math.round(toTod)} nm</b>{minTo(toTod) !== null ? ` (${minTo(toTod)} min)` : ""}</> : at !== null && at >= tod ? " · descending" : ""}</span>
        {estimated && <span className="faint">Estimated from the cruise level: this plan doesn't mark TOC and TOD.</span>}
      </div>
    </div>
  );
}

export function RouteOverview({ plan, frame, live }: { plan: FlightPlan; frame: TelemetryFrame | null; live: boolean }) {
  const { fuelUnit } = useSettings();
  const ch = loadChoice(plan.origin.icao, plan.destination.icao);
  const depRwy = ch.depRunway ?? plan.origin.runway;
  const arrRwy = ch.arrRunway ?? plan.destination.runway;
  const sid = ch.sid === "" ? null : ch.sid ?? plan.sid ?? null;
  const star = ch.star === "" ? null : ch.star ?? plan.star ?? null;
  const fixes = plan.fixes.filter((f) => !isTop(f.ident));
  const route = useMemo(() => [{ lat: plan.origin.lat, lon: plan.origin.lon }, ...plan.fixes, { lat: plan.destination.lat, lon: plan.destination.lon }], [plan]);
  const prog = live && frame && !frame.position.onGround ? routeProgress(route, frame.position) : null;
  const nextIdent = prog ? (prog.legIndex < plan.fixes.length ? plan.fixes[prog.legIndex]!.ident : null) : null;
  const passed = new Set(prog ? plan.fixes.slice(0, prog.legIndex).map((f) => f.ident + f.lat) : []);
  const sidFix = fixes.filter((f) => f.proc === "sid");
  const starFix = fixes.filter((f) => f.proc === "star");
  const enroute = fixes.filter((f) => f.proc !== "sid" && f.proc !== "star");
  const firstEn = enroute[0]?.ident, lastEn = enroute.at(-1)?.ident;
  const dist = plan.distanceNm ?? Math.round(distanceNm(plan.origin, plan.destination));
  const center = { lat: (plan.origin.lat + plan.destination.lat) / 2, lon: (plan.origin.lon + plan.destination.lon) / 2 };
  const zoom = Math.max(3, Math.min(8.5, 8.6 - Math.log2(Math.max(20, dist) / 25)));
  const aircraft = frame && frame.attitude.headingTrueDeg !== null ? { lat: frame.position.lat, lon: frame.position.lon, hdg: frame.attitude.headingTrueDeg, alt: frame.position.altMslFt } : null;

  const chip = (f: FlightPlan["fixes"][number], i: number, kind: "sid" | "star" | "en") => {
    const k = f.ident + f.lat;
    return (
      <li key={`${k}-${i}`} className={`rt-fix ${kind}${passed.has(k) ? " passed" : ""}${nextIdent === f.ident ? " next" : ""}`} title={f.altitudeFt != null ? `${f.ident}, planned ${fl(f.altitudeFt)}` : f.ident}>
        {kind === "en" && f.via && f.via !== "DCT" && <span className="rt-via">{f.via}</span>}
        <b>{f.ident}</b>
      </li>
    );
  };

  return (
    <section className="glass rt">
      <div className="rt-h">
        <div>
          <span className="rt-k">{plan.source === "msfs" ? "Plan from the sim" : "SimBrief plan"}{plan.callsign ? ` · ${plan.callsign}` : ""}{plan.aircraftIcao ? ` · ${plan.aircraftIcao}` : ""}{plan.registration ? ` ${plan.registration}` : ""}</span>
          <h2 className="rt-title">{plan.origin.icao} <span aria-hidden>→</span> {plan.destination.icao}</h2>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn small" href="#/performance">Performance</a>
          <a className="btn small" href="#/flight">Navlog</a>
          <a className="btn small" href="#/map">Map</a>
        </div>
      </div>

      <div className="rt-ends">
        <div className="rt-end">
          <span className="rt-k">Departure</span>
          <b className="rt-ap">{plan.origin.icao}</b>
          <span className="rt-name">{plan.origin.name}</span>
          <div className="rt-tags">
            <span className="rt-tag rwy">RWY {depRwy ?? "—"}</span>
            <span className="rt-tag sid">{sid ?? "No SID"}</span>
            {sid && firstEn && <span className="rt-tag dim">to {firstEn}</span>}
          </div>
        </div>
        <div className="rt-mid" aria-hidden>
          <span className="rt-mid-big">{fmt(dist)}<small>nm</small></span>
          <span className="rt-mid-v">{fl(plan.cruiseAltitudeFt)}{plan.airTimeS ? ` · ${hm(plan.airTimeS)} air` : ""}</span>
        </div>
        <div className="rt-end right">
          <span className="rt-k">Arrival</span>
          <b className="rt-ap">{plan.destination.icao}</b>
          <span className="rt-name">{plan.destination.name}</span>
          <div className="rt-tags">
            {star && lastEn && <span className="rt-tag dim">from {lastEn}</span>}
            <span className="rt-tag star">{star ?? "No STAR"}</span>
            <span className="rt-tag rwy">RWY {arrRwy ?? "—"}</span>
          </div>
        </div>
      </div>

      <RouteProfile plan={plan} frame={frame} live={live} />
      {isThin(plan) && <p className="rt-thin">{plan.source === "simbrief"
        ? "This SimBrief plan has no waypoints, so it's drawn as a straight line. If you filed the route as DCT, add a route in SimBrief, generate the plan again and press Reload."
        : "The sim only knows the departure and arrival (the route is in your aircraft's MCDU). Import the same plan from SimBrief below to see every waypoint."}</p>}
      <RouteChips plan={plan} nextIdx={prog ? prog.legIndex : null} />
      {live && <DirectNote />}

      <div className="rt-body">
        <div className="rt-map">
          <MapView trail={[]} plan={plan} aircraft={aircraft} follow={false} interactive={false} center={[center.lon, center.lat]} zoom={zoom} />
        </div>
        <dl className="rt-stats">
          <div><dt>Distance</dt><dd>{fmt(dist)} nm</dd></div>
          <div><dt>Cruise</dt><dd>{fl(plan.cruiseAltitudeFt)}</dd></div>
          <div><dt>Block</dt><dd>{hm(plan.blockTimeS)}</dd></div>
          <div><dt>Air time</dt><dd>{hm(plan.airTimeS)}</dd></div>
          <div><dt>Out / in</dt><dd>{z(plan.scheduledOut)} / {z(plan.scheduledIn)}</dd></div>
          <div><dt>Alternate</dt><dd>{plan.alternate ?? "—"}</dd></div>
          <div><dt>Block fuel</dt><dd>{fuel(plan.fuelRampKg, fuelUnit)}</dd></div>
          <div><dt>Trip burn</dt><dd>{fuel(plan.fuelBurnKg, fuelUnit)}</dd></div>
          {plan.towKg != null && <div><dt>Takeoff wt</dt><dd>{fuel(plan.towKg, fuelUnit)}</dd></div>}
          {plan.ldwKg != null && <div><dt>Landing wt</dt><dd>{fuel(plan.ldwKg, fuelUnit)}</dd></div>}
          {plan.costIndex != null && <div><dt>Cost index</dt><dd>{plan.costIndex}</dd></div>}
          {plan.paxCount != null && <div><dt>Passengers</dt><dd>{fmt(plan.paxCount)}</dd></div>}
        </dl>
      </div>
      <details className="rt-raw"><summary>ATC route</summary><p className="data">{plan.route || "No route string in this plan."}</p></details>
      {(plan.source === "simbrief" || isThin(plan)) && <SimbriefImport compact={!isThin(plan)} />}
    </section>
  );
}
