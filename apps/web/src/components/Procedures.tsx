/**
 * Runways, SID, STAR and approach for this flight, picked from the simulator's
 * own navigation data (through the Bridge). What you pick is Glidepath's plan:
 * the live card, messages and approach coach use it. It doesn't reprogram the
 * aircraft, so set the same in the FMC / MCDU.
 */
import { useEffect, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useLive } from "../data/derive";
import { useApp } from "../data/store";

interface Proc { name: string; runways: string[]; transitions: string[] }
interface Appr { name: string; type: string; runway: string; transitions: string[] }
interface AirportProcs { icao: string; runways: string[]; departures: Proc[]; arrivals: Proc[]; approaches: Appr[] }

export interface ProcChoice { arr?: string; depRunway?: string; sid?: string; sidTrans?: string; arrRunway?: string; star?: string; starTrans?: string; approach?: string; appTrans?: string }

// Saved per departure airport (with the destination inside), so a typed-in destination counts too.
const KEY = (dep: string) => `glidepath.procs.${dep}`;
export function loadChoice(dep: string | null | undefined, arr?: string | null): ProcChoice {
  if (!dep) return {};
  try {
    const c = JSON.parse(localStorage.getItem(KEY(dep.toUpperCase())) ?? "{}") as ProcChoice;
    return arr && c.arr && c.arr !== arr.toUpperCase() ? {} : c;
  } catch { return {}; }
}
// Another tab or window changed a procedure pick: update this one too.
try { window.addEventListener("storage", (e) => { if (e.key?.startsWith("glidepath.procs.")) window.dispatchEvent(new Event("glidepath-procs")); }); } catch { /* no window */ }
export function saveChoice(dep: string, c: ProcChoice) {
  try { localStorage.setItem(KEY(dep), JSON.stringify(c)); } catch { /* private mode */ }
  window.dispatchEvent(new Event("glidepath-procs"));
  window.dispatchEvent(new Event("glidepath-procs-local"));
}
/** The pilot's choices for the current departure (destination, runways, procedures). */
export function useChoice(dep: string | null | undefined, arr: string | null | undefined): ProcChoice {
  const [v, setV] = useState(() => loadChoice(dep, arr));
  useEffect(() => {
    const f = () => setV(loadChoice(dep, arr));
    f(); window.addEventListener("glidepath-procs", f);
    return () => window.removeEventListener("glidepath-procs", f);
  }, [dep, arr]);
  return v;
}
export const useChosenArrivalRunway = (dep: string | null | undefined, arr: string | null | undefined) => useChoice(dep, arr).arrRunway ?? null;

export function useProcs(icao: string | null | undefined, enabled: boolean) {
  const [data, setData] = useState<AirportProcs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null); setErr(null);
    const b = activeBridge();
    if (!icao || !enabled || !b) return;
    let stop = false;
    setLoading(true);
    b.get<AirportProcs>(`/api/procedures/${icao}`).then((d) => { if (!stop) setData(d); }).catch((e: Error) => { if (!stop) setErr(e.message); }).finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [icao, enabled]);
  return { data, err, loading };
}

function Pick({ label, tone, value, options, onChange, empty, plan }: { label: string; tone: string; value: string | undefined; options: string[]; onChange: (v: string) => void; empty: string; plan?: string | null }) {
  return (
    <label className={`pr-row t-${tone}`}>
      <span className="pr-k">{label}{plan && value === plan ? <em className="pr-plan">From your SimBrief plan</em> : null}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!options.length}>
        <option value="">{options.length ? empty : "None"}</option>
        {options.map((o) => <option key={o} value={o}>{o}{plan === o ? " (plan)" : ""}</option>)}
      </select>
    </label>
  );
}

export function Procedures() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const dep = (L.flight?.departureIcao ?? L.plan?.origin.icao ?? null)?.toUpperCase() ?? null;
  const [arrTyped, setArrTyped] = useState(() => loadChoice(dep).arr ?? "");
  const arr = (L.flight?.arrivalIcao ?? L.plan?.destination.icao ?? (arrTyped.length === 4 ? arrTyped : null))?.toUpperCase() ?? null;
  const live = mode === "bridge";
  const D = useProcs(dep, live), A = useProcs(arr, live);
  const [c, setC] = useState<ProcChoice>(() => loadChoice(dep, arr));
  useEffect(() => {
    const saved = loadChoice(dep, arr);
    // First time on this route: start from the plan's runways.
    // First time on this route: start from the plan's runways, SID and STAR (SimBrief). Your own picks always win.
    setC({ depRunway: L.plan?.origin.runway ?? undefined, arrRunway: L.plan?.destination.runway ?? undefined, sid: L.plan?.sid ?? undefined, star: L.plan?.star ?? undefined, ...saved });
  }, [dep, arr]);
  const set = (patch: Partial<ProcChoice>) => { const n = { ...c, ...patch, arr: arr ?? undefined }; setC(n); if (dep) saveChoice(dep, n); };

  if (!L.flight) return null;
  const serves = (p: Proc, rw?: string) => !rw || !p.runways.length || p.runways.includes(rw);
  const sids = D.data?.departures.filter((p) => serves(p, c.depRunway)) ?? [];
  const stars = A.data?.arrivals.filter((p) => serves(p, c.arrRunway)) ?? [];
  const planSid = L.plan?.sid ?? null, planStar = L.plan?.star ?? null;
  const withPlan = (names: string[], plan: string | null) => plan && !names.includes(plan) ? [plan, ...names] : names;
  const apps = A.data?.approaches.filter((a) => !c.arrRunway || a.runway === c.arrRunway) ?? [];
  const sid = D.data?.departures.find((p) => p.name === c.sid);
  const star = A.data?.arrivals.find((p) => p.name === c.star);
  const app = A.data?.approaches.find((a) => a.name === c.approach);

  const typedDest = live && !(L.flight?.arrivalIcao ?? L.plan?.destination.icao);
  const destInput = (
    <label className="pr-row t-rw">
      <span className="pr-k">Airport</span>
      <input value={arrTyped} maxLength={4} placeholder="ICAO, e.g. EGCC" onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); setArrTyped(v); if (dep && v.length === 4) { saveChoice(dep, { ...c, arr: v }); window.dispatchEvent(new Event("glidepath-procs")); } }} />
    </label>
  );
  const side = (title: string, icao: string | null, s: typeof D, body: React.ReactNode, top?: React.ReactNode) => (
    <div className="pr-side">
      <div className="pr-h"><span>{title}</span><b>{icao ?? "····"}</b></div>
      {top}
      {!live ? <p className="pr-note">Connect your Bridge with the sim running to pick procedures.</p>
        : !icao ? null
        : s.loading ? <p className="pr-note">Reading {icao} from the simulator…</p>
        : s.err ? <p className="pr-note warn">{s.err}</p>
        : body}
    </div>
  );

  return (
    <section className="glass procs">
      <div className="between wrap" style={{ marginBottom: 6 }}>
        <h2 className="h2" style={{ margin: 0 }}>Runways and procedures</h2>
        <span className="faint" style={{ fontSize: 12.5 }}>From the sim's navigation data</span>
      </div>
      <div className="pr-grid">
        {side("Origin", dep, D, D.data && (
          <>
            <Pick label="Runway" tone="rw" value={c.depRunway} options={D.data.runways} empty="Choose runway" onChange={(v) => set({ depRunway: v || undefined, sid: undefined, sidTrans: undefined })} />
            <Pick label="Departure" tone="sid" value={c.sid} options={withPlan(sids.map((p) => p.name), planSid)} plan={planSid} empty="No SID (vectors)" onChange={(v) => set({ sid: v || undefined, sidTrans: undefined })} />
            <Pick label="Transition" tone="sid" value={c.sidTrans} options={sid?.transitions ?? []} empty="None" onChange={(v) => set({ sidTrans: v || undefined })} />
          </>
        ))}
        {side("Destination", arr, A, A.data && (
          <>
            <Pick label="Runway" tone="rw" value={c.arrRunway} options={A.data.runways} empty="Choose runway" onChange={(v) => set({ arrRunway: v || undefined, star: undefined, starTrans: undefined, approach: undefined, appTrans: undefined })} />
            <Pick label="Arrival" tone="star" value={c.star} options={withPlan(stars.map((p) => p.name), planStar)} plan={planStar} empty="No STAR" onChange={(v) => set({ star: v || undefined, starTrans: undefined })} />
            <Pick label="Transition" tone="star" value={c.starTrans} options={star?.transitions ?? []} empty="None" onChange={(v) => set({ starTrans: v || undefined })} />
            <Pick label="Approach" tone="app" value={c.approach} options={apps.map((a) => a.name)} empty="Choose approach" onChange={(v) => set({ approach: v || undefined, appTrans: undefined })} />
            <Pick label="Transition" tone="app" value={c.appTrans} options={app?.transitions ?? []} empty="Vectors" onChange={(v) => set({ appTrans: v || undefined })} />
          </>
        ), typedDest ? destInput : undefined)}
      </div>
      {(planSid || planStar) && (
        <p className="pr-note pr-drawn">
          The live map draws your plan's {[planSid ? <b key="s" className="t-sid">{planSid}</b> : null, planSid && planStar ? " and " : null, planStar ? <b key="r" className="t-star">{planStar}</b> : null]}
          {(c.sid && planSid && c.sid !== planSid) || (c.star && planStar && c.star !== planStar) ? ". You've picked a different procedure; the map shows the planned one, as only SimBrief gives the waypoints." : "."}
        </p>
      )}
      {(c.sid || c.star || c.approach) && (
        <p className="pr-sum data">
          {[dep && c.depRunway ? `${dep} ${c.depRunway}` : dep, c.sid ? `${c.sid}${c.sidTrans ? `.${c.sidTrans}` : ""}` : null, "…", c.star ? `${c.starTrans ? `${c.starTrans}.` : ""}${c.star}` : null, c.approach ? `${c.appTrans ? `${c.appTrans} ` : ""}${c.approach}` : null, arr].filter(Boolean).join("  ")}
        </p>
      )}
      <p className="pr-foot">This is your plan in Glidepath: the live card and messages use it. It doesn't change the aircraft, so enter the same in your FMC or MCDU.</p>
    </section>
  );
}
