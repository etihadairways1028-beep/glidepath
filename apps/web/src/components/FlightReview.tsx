/**
 * After landing: "Flight complete?" and, on Yes, the full review.
 *
 * The overall score is a weighted mix of what was actually measured on this
 * flight. Parts with no data (no plan, no take-off recorded…) are left out
 * rather than guessed, and the card says which parts counted.
 */
import { useEffect, useMemo, useState } from "react";
import type { FlightSummary, TelemetryFrame } from "@glidepath/protocol";
import { gradeFor, reviewApproach } from "@glidepath/flight-engine";
import { activeBridge } from "../data/bridge";
import { useLive } from "../data/derive";
import { useApp } from "../data/store";

interface Part { id: string; label: string; score: number; weight: number; line: string }

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export function scoreFlight(f: FlightSummary, frames: TelemetryFrame[] | null) {
  const parts: Part[] = [];
  const good: string[] = [];
  const work: string[] = [];
  const land = f.landings.at(-1);
  if (f.takeoff) {
    parts.push({ id: "takeoff", label: "Take-off", score: f.takeoff.score, weight: 15, line: f.takeoff.verdict });
    for (const n of f.takeoff.notes) (n.level === "good" ? good : n.level === "improve" ? work : []).push(n.text);
  }
  const s = f.stats;
  if (s) {
    let h = 100;
    const notes: string[] = [];
    if (s.overspeedBelow10kS > 5) { h -= Math.min(30, s.overspeedBelow10kS * 0.5); notes.push(`${Math.round(s.overspeedBelow10kS)} s above 250 kt below 10,000 ft`); }
    if (s.steepBankS > 3) { h -= Math.min(20, s.steepBankS); notes.push(`${Math.round(s.steepBankS)} s banked beyond 30°`); }
    if (s.fastTaxiS > 5) { h -= Math.min(15, s.fastTaxiS * 0.5); notes.push(`${Math.round(s.fastTaxiS)} s taxiing above 30 kt`); }
    if (s.maxG != null && s.maxG > 1.6) { h -= 15; notes.push(`${s.maxG.toFixed(2)} g at the most`); }
    parts.push({ id: "handling", label: "Handling", score: clamp(h), weight: 15, line: notes.length ? notes.join(", ") : "Smooth: speed limits, bank and taxi speed all kept" });
    if (notes.length) work.push(...notes.map((n) => n[0]!.toUpperCase() + n.slice(1) + "."));
    else good.push("Speed, bank and taxi speed stayed inside the usual limits all flight.");
  }
  const ap = frames && land ? reviewApproach(frames, land) : null;
  if (ap && ap.gates.length) {
    // Stable at the gates, less for wandering off a 3° path on the way down.
    const dev = Math.abs(ap.maxDevFt ?? 0);
    const sc = ap.gates.reduce((a, g) => a + (g.stable ? 100 : 40), 0) / ap.gates.length - Math.min(30, Math.max(0, (dev - 150) / 10));
    const unstable = ap.gates.filter((g) => !g.stable);
    parts.push({ id: "approach", label: "Approach", score: clamp(sc), weight: 20, line: (unstable.length ? `Not stable at ${unstable.map((g) => `${g.heightFt} ft (${g.reasons.join(", ")})`).join(" and ")}` : `Stable at ${ap.gates.map((g) => `${g.heightFt}`).join(" and ")} ft`) + (dev > 150 ? `; up to ${Math.round(dev)} ft off a 3° path` : "") });
    for (const n of ap.notes.slice(0, 3)) (n.good ? good : work).push(n.text);
  }
  if (land) {
    parts.push({ id: "landing", label: "Landing", score: land.score, weight: 35, line: `${Math.round(Math.abs(land.touchdownVsFpm ?? 0))} fpm, ${land.peakG != null ? `${land.peakG.toFixed(2)} g` : ""}`.replace(/, $/, "") });
    const best = [...land.components].filter((c) => c.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (best[0] && (best[0].score ?? 0) >= 85) good.push(`${best[0].label}: ${best[0].note}`);
    const worst = best.at(-1);
    if (worst && (worst.score ?? 100) < 70) work.push(`${worst.label}: ${worst.note}`);
  }
  const p = f.plan;
  if (p?.scheduledIn && f.onBlockAt) {
    const late = Math.round((f.onBlockAt - p.scheduledIn * 1000) / 60000);
    const sc = Math.abs(late) <= 5 ? 100 : 100 - 3 * (Math.abs(late) - 5);
    parts.push({ id: "time", label: "On time", score: clamp(Math.max(40, sc)), weight: 10, line: Math.abs(late) <= 2 ? "On block on time" : late < 0 ? `${-late} min early` : `${late} min late` });
  }
  if (p?.fuelLandingKg && f.fuelEndKg != null) {
    const diff = f.fuelEndKg - p.fuelLandingKg;
    const pct = diff / p.fuelLandingKg;
    const sc = pct >= -0.03 ? 100 : 100 + pct * 400;
    parts.push({ id: "fuel", label: "Fuel", score: clamp(Math.max(30, sc)), weight: 5, line: `${diff >= 0 ? "+" : ""}${Math.round(diff).toLocaleString()} kg against the planned landing fuel` });
  }
  const w = parts.reduce((a, x) => a + x.weight, 0);
  const score = w ? Math.round(parts.reduce((a, x) => a + x.score * x.weight, 0) / w) : null;
  return { parts, score, grade: score === null ? null : gradeFor(score), good: [...new Set(good)].slice(0, 4), work: [...new Set(work)].slice(0, 4) };
}

const VERDICT: Record<string, string> = { "A+": "Outstanding flight", A: "Excellent flight", B: "Good flight", C: "Solid, with things to tidy up", D: "Room to improve", F: "A tough one" };

export function ReviewScore({ flight, frames }: { flight: FlightSummary; frames: TelemetryFrame[] | null }) {
  const r = useMemo(() => scoreFlight(flight, frames), [flight, frames]);
  if (r.score === null) return null;
  const C = 2 * Math.PI * 52;
  return (
    <section className="glass strong review">
      <div className="rv-top">
        <div className="rv-ring" aria-label={`Score ${r.score} out of 100, grade ${r.grade}`}>
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" className="rv-track" />
            <circle cx="60" cy="60" r="52" className={`rv-arc g-${(r.grade ?? "F").replace("+", "p")}`} strokeDasharray={`${(C * r.score) / 100} ${C}`} transform="rotate(-90 60 60)" />
          </svg>
          <div className="rv-num"><b>{r.score}</b><span>{r.grade}</span></div>
        </div>
        <div className="rv-head">
          <div className="rv-cap">Flight review</div>
          <h2>{VERDICT[r.grade!]}</h2>
          <p>{flight.departureIcao ?? "····"} → {flight.arrivalIcao ?? "····"}{flight.aircraft?.icaoType ? ` · ${flight.aircraft.icaoType}` : ""} · scored on {r.parts.map((p) => p.label.toLowerCase()).join(", ")}</p>
        </div>
      </div>
      <div className="rv-parts">
        {r.parts.map((p) => (
          <div className="rv-part" key={p.id}>
            <div className="rv-pt"><span>{p.label}</span><b>{p.score}</b></div>
            <div className="rv-bar"><i style={{ width: `${p.score}%` }} className={p.score >= 85 ? "hi" : p.score >= 65 ? "mid" : "lo"} /></div>
            <div className="rv-line">{p.line}</div>
          </div>
        ))}
      </div>
      {(r.good.length > 0 || r.work.length > 0) && (
        <div className="rv-notes">
          {r.good.length > 0 && <div><h3>What went well</h3><ul>{r.good.map((t) => <li key={t} className="g">{t}</li>)}</ul></div>}
          {r.work.length > 0 && <div><h3>To work on</h3><ul>{r.work.map((t) => <li key={t} className="w">{t}</li>)}</ul></div>}
        </div>
      )}
    </section>
  );
}

/** Once you've landed and slowed down: "Flight complete?" Yes ends the flight and opens the review. */
export function FlightCompletePrompt() {
  const L = useLive();
  const mode = useApp((s) => s.mode);
  const landing = useApp((s) => s.landing);
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = L.flight;
  const id = f?.id ?? null;
  useEffect(() => { if (id) { try { setAsked(localStorage.getItem("glidepath.reviewAsked") ?? null); } catch { /* private mode */ } } }, [id]);
  const slow = (L.frame?.speed.gsKt ?? 99) < 25;
  const show = !!f && !!f.wheelsDownAt && !L.airborne && slow && asked !== id && (mode === "bridge" || mode === "demo") && f.status !== "completed";
  if (!show || !f) return null;
  const remember = () => { try { localStorage.setItem("glidepath.reviewAsked", f.id); } catch { /* private mode */ } setAsked(f.id); };
  const yes = async () => {
    setBusy(true); setErr(null);
    if (mode === "bridge") {
      try { await activeBridge()?.post("/api/flight/complete", {}); }
      catch (e) { setBusy(false); setErr((e as Error).message); return; }
    }
    remember();
    location.hash = `#/review/${f.id}`;
  };
  const fpm = landing?.touchdownVsFpm ?? f.landings.at(-1)?.touchdownVsFpm ?? null;
  return (
    <div className="fc-sheet glass strong" role="dialog" aria-label="Flight complete?">
      <div className="fc-ic" aria-hidden="true">✓</div>
      <div className="fc-body">
        <b>You've landed{f.arrivalIcao ? ` at ${f.arrivalIcao}` : ""}. Flight complete?</b>
        <span>{fpm != null ? `Touchdown ${Math.round(Math.abs(fpm))} fpm${f.arrivalRunway ? ` on ${f.arrivalRunway}` : ""}. ` : ""}Yes ends the flight here and shows your full review.</span>
        {err && <span className="fc-err">{err}</span>}
      </div>
      <div className="fc-btns">
        <button className="btn ghost" onClick={remember} disabled={busy}>Not yet</button>
        <button className="btn primary" onClick={() => void yes()} disabled={busy}>{busy ? "Finishing…" : "Yes, review it"}</button>
      </div>
    </div>
  );
}
