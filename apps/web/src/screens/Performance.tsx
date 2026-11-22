/**
 * Takeoff and landing performance, Fenix EFB style: pick the runway, Glidepath
 * fills in weights from your plan and wind, temperature and QNH from the latest
 * METAR, and works out speeds, flex, trim and distances as you change anything.
 * Runway, SID and STAR picks are saved as your plan for the flight.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PERF_TYPES, landing, perfTypeFor, takeoff, type PerfType, type Surface, runwayWind } from "@glidepath/flight-engine";
import type { Runway } from "@glidepath/aviation-data";
import type { Metar } from "@glidepath/protocol";
import { airportDetail, type AirportDetail } from "../data/airports";
import { getMetar } from "../data/external";
import { useLive } from "../data/derive";
import { useApp, useSettings } from "../data/store";
import { loadChoice, saveChoice, useProcs, type ProcChoice } from "../components/Procedures";

type Tab = "takeoff" | "landing";
const KEY = "glidepath.perf";
const LB = 2.20462, M = 0.3048;

interface Saved { tab?: Tab; unit?: "m" | "ft"; type?: string; to?: Partial<ToState>; ld?: Partial<LdState> }
interface ToState { icao: string; rw: string; shiftFt: number; flap: string; thrust: "flex" | "toga"; derate: 0 | 1 | 2; antiIce: boolean; packsOff: boolean; cg: number; surface: Surface | "auto"; tow: number | null; wind: string; oat: string; qnh: string }
interface LdState { icao: string; rw: string; flap: string; autobrake: string; reversers: boolean; antiIce: boolean; surface: Surface | "auto"; ldw: number | null; wind: string; oat: string; qnh: string }

function readSaved(): Saved { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved; } catch { return {}; } }
function writeSaved(s: Saved) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

interface End { ident: string; hdg: number; lengthFt: number; ldaFt: number; widthFt: number | null; surface: string }
function endsOf(rws: Runway[]): End[] {
  const out: End[] = [];
  for (const r of rws) {
    if (!r.lengthFt || r.lengthFt < 1500) continue;
    for (const e of r.ends) out.push({ ident: e.ident, hdg: e.headingTrueDeg, lengthFt: r.lengthFt, ldaFt: r.lengthFt - (e.displacedFt || 0), widthFt: r.widthFt, surface: r.surface });
  }
  return out.sort((a, b) => a.ident.localeCompare(b.ident, undefined, { numeric: true }));
}

/** "250/12G20", "250@12", "VRB/03" → direction, speed, gust. */
function parseWind(s: string): { dirDeg: number | null; kt: number; gustKt: number | null } | null {
  const m = /^\s*(VRB|\d{1,3})\s*[/@ ]\s*(\d{1,3})\s*(?:G\s*(\d{1,3}))?\s*$/i.exec(s);
  if (!m) return s.trim() === "" || /^calm$/i.test(s.trim()) ? { dirDeg: null, kt: 0, gustKt: null } : null;
  const dir = /vrb/i.test(m[1]!) ? null : Number(m[1]) % 360;
  return { dirDeg: dir, kt: Number(m[2]), gustKt: m[3] ? Number(m[3]) : null };
}
const fmtWind = (m: Metar) => (m.windKt === null ? "" : m.windKt === 0 ? "0/0" : `${m.windDir === "VRB" || m.windDir === null ? "VRB" : String(m.windDir).padStart(3, "0")}/${m.windKt}${m.gustKt ? `G${m.gustKt}` : ""}`);
const wetFromMetar = (m: Metar | null): Surface => (!m ? "dry" : /(\+|-)?(SN|SG|PL|GR|FZRA|FZDZ)/.test(m.raw) ? "contaminated" : /(RA|DZ|SH|TS)/.test(m.raw.replace(/^\S+\s+\S+/, "")) ? "wet" : "dry");
/** The runway end most into the wind (with a usable length). */
function bestEnd(ends: End[], w: { dirDeg: number | null; kt: number } | null): End | null {
  if (!ends.length) return null;
  if (!w || w.dirDeg === null || w.kt < 3) return [...ends].sort((a, b) => b.lengthFt - a.lengthFt)[0]!;
  return [...ends].sort((a, b) => runwayWind(b.hdg, w).head - runwayWind(a.hdg, w).head || b.lengthFt - a.lengthFt)[0]!;
}

function useAirport(icao: string) {
  const [a, setA] = useState<AirportDetail | null>(null);
  const [m, setM] = useState<Metar | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setA(null); setM(null);
    if (!/^[A-Z0-9]{4}$/.test(icao)) return;
    let off = false; setLoading(true);
    void airportDetail(icao).then((d) => { if (!off) setA(d); }).catch(() => undefined).finally(() => { if (!off) setLoading(false); });
    void getMetar([icao]).then((r) => { if (!off) setM(r[0] ?? null); }).catch(() => undefined);
    return () => { off = true; };
  }, [icao]);
  return { airport: a, metar: m, loading };
}

export function PerformanceScreen() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const { fuelUnit } = useSettings();
  const saved = useMemo(readSaved, []);
  const [tab, setTab] = useState<Tab>(saved.tab ?? (L.airborne ? "landing" : "takeoff"));
  const [unit, setUnit] = useState<"m" | "ft">(saved.unit ?? "m");
  const planIcao = L.plan?.aircraftIcao ?? L.flight?.aircraft?.icaoType ?? null;
  const auto = perfTypeFor(planIcao);
  const [typeId, setTypeId] = useState<string>(saved.type ?? auto?.id ?? "a20n");
  useEffect(() => { if (auto && !saved.type) setTypeId(auto.id); }, [auto?.id]);
  const type: PerfType = PERF_TYPES.find((t) => t.id === typeId) ?? PERF_TYPES[3]!;

  const dep = (L.flight?.departureIcao ?? L.plan?.origin.icao ?? "").toUpperCase();
  const arr = (L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? "").toUpperCase();
  const choice = loadChoice(dep, arr);

  const [to, setTo] = useState<ToState>(() => ({
    icao: dep, rw: choice.depRunway ?? L.plan?.origin.runway ?? "", shiftFt: 0, flap: type.toFlaps[0]!, thrust: "flex", derate: 0, antiIce: false, packsOff: false,
    cg: type.cg[1], surface: "auto", tow: L.plan?.towKg ?? null, wind: "", oat: "", qnh: "", ...(saved.to?.icao === dep ? saved.to : {}),
  }));
  const [ld, setLd] = useState<LdState>(() => ({
    icao: arr, rw: choice.arrRunway ?? L.plan?.destination.runway ?? "", flap: type.ldgFlaps[0]!, autobrake: type.autobrakes[Math.min(1, type.autobrakes.length - 1)]!, reversers: true, antiIce: false,
    surface: "auto", ldw: L.plan?.ldwKg ?? null, wind: "", oat: "", qnh: "", ...(saved.ld?.icao === arr ? saved.ld : {}),
  }));
  // A new plan or flight: follow its airports.
  useEffect(() => { if (dep && dep !== to.icao) setTo((s) => ({ ...s, icao: dep, rw: loadChoice(dep, arr).depRunway ?? L.plan?.origin.runway ?? "", tow: L.plan?.towKg ?? s.tow, wind: "", oat: "", qnh: "" })); }, [dep]);
  useEffect(() => { if (arr && arr !== ld.icao) setLd((s) => ({ ...s, icao: arr, rw: loadChoice(dep, arr).arrRunway ?? L.plan?.destination.runway ?? "", ldw: L.plan?.ldwKg ?? s.ldw, wind: "", oat: "", qnh: "" })); }, [arr]);
  useEffect(() => { if (L.plan?.towKg && to.tow === null) setTo((s) => ({ ...s, tow: L.plan!.towKg! })); if (L.plan?.ldwKg && ld.ldw === null) setLd((s) => ({ ...s, ldw: L.plan!.ldwKg! })); }, [L.plan?.towKg, L.plan?.ldwKg]);
  // A different aircraft: settings it doesn't have go back to its standard ones.
  useEffect(() => {
    setTo((s) => ({ ...s, flap: type.toFlaps.includes(s.flap) ? s.flap : type.toFlaps[0]!, cg: s.cg >= type.cg[0] && s.cg <= type.cg[2] ? s.cg : type.cg[1] }));
    setLd((s) => ({ ...s, flap: type.ldgFlaps.includes(s.flap) ? s.flap : type.ldgFlaps[0]!, autobrake: type.autobrakes.includes(s.autobrake) ? s.autobrake : type.autobrakes[Math.min(1, type.autobrakes.length - 1)]! }));
  }, [type.id]);
  useEffect(() => { writeSaved({ tab, unit, type: typeId === auto?.id ? undefined : typeId, to, ld }); }, [tab, unit, typeId, to, ld]);

  const live = mode === "bridge";
  const D = useAirport(to.icao), A = useAirport(ld.icao);
  const procD = useProcs(to.icao || null, live), procA = useProcs(ld.icao || null, live);

  const wt = (kg: number | null) => (kg === null ? "" : String(Math.round(fuelUnit === "lb" ? kg * LB : kg)));
  const fromWt = (v: string): number | null => { const n = Number(v.replace(/[, ]/g, "")); return v.trim() && Number.isFinite(n) && n > 0 ? (fuelUnit === "lb" ? n / LB : n) : null; };
  const dist = (ft: number) => (unit === "m" ? `${Math.round(ft * M).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`);

  const setChoice = (patch: Partial<ProcChoice>) => { if (!dep && !to.icao) return; const d = dep || to.icao; saveChoice(d, { ...loadChoice(d, arr || ld.icao), ...patch, arr: (arr || ld.icao) || undefined }); };

  return (
    <div className="stack perf">
      <div className="between wrap">
        <h1 className="title">Performance</h1>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg" role="tablist" aria-label="Takeoff or landing">
            <button role="tab" aria-selected={tab === "takeoff"} className={tab === "takeoff" ? "on" : ""} onClick={() => setTab("takeoff")}>Takeoff</button>
            <button role="tab" aria-selected={tab === "landing"} className={tab === "landing" ? "on" : ""} onClick={() => setTab("landing")}>Landing</button>
          </div>
          <div className="seg" aria-label="Distance units">{(["m", "ft"] as const).map((u) => <button key={u} className={unit === u ? "on" : ""} onClick={() => setUnit(u)}>{u}</button>)}</div>
        </div>
      </div>

      <section className="glass pf-head">
        <label className="pf-f wide"><span>Aircraft</span>
          <select value={type.id} onChange={(e) => setTypeId(e.target.value)}>
            {PERF_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}{auto?.id === t.id ? " (your plan)" : ""}</option>)}
          </select>
        </label>
        <div className="pf-lims">
          <span><em>MTOW</em>{wt(type.mtowKg)} {fuelUnit}</span>
          <span><em>MLW</em>{wt(type.mlwKg)} {fuelUnit}</span>
          {planIcao && !auto && <span className="warn"><em>Plan type</em>{planIcao}: not in the list, pick the closest</span>}
        </div>
      </section>

      {tab === "takeoff"
        ? <TakeoffPanel s={to} set={(p) => setTo((x) => ({ ...x, ...p }))} type={type} ap={D} procs={procD} live={live} wt={wt} fromWt={fromWt} dist={dist} unit={unit} fuelUnit={fuelUnit}
            planSid={L.plan?.sid ?? null} choice={choice} onRunway={(rw) => setChoice({ depRunway: rw, sid: undefined, sidTrans: undefined })} onSid={(sid) => setChoice({ sid, sidTrans: undefined })} />
        : <LandingPanel s={ld} set={(p) => setLd((x) => ({ ...x, ...p }))} type={type} ap={A} procs={procA} live={live} wt={wt} fromWt={fromWt} dist={dist} unit={unit} fuelUnit={fuelUnit}
            planStar={L.plan?.star ?? null} choice={choice} onRunway={(rw) => setChoice({ arrRunway: rw, star: undefined, starTrans: undefined, approach: undefined, appTrans: undefined })} onStar={(star) => setChoice({ star, starTrans: undefined })} onApproach={(a) => setChoice({ approach: a || undefined, appTrans: undefined })} />}

      <p className="pf-legal">Estimates scaled from each type's published airport planning figures: good for flying in the sim, not certified data. Your add-on's own EFB (Fenix, PMDG, iniBuilds and others) stays the reference, and nothing here is sent to the aircraft: enter the numbers in your MCDU or FMC.</p>
    </div>
  );
}

type ApData = ReturnType<typeof useAirport>;
type ProcData = ReturnType<typeof useProcs>;
interface Common { type: PerfType; ap: ApData; procs: ProcData; live: boolean; wt: (kg: number | null) => string; fromWt: (v: string) => number | null; dist: (ft: number) => string; unit: "m" | "ft"; fuelUnit: string; choice: ProcChoice }

function F({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: ReactNode }) {
  return <label className={`pf-f${wide ? " wide" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
function Seg<T extends string | number>({ value, options, onChange, label, wide }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string; wide?: boolean }) {
  return <div className={`pf-f${wide ? " wide" : ""}`}><span>{label}</span><div className="seg pf-seg">{options.map(([v, l]) => <button key={String(v)} type="button" className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}</div></div>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="pf-tg"><span>{label}</span><input className="switch" type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></label>;
}

/** Shared airport, runway, conditions block. */
function Conditions({ icao, setIcao, ap, ends, rw, setRw, wind, oat, qnh, surface, set, procSlot }: {
  icao: string; setIcao: (v: string) => void; ap: ApData; ends: End[]; rw: string; setRw: (v: string) => void;
  wind: string; oat: string; qnh: string; surface: Surface | "auto"; set: (p: { wind?: string; oat?: string; qnh?: string; surface?: Surface | "auto" }) => void; procSlot: ReactNode;
}) {
  const m = ap.metar;
  const w = parseWind(wind || (m ? fmtWind(m) : ""));
  const best = bestEnd(ends, w);
  return (
    <section className="glass pf-card">
      <div className="pf-card-h"><h2 className="h2">Runway and conditions</h2>{m ? <span className="pill" title={m.raw}>METAR {m.observed ? new Date(m.observed).toISOString().slice(11, 16) + "Z" : ""}</span> : null}</div>
      <div className="pf-grid">
        <F label="Airport"><input value={icao} maxLength={4} placeholder="EGLL" onChange={(e) => setIcao(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></F>
        <F label="Runway" hint={best && w && w.dirDeg !== null && w.kt >= 3 && rw !== best.ident ? <button type="button" className="linkish" onClick={() => setRw(best.ident)}>Most into wind: {best.ident}</button> : ap.airport ? ap.airport.name : ap.loading ? "Loading runways…" : icao.length === 4 ? "Airport not found" : null}>
          <select value={rw} onChange={(e) => setRw(e.target.value)} disabled={!ends.length}>
            <option value="">{ends.length ? "Choose runway" : "No runways"}</option>
            {ends.map((e) => <option key={e.ident} value={e.ident}>{e.ident} · {String(Math.round(e.hdg)).padStart(3, "0")}°T</option>)}
          </select>
        </F>
        <F label="Wind" hint={m ? <>METAR {fmtWind(m) || "—"}</> : "dir/kt, e.g. 250/12G20"}><input value={wind} placeholder={m ? fmtWind(m) : "250/12"} onChange={(e) => set({ wind: e.target.value.toUpperCase() })} className={w ? "" : "bad"} /></F>
        <F label="OAT °C" hint={m?.tempC !== null && m?.tempC !== undefined ? `METAR ${m.tempC}` : undefined}><input inputMode="numeric" value={oat} placeholder={m?.tempC !== null && m?.tempC !== undefined ? String(m.tempC) : "15"} onChange={(e) => set({ oat: e.target.value.replace(/[^\d-]/g, "") })} /></F>
        <F label="QNH hPa" hint={m?.qnhHpa ? `METAR ${m.qnhHpa}` : undefined}><input inputMode="numeric" value={qnh} placeholder={m?.qnhHpa ? String(m.qnhHpa) : "1013"} onChange={(e) => set({ qnh: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></F>
        <Seg wide label="Runway condition" value={surface} onChange={(v) => set({ surface: v })} options={[["auto", `Auto${m ? ` (${wetFromMetar(m)})` : ""}`], ["dry", "Dry"], ["wet", "Wet"], ["contaminated", "Contaminated"]]} />
      </div>
      {procSlot}
    </section>
  );
}

function ProcPick({ label, value, plan, options, onChange, live, example = "CPT3G" }: { label: string; value: string | undefined; plan: string | null; options: string[]; onChange: (v: string) => void; live: boolean; example?: string }) {
  const all = plan && !options.includes(plan) ? [plan, ...options] : options;
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  if (all.length) {
    return <F label={label} hint={plan ? `Plan: ${plan}` : undefined}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">None (vectors)</option>
        {all.map((o) => <option key={o} value={o}>{o}{o === plan ? " (plan)" : ""}</option>)}
      </select>
    </F>;
  }
  return <F label={label} hint={live ? "The sim didn't list procedures here: type the name" : "Type the name, or connect your Bridge for the sim's list"}>
    <input value={text} placeholder={plan ?? `e.g. ${example}`} maxLength={10} onChange={(e) => setText(e.target.value.toUpperCase())} onBlur={() => onChange(text.trim())} onKeyDown={(e) => { if (e.key === "Enter") onChange(text.trim()); }} />
  </F>;
}

function RunwayBar({ total, used, mark, label, usedLabel, ok, start = 0 }: { total: number; used: number; mark?: number; label: string; usedLabel: string; ok: boolean; start?: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(total + start, 1)) * 100))}%`;
  return (
    <div className={`pf-rwy${ok ? "" : " bad"}`} aria-label={`${usedLabel} of ${label}`}>
      <div className="pf-rwy-strip">
        {start > 0 && <span className="pf-rwy-cut" style={{ width: pct(start) }} />}
        <span className="pf-rwy-used" style={{ left: pct(start), width: pct(Math.min(used, total)) }} />
        {mark !== undefined && <span className="pf-rwy-mark" style={{ left: pct(start + mark) }}><b>V1</b></span>}
        <span className="pf-rwy-dash" />
      </div>
      <div className="pf-rwy-k"><span>{usedLabel}</span><span>{label}</span></div>
    </div>
  );
}

function Out({ k, v, unit, big, tone }: { k: string; v: ReactNode; unit?: string; big?: boolean; tone?: "g" | "c" | "a" | "m" }) {
  return <div className={`pf-o${big ? " big" : ""}${tone ? ` t-${tone}` : ""}`}><em>{k}</em><b>{v}{unit ? <small>{unit}</small> : null}</b></div>;
}

function useCopy(): [string | null, (t: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  return [msg, (t) => { void navigator.clipboard?.writeText(t).then(() => setMsg("Copied"), () => setMsg("Couldn't copy")); window.setTimeout(() => setMsg(null), 1800); }];
}

function TakeoffPanel(p: Common & { s: ToState; set: (x: Partial<ToState>) => void; planSid: string | null; onRunway: (rw: string) => void; onSid: (sid: string) => void }) {
  const { s, set, type, ap } = p;
  const ends = useMemo(() => endsOf(ap.airport?.runways ?? []), [ap.airport]);
  const end = ends.find((e) => e.ident === s.rw) ?? null;
  const m = ap.metar;
  const w = parseWind(s.wind || (m ? fmtWind(m) : "")) ?? { dirDeg: null, kt: 0, gustKt: null };
  const oat = s.oat !== "" ? Number(s.oat) : m?.tempC ?? 15;
  const qnh = s.qnh !== "" ? Number(s.qnh) : m?.qnhHpa ?? 1013;
  const surface: Surface = s.surface === "auto" ? wetFromMetar(m) : s.surface;
  const elev = ap.airport?.elevationFt ?? 0;
  const tora = end ? Math.max(0, end.lengthFt - s.shiftFt) : 0;
  const r = end && s.tow ? takeoff({ type, towKg: s.tow, toraFt: tora, runwayHdgTrue: end.hdg, atmos: { elevationFt: elev, oatC: oat, qnhHpa: qnh }, wind: w, surface, flap: s.flap, thrust: s.thrust, derate: s.derate, antiIce: s.antiIce, packsOff: s.packsOff, cgPct: s.cg }) : null;
  const [copied, copy] = useCopy();
  const sidOpts = (p.procs.data?.departures ?? []).filter((d) => !s.rw || !d.runways.length || d.runways.includes(s.rw)).map((d) => d.name);
  const flexLabel = type.maker === "boeing" ? "Assumed temp" : "FLEX";
  const summary = r && end ? `${s.icao} RWY ${end.ident}${s.shiftFt ? ` (-${p.dist(s.shiftFt)})` : ""}  ${type.maker === "airbus" ? `CONF ${s.flap}` : `FLAPS ${s.flap}`}  ${r.flexC !== null ? `${flexLabel} ${r.flexC}` : "TOGA"}${s.derate ? ` TO-${s.derate}` : ""}  V1 ${r.v1} VR ${r.vr} V2 ${r.v2}  ${type.maker === "airbus" ? "THS" : "TRIM"} ${r.trim}  THR RED/ACC ${r.thrRedFt}/${r.accFt}  EO ACC ${r.eoAccFt}` : "";

  return (
    <div className="pf-cols">
      <div className="pf-in">
        <Conditions icao={s.icao} setIcao={(v) => set({ icao: v, rw: "" })} ap={ap} ends={ends} rw={s.rw} setRw={(v) => { set({ rw: v }); p.onRunway(v); }}
          wind={s.wind} oat={s.oat} qnh={s.qnh} surface={s.surface} set={set}
          procSlot={<div className="pf-grid" style={{ marginTop: 10 }}>
            <ProcPick label="SID" value={p.choice.sid ?? p.planSid ?? undefined} plan={p.planSid} options={sidOpts} onChange={p.onSid} live={p.live} />
            <F label={`Intersection (${p.unit})`} hint={end ? `TORA ${p.dist(tora)}` : undefined}><input inputMode="numeric" value={s.shiftFt ? String(Math.round(p.unit === "m" ? s.shiftFt * M : s.shiftFt)) : ""} placeholder="Full length"
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); set({ shiftFt: n ? (p.unit === "m" ? n / M : n) : 0 }); }} /></F>
          </div>} />
        <section className="glass pf-card">
          <div className="pf-card-h"><h2 className="h2">Aircraft</h2></div>
          <div className="pf-grid">
            <F label={`Takeoff weight (${p.fuelUnit})`} hint={s.tow === null ? "From your plan once it's loaded" : s.tow > type.mtowKg ? "Over max takeoff weight" : undefined}>
              <input inputMode="numeric" value={p.wt(s.tow)} placeholder={p.wt(Math.round(type.mtowKg * 0.88))} onChange={(e) => set({ tow: p.fromWt(e.target.value) })} />
            </F>
            {type.maker !== "other" && <F label="CG % MAC"><input inputMode="decimal" value={String(s.cg)} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set({ cg: n }); }} /></F>}
            <Seg label={type.maker === "airbus" ? "Config" : "Flaps"} value={s.flap} onChange={(v) => set({ flap: v })} options={type.toFlaps.map((f) => [f, f])} />
            {type.flexMaxC > 0 && <Seg label="Thrust" value={s.thrust} onChange={(v) => set({ thrust: v })} options={[["flex", type.maker === "boeing" ? "Assumed" : "Flex"], ["toga", type.maker === "boeing" ? "Full" : "TOGA"]]} />}
            {type.maker === "boeing" && <Seg label="Derate" value={s.derate} onChange={(v) => set({ derate: v })} options={[[0, "TO"], [1, "TO-1"], [2, "TO-2"]]} />}
          </div>
          <div className="pf-tgs"><Toggle label="Engine anti-ice" value={s.antiIce} onChange={(v) => set({ antiIce: v })} /><Toggle label="Packs off" value={s.packsOff} onChange={(v) => set({ packsOff: v })} /></div>
        </section>
      </div>

      <section className={`glass pf-res${r && !r.ok ? " bad" : ""}`} aria-live="polite">
        <div className="pf-card-h"><h2 className="h2">Takeoff data</h2>{r && <button className="btn small" onClick={() => copy(summary)}>{copied ?? "Copy"}</button>}</div>
        {!end ? <p className="muted">Choose an airport and runway.</p> : !s.tow ? <p className="muted">Add the takeoff weight, or load your SimBrief plan.</p> : r && (
          <>
            <div className="pf-scr">
              <div className="pf-scr-top"><span>{s.icao} <b>{end.ident}</b></span><span>{type.maker === "airbus" ? "CONF" : "FLAPS"} <b>{s.flap}</b></span><span className={r.flexC !== null ? "t-c" : "t-a"}>{r.flexC !== null ? <>{flexLabel} <b>{r.flexC}°</b></> : <b>{type.maker === "boeing" ? `TO${s.derate ? `-${s.derate}` : ""}` : "TOGA"}</b>}</span></div>
              <div className="pf-v">
                <Out k="V1" v={r.v1} big tone="c" /><Out k="VR" v={r.vr} big tone="c" /><Out k="V2" v={r.v2} big tone="c" />
              </div>
              <div className="pf-o-row">
                <Out k={type.maker === "airbus" ? "THS" : "Stab trim"} v={r.trim} tone="g" />
                <Out k="THR RED / ACC" v={`${r.thrRedFt} / ${r.accFt}`} tone="g" />
                <Out k="EO ACC" v={r.eoAccFt} tone="g" />
                {r.greenDot && <Out k="Green dot" v={r.greenDot} unit="kt" tone="g" />}
              </div>
            </div>
            <RunwayBar total={tora} start={s.shiftFt} used={r.todrFt} mark={(r.todrFt * (r.v1 / r.v2) ** 2) * 0.9} ok={r.ok} label={`TORA ${p.dist(tora)}`} usedLabel={`Needed ${p.dist(r.todrFt)}`} />
            <div className="pf-o-row small">
              <Out k="Margin" v={p.dist(Math.max(0, r.marginFt))} tone={r.marginFt > 0 ? "g" : "a"} />
              <Out k={r.headKt >= 0 ? "Headwind" : "Tailwind"} v={Math.abs(r.headKt)} unit="kt" tone={r.headKt >= 0 ? "g" : "a"} />
              <Out k="Crosswind" v={`${Math.abs(r.crossKt)} ${r.crossKt > 0 ? "R" : r.crossKt < 0 ? "L" : ""}`} unit="kt" tone={Math.abs(r.crossKt) > 20 ? "a" : "g"} />
              <Out k="Runway" v={surface === "contaminated" ? "Contam." : surface[0]!.toUpperCase() + surface.slice(1)} tone={surface === "dry" ? "g" : "a"} />
            </div>
            {r.problem && <p className="pf-warn">{r.problem}</p>}
            {r.overweight && <p className="pf-warn">Takeoff weight is over this type's maximum ({p.wt(type.mtowKg)} {p.fuelUnit}).</p>}
            {s.thrust === "flex" && r.flexC === null && r.ok && <p className="pf-note">No flex: the runway is too short for reduced thrust{surface === "contaminated" ? " (or it's contaminated)" : ""}, so use full thrust.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function LandingPanel(p: Common & { s: LdState; set: (x: Partial<LdState>) => void; planStar: string | null; onRunway: (rw: string) => void; onStar: (s: string) => void; onApproach: (a: string) => void }) {
  const { s, set, type, ap } = p;
  const ends = useMemo(() => endsOf(ap.airport?.runways ?? []), [ap.airport]);
  const end = ends.find((e) => e.ident === s.rw) ?? null;
  const m = ap.metar;
  const w = parseWind(s.wind || (m ? fmtWind(m) : "")) ?? { dirDeg: null, kt: 0, gustKt: null };
  const oat = s.oat !== "" ? Number(s.oat) : m?.tempC ?? 15;
  const qnh = s.qnh !== "" ? Number(s.qnh) : m?.qnhHpa ?? 1013;
  const surface: Surface = s.surface === "auto" ? wetFromMetar(m) : s.surface;
  const elev = ap.airport?.elevationFt ?? 0;
  const r = end && s.ldw ? landing({ type, ldwKg: s.ldw, ldaFt: end.ldaFt, runwayHdgTrue: end.hdg, atmos: { elevationFt: elev, oatC: oat, qnhHpa: qnh }, wind: w, surface, flap: s.flap, autobrake: s.autobrake, reversers: s.reversers, antiIce: s.antiIce }) : null;
  const [copied, copy] = useCopy();
  const starOpts = (p.procs.data?.arrivals ?? []).filter((d) => !s.rw || !d.runways.length || d.runways.includes(s.rw)).map((d) => d.name);
  const appOpts = (p.procs.data?.approaches ?? []).filter((a) => !s.rw || a.runway === s.rw).map((a) => a.name);
  const isAb = type.maker === "airbus";
  const summary = r && end ? `${s.icao} RWY ${end.ident}  ${isAb ? `CONF ${s.flap}` : `FLAPS ${s.flap}`}  AUTOBRAKE ${s.autobrake}  ${isAb ? "VLS" : "VREF"} ${r.vls}  VAPP ${r.vapp}  QNH ${qnh}  LDA ${p.dist(end.ldaFt)}  LD ${p.dist(r.factoredFt)}` : "";

  return (
    <div className="pf-cols">
      <div className="pf-in">
        <Conditions icao={s.icao} setIcao={(v) => set({ icao: v, rw: "" })} ap={ap} ends={ends} rw={s.rw} setRw={(v) => { set({ rw: v }); p.onRunway(v); }}
          wind={s.wind} oat={s.oat} qnh={s.qnh} surface={s.surface} set={set}
          procSlot={<div className="pf-grid" style={{ marginTop: 10 }}>
            <ProcPick label="STAR" example="MIRSI1A" value={p.choice.star ?? p.planStar ?? undefined} plan={p.planStar} options={starOpts} onChange={p.onStar} live={p.live} />
            <ProcPick label="Approach" example={`ILS ${s.rw || "23R"}`} value={p.choice.approach} plan={null} options={appOpts} onChange={p.onApproach} live={p.live} />
          </div>} />
        <section className="glass pf-card">
          <div className="pf-card-h"><h2 className="h2">Aircraft</h2></div>
          <div className="pf-grid">
            <F label={`Landing weight (${p.fuelUnit})`} hint={s.ldw === null ? "From your plan once it's loaded" : s.ldw > type.mlwKg ? "Over max landing weight" : undefined}>
              <input inputMode="numeric" value={p.wt(s.ldw)} placeholder={p.wt(Math.round(type.mlwKg * 0.9))} onChange={(e) => set({ ldw: p.fromWt(e.target.value) })} />
            </F>
            <Seg label={isAb ? "Config" : "Flaps"} value={s.flap} onChange={(v) => set({ flap: v })} options={type.ldgFlaps.map((f) => [f, f])} />
            <Seg label="Autobrake" value={s.autobrake} onChange={(v) => set({ autobrake: v })} options={type.autobrakes.map((f) => [f, f])} />
          </div>
          <div className="pf-tgs"><Toggle label="Reversers" value={s.reversers} onChange={(v) => set({ reversers: v })} /><Toggle label="Ice accretion" value={s.antiIce} onChange={(v) => set({ antiIce: v })} /></div>
        </section>
      </div>

      <section className={`glass pf-res${r && !r.ok ? " bad" : ""}`} aria-live="polite">
        <div className="pf-card-h"><h2 className="h2">Landing data</h2>{r && <button className="btn small" onClick={() => copy(summary)}>{copied ?? "Copy"}</button>}</div>
        {!end ? <p className="muted">Choose an airport and runway.</p> : !s.ldw ? <p className="muted">Add the landing weight, or load your SimBrief plan.</p> : r && (
          <>
            <div className="pf-scr">
              <div className="pf-scr-top"><span>{s.icao} <b>{end.ident}</b></span><span>{isAb ? "CONF" : "FLAPS"} <b>{s.flap}</b></span><span>A/BRK <b>{s.autobrake}</b></span></div>
              <div className="pf-v two">
                <Out k={isAb ? "VLS" : "VREF"} v={r.vls} big tone="c" /><Out k="VAPP" v={r.vapp} big tone="m" />
              </div>
              <div className="pf-o-row">
                <Out k="Wind add" v={`+${r.addKt}`} unit="kt" tone="g" />
                <Out k="QNH" v={qnh} tone="g" />
                <Out k="CAT I DA ≈" v={Math.round(elev + 200)} unit="ft" tone="g" />
              </div>
            </div>
            <RunwayBar total={end.ldaFt} used={r.factoredFt} ok={r.ok} label={`LDA ${p.dist(end.ldaFt)}`} usedLabel={`Needed ${p.dist(r.factoredFt)} (actual ${p.dist(r.ldFt)})`} />
            <div className="pf-o-row small">
              <Out k="Margin" v={p.dist(Math.max(0, r.marginFt))} tone={r.marginFt > 0 ? "g" : "a"} />
              <Out k={r.headKt >= 0 ? "Headwind" : "Tailwind"} v={Math.abs(r.headKt)} unit="kt" tone={r.headKt >= 0 ? "g" : "a"} />
              <Out k="Crosswind" v={`${Math.abs(r.crossKt)} ${r.crossKt > 0 ? "R" : r.crossKt < 0 ? "L" : ""}`} unit="kt" tone={Math.abs(r.crossKt) > 20 ? "a" : "g"} />
              <Out k="Runway" v={surface === "contaminated" ? "Contam." : surface[0]!.toUpperCase() + surface.slice(1)} tone={surface === "dry" ? "g" : "a"} />
            </div>
            {r.problem && <p className="pf-warn">{r.problem}{r.suggestedAutobrake && r.suggestedAutobrake !== s.autobrake ? ` Autobrake ${r.suggestedAutobrake} would fit.` : ""}</p>}
            {r.ok && r.suggestedAutobrake && type.autobrakes.indexOf(r.suggestedAutobrake) < type.autobrakes.indexOf(s.autobrake) && <p className="pf-note">Autobrake {r.suggestedAutobrake} would still stop with the margin, and is kinder to passengers and brakes.</p>}
            {r.overweight && <p className="pf-warn">Landing weight is over this type's maximum ({p.wt(type.mlwKg)} {p.fuelUnit}): an overweight landing.</p>}
          </>
        )}
      </section>
    </div>
  );
}
