/**
 * The moment you touch down: a calm summary of the landing, from the real landing report:
 * the grade inside a ring that fills to the score, then rate, g-force and the verdict.
 * Shown once per landing. Tap anywhere to close.
 */
import { useEffect, useRef, useState } from "react";
import type { LandingReport } from "@glidepath/protocol";
import { store, useApp } from "../data/store";
import { LandedMissions } from "./Missions";

const RING: Record<string, string> = { "A+": "#30D158", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };

export function Celebrate() {
  const landing = useApp((s) => s.landing);
  const [shown, setShown] = useState<LandingReport | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!landing) return;
    // Not for a landing that was already over when the app opened (compare with the flight's own clock).
    const now = store.get().frame?.t ?? Date.now();
    if (seen.current === null) { seen.current = landing.t; if (now - landing.t > 90_000) return; }
    else if (seen.current === landing.t) return;
    seen.current = landing.t;
    setShown(landing);
    const t = window.setTimeout(() => setShown(null), 7000);
    return () => clearTimeout(t);
  }, [landing]);
  if (!shown) return null;
  const fpm = shown.touchdownVsFpm;
  const score = typeof shown.score === "number" ? Math.max(0, Math.min(100, Math.round(shown.score))) : null;
  const C = 2 * Math.PI * 54;
  const ring = RING[shown.grade] ?? "#0A84FF";
  return (
    <div className="cel2" role="status" onClick={() => setShown(null)}>
      <div className="cel2-card glass strong">
        <span className="cel2-k">{shown.runway ? `Landed · Runway ${shown.runway.ident}` : "Touchdown"}</span>
        <div className="cel2-ring" style={{ ["--ring" as string]: ring }}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="54" className="cel2-track" />
            <circle cx="60" cy="60" r="54" className="cel2-fill" strokeDasharray={C} style={{ ["--off" as string]: String(C * (1 - (score ?? 0) / 100)), ["--full" as string]: String(C) }} />
          </svg>
          <b className="cel2-grade">{shown.grade}</b>
        </div>
        <dl className="cel2-stats">
          <div><dt>Rate</dt><dd className="data">{fpm != null ? `${Math.round(Math.abs(fpm))}` : "—"}<small>fpm</small></dd></div>
          <div><dt>G-force</dt><dd className="data">{shown.peakG != null ? shown.peakG.toFixed(2) : "—"}<small>g</small></dd></div>
          <div><dt>Score</dt><dd className="data">{score ?? "—"}<small>/100</small></dd></div>
        </dl>
        <span className="cel2-v">{shown.verdict}</span>
        <LandedMissions />
        <a className="btn small" href="#/flight" onClick={(e) => e.stopPropagation()}>See the debrief</a>
      </div>
    </div>
  );
}
