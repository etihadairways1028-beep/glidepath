/**
 * Approach guide: a synthetic ILS for any runway. Deviation scales, a side
 * view of the glidepath, a top view of the centreline, the numbers that
 * matter on final and optional spoken callouts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApproachGuide, Tone } from "@glidepath/flight-engine";
import { onFinal, saveSetup, useApproach, type LiveApproach } from "../data/approach";
import { useLive } from "../data/derive";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Deviation display: magenta diamonds on ILS-style scales around a fixed aircraft symbol. */
export function DeviationScales({ g, compact }: { g: ApproachGuide; compact?: boolean }) {
  const S = compact ? 150 : 300, c = S / 2, dot = S * 0.16;
  // The diamonds show where the path is: above it, the diamond sits low (fly down); right of the centreline, it sits left (fly left).
  const vy = c + g.vDots * dot;
  const hx = c - g.hDots * dot;
  const off = (d: number) => Math.abs(d) >= 2.45;
  return (
    <svg className={`ap-dev${compact ? " small" : ""}`} viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${g.vText}. ${g.hText}.`}>
      <rect x="1" y="1" width={S - 2} height={S - 2} rx={S * 0.08} className="ap-dev-bg" />
      {/* Horizon cross */}
      <line x1={S * 0.12} x2={S * 0.88} y1={c} y2={c} className="ap-dev-axis" />
      <line y1={S * 0.12} y2={S * 0.88} x1={c} x2={c} className="ap-dev-axis" />
      {/* Vertical scale, right */}
      {[-2, -1, 1, 2].map((d) => <circle key={`v${d}`} cx={S * 0.9} cy={c + d * dot} r={S * 0.018} className="ap-dev-dot" />)}
      <line x1={S * 0.86} x2={S * 0.94} y1={c} y2={c} className="ap-dev-ref" />
      {/* Lateral scale, bottom */}
      {[-2, -1, 1, 2].map((d) => <circle key={`h${d}`} cy={S * 0.9} cx={c + d * dot} r={S * 0.018} className="ap-dev-dot" />)}
      <line y1={S * 0.86} y2={S * 0.94} x1={c} x2={c} className="ap-dev-ref" />
      {/* Diamonds: where the glidepath and centreline are */}
      <path className={`ap-dia${off(g.vDots) ? " pegged" : ""}`} style={{ transform: `translate(${S * 0.9}px, ${vy}px)` }} d={`M0 ${-S * 0.045} L${S * 0.03} 0 L0 ${S * 0.045} L${-S * 0.03} 0Z`} />
      <path className={`ap-dia${off(g.hDots) ? " pegged" : ""}`} style={{ transform: `translate(${hx}px, ${S * 0.9}px)` }} d={`M${-S * 0.045} 0 L0 ${S * 0.03} L${S * 0.045} 0 L0 ${-S * 0.03}Z`} />
      {/* Flight director style bars: the path relative to you */}
      <line className={`ap-bar t-${g.vTone}`} x1={S * 0.22} x2={S * 0.78} y1={vy} y2={vy} style={{ transition: "all .5s ease" }} />
      <line className={`ap-bar t-${g.hTone}`} y1={S * 0.22} y2={S * 0.78} x1={hx} x2={hx} style={{ transition: "all .5s ease" }} />
      {/* Fixed aircraft symbol */}
      <g className="ap-plane">
        <path d={`M${c - S * 0.17} ${c} H${c - S * 0.05} L${c} ${c + S * 0.04} L${c + S * 0.05} ${c} H${c + S * 0.17}`} />
        <rect x={c - S * 0.012} y={c - S * 0.012} width={S * 0.024} height={S * 0.024} />
      </g>
    </svg>
  );
}

/** Side view: the glidepath from the threshold out to 10 nm, with a one-dot band. */
function Profile({ g, gpa, tch }: { g: ApproachGuide; gpa: number; tch: number }) {
  const W = 640, H = 220, pad = 36, maxNm = Math.max(6, Math.min(12, Math.ceil(g.distNm + 1.5)));
  const ftAt = (nm: number) => tch + Math.tan((gpa * Math.PI) / 180) * nm * 6076.12;
  const maxFt = ftAt(maxNm) * 1.35;
  const x = (nm: number) => W - pad - (nm / maxNm) * (W - pad * 2);
  const y = (ft: number) => H - pad - (Math.max(0, ft) / maxFt) * (H - pad * 2);
  const band = (nm: number, k: number) => Math.tan(((gpa + k * 0.35) * Math.PI) / 180) * (nm * 6076.12 + tch / Math.tan((gpa * Math.PI) / 180));
  const pts = (k: number) => Array.from({ length: 13 }, (_, i) => (i / 12) * maxNm).map((n) => `${x(n)},${y(band(n, k))}`).join(" ");
  const ax = x(Math.max(0, Math.min(maxNm, g.distNm))), ay = y(g.hatFt);
  return (
    <svg className="ap-view" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Side view of the glidepath">
      <polygon className="ap-band" points={`${pts(1)} ${pts(-1).split(" ").reverse().join(" ")}`} />
      <line className="ap-ground" x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} />
      <line className="ap-path" x1={x(0)} y1={y(tch)} x2={x(maxNm)} y2={y(ftAt(maxNm))} />
      {Array.from({ length: maxNm }, (_, i) => i + 1).map((n) => (
        <g key={n}>
          <line className="ap-tick" x1={x(n)} x2={x(n)} y1={H - pad} y2={H - pad + 6} />
          <text className="ap-lbl" x={x(n)} y={H - pad + 20} textAnchor="middle">{n}</text>
          {n % 2 === 0 || maxNm <= 6 ? <text className="ap-lbl dim" x={x(n)} y={y(ftAt(n)) - 10} textAnchor="middle">{fmt(ftAt(n) / 10) + "0"}</text> : null}
        </g>
      ))}
      <rect className="ap-rwy" x={x(0) - 2} y={H - pad - 3} width={pad - 8} height={6} rx={2} />
      <text className="ap-lbl" x={x(0)} y={H - pad + 20} textAnchor="middle">THR</text>
      <line className={`ap-drop t-${g.vTone}`} x1={ax} x2={ax} y1={ay} y2={y(g.hatFt - g.vertFt)} />
      <circle className={`ap-ac t-${g.vTone}`} cx={ax} cy={ay} r={8} />
      <text className="ap-lbl axis" x={pad} y={16}>Height above threshold (ft) · distance (nm)</text>
    </svg>
  );
}

/** Top view: the extended centreline, a one-dot cone and where you are. */
function PlanView({ g }: { g: ApproachGuide }) {
  const W = 640, H = 160, pad = 36, maxNm = Math.max(6, Math.min(12, Math.ceil(g.distNm + 1.5)));
  const x = (nm: number) => W - pad - (nm / maxNm) * (W - pad * 2);
  const spanFt = Math.max(2000, Math.abs(g.latFt) * 1.4, Math.tan((2.5 * Math.PI) / 180) * maxNm * 6076.12);
  const y = (ft: number) => H / 2 + (ft / spanFt) * (H / 2 - 18);
  const cone = (nm: number, k: number) => Math.tan((k * 1.25 * Math.PI) / 180) * (nm * 6076.12 + 9000);
  const ax = x(Math.max(0, Math.min(maxNm, g.distNm))), ay = y(Math.max(-spanFt, Math.min(spanFt, g.latFt)));
  const trk = g.trackErrDeg ?? 0;
  return (
    <svg className="ap-view" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Top view of the centreline">
      <polygon className="ap-band" points={`${x(0)},${y(cone(0, 1))} ${x(maxNm)},${y(cone(maxNm, 1))} ${x(maxNm)},${y(cone(maxNm, -1))} ${x(0)},${y(cone(0, -1))}`} />
      <line className="ap-path" x1={x(0)} x2={x(maxNm)} y1={H / 2} y2={H / 2} strokeDasharray="10 8" />
      <rect className="ap-rwy" x={x(0)} y={H / 2 - 5} width={pad - 6} height={10} rx={2} />
      {Array.from({ length: maxNm }, (_, i) => i + 1).map((n) => <text key={n} className="ap-lbl dim" x={x(n)} y={H - 6} textAnchor="middle">{n}</text>)}
      <g style={{ transform: `translate(${ax}px, ${ay}px) rotate(${180 + trk}deg)`, transition: "transform .6s ease" }}>
        <path className={`ap-acp t-${g.hTone}`} d="M0 -11 L5 4 L0 1 L-5 4 Z" transform="rotate(90)" />
      </g>
      <text className="ap-lbl axis" x={pad} y={16}>Looking down: runway on the right</text>
    </svg>
  );
}

function Num({ k, v, unit, sub, tone }: { k: string; v: ReactNode; unit?: string; sub?: ReactNode; tone?: Tone }) {
  return <div className={`ap-num${tone ? ` t-${tone}` : ""}`}><em>{k}</em><b>{v}{unit ? <small>{unit}</small> : null}</b>{sub ? <span>{sub}</span> : null}</div>;
}

/** Spoken callouts: big deviations and heights above the threshold. Off unless you turn it on. */
function useCallouts(a: LiveApproach) {
  const last = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const heights = useRef<Set<number>>(new Set());
  const g = a.guide;
  useEffect(() => {
    if (!a.setup.voice || !g || typeof speechSynthesis === "undefined") return;
    if (!onFinal(g) && g.state !== "established") { if (g.distNm > 15) heights.current.clear(); return; }
    const say = (t: string) => { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 1.05; speechSynthesis.speak(u); } catch { /* no voice */ } };
    for (const h of [1000, 500, 100]) {
      if (g.hatFt <= h && g.hatFt > h - 150 && !heights.current.has(h)) {
        heights.current.add(h);
        say(h === 1000 ? `One thousand. ${g.unstable ? "Unstable." : "Stable."}` : h === 500 ? `Five hundred${g.unstable ? ". Unstable, go around." : "."}` : "One hundred.");
        return;
      }
    }
    const now = Date.now();
    const key = g.vDots < -1.3 ? "Glidepath. Too low." : g.vDots > 1.5 ? "High on glidepath." : Math.abs(g.hDots) > 1.5 ? (g.hDots > 0 ? "Right of centreline." : "Left of centreline.") : "";
    if (key && (key !== last.current.key || now - last.current.t > 8000)) { last.current = { key, t: now }; say(key); }
    if (!key) last.current.key = "";
  }, [g, a.setup.voice]);
}

export function ApproachScreen() {
  const a = useApproach();
  const L = useLive();
  useCallouts(a);
  const g = a.guide;
  const [open, setOpen] = useState(false);
  const airports = Array.from(new Set(a.ends.map((e) => e.airport)));
  const selAirport = a.setup.airport ?? a.end?.airport ?? airports[0] ?? "";
  const vsGood = g && a.vsFpm !== null && g.requiredVsFpm !== null ? Math.abs(a.vsFpm - g.requiredVsFpm) < 200 : null;

  return (
    <div className="stack approach">
      <div className="between wrap">
        <h1 className="title">Approach</h1>
        <div className="row wrap" style={{ gap: 8 }}>
          {a.end && <span className="pill ap-pill"><b>{a.end.airport} {a.end.ident}</b> · {a.setup.gpaDeg.toFixed(1)}°{a.auto ? " · lined up" : ""}</span>}
          <button className={`btn small${a.setup.voice ? " on" : ""}`} aria-pressed={a.setup.voice} onClick={() => { saveSetup({ voice: !a.setup.voice }); if (!a.setup.voice) { try { speechSynthesis.speak(new SpeechSynthesisUtterance("Callouts on")); } catch { /* no voice */ } } }}>{a.setup.voice ? "Callouts on" : "Callouts off"}</button>
          <button className="btn small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Runway and path</button>
        </div>
      </div>

      {open && (
        <section className="glass ap-setup">
          <label className="pf-f"><span>Airport</span>
            <select value={selAirport} onChange={(e) => saveSetup({ airport: e.target.value || null, runway: null })}>
              <option value="">Auto</option>
              {airports.map((c) => <option key={c} value={c}>{c} · {a.ends.find((e) => e.airport === c)?.airportName}</option>)}
            </select>
          </label>
          <label className="pf-f"><span>Runway</span>
            <select value={a.setup.runway ?? ""} onChange={(e) => saveSetup({ airport: e.target.value ? selAirport : null, runway: e.target.value || null })}>
              <option value="">Auto (planned or lined up)</option>
              {a.ends.filter((e) => e.airport === selAirport).map((e) => <option key={e.ident} value={e.ident}>{e.ident}</option>)}
            </select>
          </label>
          <label className="pf-f"><span>Glidepath angle °</span>
            <input inputMode="decimal" defaultValue={a.setup.gpaDeg.toFixed(1)} onBlur={(e) => { const n = Number(e.target.value); if (n >= 2 && n <= 6) saveSetup({ gpaDeg: n }); }} />
            <small>From the chart, usually 3.0</small>
          </label>
          <label className="pf-f"><span>Crossing height ft</span>
            <input inputMode="numeric" defaultValue={String(a.setup.tchFt)} onBlur={(e) => { const n = Number(e.target.value); if (n >= 20 && n <= 100) saveSetup({ tchFt: n }); }} />
            <small>TCH on the chart, usually 50</small>
          </label>
          <label className="pf-f"><span>Threshold elevation ft</span>
            <input inputMode="numeric" placeholder={a.end ? String(a.end.elevFt) : ""} defaultValue={a.setup.thrElevFt === null ? "" : String(a.setup.thrElevFt)} onBlur={(e) => { const v = e.target.value.trim(); const n = Number(v); saveSetup({ thrElevFt: v && Number.isFinite(n) ? n : null }); }} />
            <small>Blank uses the airport elevation</small>
          </label>
        </section>
      )}

      {!L.frame ? (
        <section className="glass ap-empty"><h2 className="h2">Waiting for your flight</h2><p className="muted">Connect your Bridge and fly. From about 15 nm out, this shows where the glidepath and centreline are for your runway, on any device.</p></section>
      ) : !a.end || !g ? (
        <section className="glass ap-empty"><h2 className="h2">No runway yet</h2><p className="muted">Load a plan with an arrival runway, pick one under Runway and path, or line up with a runway within 20 nm.</p></section>
      ) : (
        <>
          {g.state !== "established" && g.state !== "intercept" && (
            <p className="ap-state">{g.state === "landed" ? "Landed. Nice one." : g.state === "behind" ? `You're past the threshold of ${a.end.ident}.` : `Not on final for ${a.end.ident} yet: ${g.distNm > 0 ? `${g.distNm.toFixed(1)} nm out` : ""}. Guidance is shown anyway.`}</p>
          )}
          {g.unstable && <div className="ap-unstable" role="alert"><b>Unstable</b> {g.unstable}. Below 1,000 ft, consider a go-around.</div>}
          {g.state !== "landed" && <div className="ap-main">
            <section className="glass ap-raw">
              <DeviationScales g={g} />
              <div className={`ap-say t-${g.vTone}`}>{g.vText}</div>
              <div className={`ap-say t-${g.hTone}`}>{g.hText}</div>
            </section>
            <section className="glass ap-nums">
              <Num k="To threshold" v={g.distNm > 0 ? g.distNm.toFixed(1) : "0.0"} unit="nm" sub={a.gsKt ? `${Math.max(0, Math.round((g.distNm / a.gsKt) * 60 * 60))} s at ${fmt(a.gsKt)} kt` : undefined} />
              <Num k="Above threshold" v={fmt(g.hatFt)} unit="ft" sub={`Path here: ${fmt(g.hatFt - g.vertFt)} ft`} tone={g.vTone} />
              <Num k="Glidepath" v={`${g.vertFt >= 0 ? "+" : "−"}${fmt(Math.abs(g.vertFt))}`} unit="ft" sub={`${Math.abs(g.vDots).toFixed(1)} dot ${g.vDots >= 0 ? "high" : "low"}`} tone={g.vTone} />
              <Num k="Centreline" v={`${fmt(Math.abs(g.latFt))}`} unit={`ft ${g.latFt > 0 ? "R" : g.latFt < 0 ? "L" : ""}`} sub={`${Math.abs(g.hDots).toFixed(1)} dot`} tone={g.hTone} />
              <Num k="Vertical speed" v={a.vsFpm === null ? "—" : fmt(a.vsFpm)} unit="fpm" sub={g.requiredVsFpm !== null ? `Needed ${fmt(g.requiredVsFpm)}` : undefined} tone={vsGood === null ? undefined : vsGood ? "good" : "caution"} />
              <Num k="Wind" v={a.windHead === null ? "—" : `${a.windHead >= 0 ? "H" : "T"}${Math.abs(a.windHead)}`} unit="kt" sub={a.windCross === null ? undefined : `${Math.abs(a.windCross)} kt from the ${a.windCross > 0 ? "right" : a.windCross < 0 ? "left" : "front"}`} tone={a.windHead !== null && a.windHead < -10 ? "warning" : undefined} />
            </section>
          </div>}
          {g.state !== "landed" && <section className="glass ap-views">
            <Profile g={g} gpa={a.setup.gpaDeg} tch={a.setup.tchFt} />
            <PlanView g={g} />
          </section>}
        </>
      )}
      <p className="pf-legal">Built from the runway's position and your aircraft's true altitude, like a synthetic ILS. It doesn't read your aircraft's approach data, so check the glidepath angle and crossing height on the chart. For the sim only.</p>
    </div>
  );
}

/** A small guide shown on Home and the map while you're on final. Tap for the full Approach screen. */
export function MiniApproach() {
  const a = useApproach();
  const g = a.guide;
  if (!g || !a.end || !onFinal(g)) return null;
  return (
    <a className="glass ap-mini" href="#/approach" aria-label="Open the approach guide">
      <DeviationScales g={g} compact />
      <div className="ap-mini-t">
        <span className="ap-mini-k">{a.end.airport} {a.end.ident} · {g.distNm.toFixed(1)} nm · {fmt(g.hatFt)} ft</span>
        <b className={`t-${g.vTone}`}>{g.vText.split(":")[0]}</b>
        <b className={`t-${g.hTone}`}>{g.hText.split(":")[0]}</b>
        {g.unstable && <span className="ap-mini-u">Unstable: {g.unstable.toLowerCase()}</span>}
      </div>
    </a>
  );
}
