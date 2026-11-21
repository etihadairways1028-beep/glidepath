/**
 * The moment you touch down: your grade lands on screen with your fpm, and a great landing
 * gets confetti. Shown once per landing, from the real landing report. Tap anywhere to close.
 */
import { useEffect, useRef, useState } from "react";
import type { LandingReport } from "@glidepath/protocol";
import { store, useApp } from "../data/store";

const GOOD = new Set(["A+", "A"]);
const COLORS = ["#64D2FF", "#0A84FF", "#5E5CE6", "#BF5AF2", "#30D158", "#FFD60A", "#FF9F0A"];

function confetti(canvas: HTMLCanvasElement, big: boolean): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => undefined;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr), H = (canvas.height = innerHeight * dpr);
  const n = big ? 170 : 70;
  const ps = Array.from({ length: n }, (_, i) => ({
    x: W * (0.15 + Math.random() * 0.7), y: H * (0.62 + Math.random() * 0.1),
    vx: (Math.random() - 0.5) * 16 * dpr, vy: -(10 + Math.random() * 15) * dpr,
    r: (3 + Math.random() * 5) * dpr, a: Math.random() * Math.PI, va: (Math.random() - .5) * .3, c: COLORS[i % COLORS.length]!, s: Math.random() > .5,
  }));
  let raf = 0, t0 = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(2, (now - t0) / 16.7); t0 = now;
    c.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of ps) {
      p.vy += 0.32 * dpr * dt; p.vx *= 0.992; p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      if (p.y < H + 20) alive++;
      c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = p.c;
      if (p.s) c.fillRect(-p.r, -p.r / 2.4, p.r * 2, p.r / 1.2); else { c.beginPath(); c.arc(0, 0, p.r / 1.6, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    if (alive) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function Celebrate() {
  const landing = useApp((s) => s.landing);
  const [shown, setShown] = useState<LandingReport | null>(null);
  const seen = useRef<number | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
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
  useEffect(() => {
    if (!shown || !cv.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!["A+", "A", "B"].includes(shown.grade)) return;
    return confetti(cv.current, GOOD.has(shown.grade));
  }, [shown]);
  if (!shown) return null;
  const fpm = shown.touchdownVsFpm;
  return (
    <div className={`cel g-${shown.grade.replace("+", "p")}`} role="status" onClick={() => setShown(null)}>
      <canvas ref={cv} className="cel-cv" aria-hidden="true" />
      <div className="cel-card">
        <span className="cel-k">{shown.runway ? `Landed on ${shown.runway.ident}` : "Touchdown"}</span>
        <b className="cel-grade">{shown.grade}</b>
        <span className="cel-fpm data">{fpm != null ? `${Math.round(Math.abs(fpm))} fpm` : "—"}{shown.peakG != null ? ` · ${shown.peakG.toFixed(2)} g` : ""}</span>
        <span className="cel-v">{shown.verdict}</span>
        <a className="btn small" href="#/flight" onClick={(e) => e.stopPropagation()}>See the debrief</a>
      </div>
    </div>
  );
}
