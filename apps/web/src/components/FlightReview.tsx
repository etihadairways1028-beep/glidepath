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
import { activeDemo } from "../data/demo";
import { useLive } from "../data/derive";
import { store, useApp } from "../data/store";

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

/** Shown for the moment the flight's recording is still loading, so the score never changes in front of you. */
export function ReviewPending() {
  return (
    <div className="glass strong review rv-pending" role="status" aria-live="polite">
      <div className="rv-pend-ring" aria-hidden="true" />
      <div><span className="kicker">Flight review</span><b>Scoring your flight…</b><span className="faint">Going through take-off, handling, approach and landing.</span></div>
    </div>
  );
}

/** The coaching question for Copilot, built from the real review (scores and notes). */
function coachQuestion(f: FlightSummary, r: ReturnType<typeof scoreFlight>): string {
  const parts = r.parts.map((p) => `${p.label} ${p.score}/100 (${p.line})`).join("; ");
  const work = r.work.length ? ` To work on: ${r.work.join(" ")}` : "";
  return `Coach me on my ${f.departureIcao ?? ""}-${f.arrivalIcao ?? ""} flight${f.aircraft?.icaoType ? ` in the ${f.aircraft.icaoType}` : ""}. Score ${r.score}/100. ${parts}.${work} What should I do differently next time? Give me 2-3 concrete tips.`;
}

/** Concrete technique for each part of the review (for simulation), the way an instructor would put it. */
const TIPS: Record<string, string[]> = {
  takeoff: ["Rotate smoothly at about 2 to 3° a second; don't snatch the nose up.", "Hold the take-off attitude (around 15° in an airliner) and let the speed settle before chasing it."],
  handling: ["Stay at or below 250 kt under 10,000 ft, and keep the bank within about 25 to 30°.", "Taxi at 20 kt or less on straight taxiways and about 10 kt in turns."],
  approach: ["Be fully configured and on speed by 1,000 ft: that's a stable approach.", "Follow a 3° path: about 300 ft per nautical mile, so a descent rate of roughly 5 × your groundspeed (140 kt ≈ 700 fpm).", "If you're low, level off and let the path come to you rather than diving at it."],
  landing: ["Keep the descent rate steady down to about 30 ft, then a small flare of 2 to 3°.", "Aim for the touchdown zone, 1,000 to 2,000 ft past the threshold.", "After touchdown, lower the nose gently; don't push it down."],
  time: ["Push back on time and allow for a normal taxi; the plan's times assume one."],
  fuel: ["Load the plan's block fuel, then check fuel at top of descent against the planned landing fuel."],
};
/** Coaching from the real review, without any AI: the weakest parts first, with what to do differently. */
export function builtinCoach(r: ReturnType<typeof scoreFlight>): string {
  const weak = [...r.parts].filter((p) => (p.score ?? 100) < 95).sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 2);
  if (!weak.length) return `Score ${r.score}: a very tidy flight, nothing below 95. To keep improving, try a crosswind, a shorter runway or a manual approach from 3,000 ft.`;
  const lines = weak.map((p) => `${p.label} (${p.score}/100): ${p.line}.\n${(TIPS[p.id] ?? []).map((t) => `• ${t}`).join("\n")}`);
  return `Score ${r.score}. The most to gain here:\n\n${lines.join("\n\n")}${r.work.length ? `\n\nFrom your review: ${r.work.join(" ")}` : ""}`;
}

/** Open Copilot and ask a question there. `builtin` answers it if no AI is available. */
export function askCopilot(show: string, send: string, builtin?: string) {
  try { sessionStorage.setItem("glidepath.ask", JSON.stringify({ show, send, builtin })); } catch { /* private mode */ }
  location.hash = "#/copilot";
}

export function ReviewScore({ flight, frames }: { flight: FlightSummary; frames: TelemetryFrame[] | null }) {
  const r = useMemo(() => scoreFlight(flight, frames), [flight, frames]);
  // Copilot coaches from exactly this review (same numbers), even when the question is typed there later.
  useEffect(() => { if (r.score !== null) try { sessionStorage.setItem(`glidepath.coach.${flight.id}`, builtinCoach(r)); } catch { /* private mode */ } }, [r, flight.id]);
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
      <div className="rv-ask">
        <button className="btn" onClick={() => askCopilot("How do I improve on this flight?", coachQuestion(flight, r), builtinCoach(r))}><span aria-hidden="true">✦ </span>How do I improve?</button>
        <span className="faint">Copilot coaches you through this flight's weakest part.</span>
      </div>
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
    // The demo has no Bridge to end the flight: run the rest of the recording (taxi in, on block) so it completes for real.
    if (mode === "demo") {
      activeDemo()?.seek(1);
      // Open the review once the demo has really finished the flight (a tick or two), so it shows as completed.
      for (let i = 0; i < 30 && store.get().lastFlight?.status !== "completed"; i++) await new Promise((r) => setTimeout(r, 100));
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
