/** Approach coach: the last 10 nm against a 3° path, the 1000 ft and 500 ft gates, and what to work on. */
import { useMemo } from "react";
import type { LandingReport, TelemetryFrame } from "@glidepath/protocol";
import { reviewApproach } from "@glidepath/flight-engine";

const W = 640, H = 240, PL = 46, PR = 14, PT = 14, PB = 30;

export function ApproachCoach({ frames, landing }: { frames: TelemetryFrame[] | null; landing: LandingReport | null | undefined }) {
  const r = useMemo(() => (frames ? reviewApproach(frames, landing) : null), [frames, landing]);
  if (!r) return null;
  const maxNm = Math.min(10, Math.max(4, Math.ceil(Math.max(...r.points.map((p) => p.distNm)))));
  const maxFt = Math.max(1500, Math.ceil(Math.max(maxNm * 318, ...r.points.map((p) => p.aglFt)) / 500) * 500);
  const x = (nm: number) => PL + (1 - nm / maxNm) * (W - PL - PR);
  const y = (ft: number) => PT + (1 - Math.min(ft, maxFt) / maxFt) * (H - PT - PB);
  const path = r.points.filter((p) => p.distNm <= maxNm).map((p, i) => `${i ? "L" : "M"}${x(p.distNm).toFixed(1)},${y(p.aglFt).toFixed(1)}`).join("");
  const band = `M${x(maxNm)},${y(maxNm * 318 + 150)} L${x(0)},${y(150)} L${x(0)},${y(0)} L${x(maxNm)},${y(Math.max(0, maxNm * 318 - 150))}Z`;
  const ticksFt = Array.from({ length: Math.floor(maxFt / 1000) + 1 }, (_, i) => i * 1000);
  return (
    <section className="glass pad coach">
      <div className="between wrap" style={{ gap: 8 }}>
        <div>
          <div className="eyebrow">Approach coach</div>
          <h2 className="h2" style={{ margin: "4px 0 0" }}>Your last {maxNm} nm{r.refSpeedKt ? `, about ${r.refSpeedKt} kt on short final` : ""}</h2>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {r.gates.map((g) => <span key={g.heightFt} className={`gate ${g.stable ? "ok" : "bad"}`}>{g.heightFt} ft {g.stable ? "stable" : "not stable"}</span>)}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="coach-chart" role="img" aria-label="Height above the runway against distance, compared with a 3 degree path">
        {ticksFt.map((ft) => <g key={ft}><line x1={PL} x2={W - PR} y1={y(ft)} y2={y(ft)} className="grid" /><text x={PL - 8} y={y(ft) + 4} textAnchor="end">{ft ? `${ft / 1000}k` : "0"}</text></g>)}
        {Array.from({ length: maxNm + 1 }, (_, i) => i).filter((n) => n % 2 === 0 || maxNm <= 5).map((n) => <text key={n} x={x(n)} y={H - 8} textAnchor="middle">{n} nm</text>)}
        <path d={band} className="band" />
        <line x1={x(maxNm)} y1={y(maxNm * 318)} x2={x(0)} y2={y(0)} className="ideal" />
        {[1000, 500].map((g) => <line key={g} x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} className="gateline" />)}
        <path d={path} className="actual" />
        <circle cx={x(0)} cy={y(0)} r={5} className="td" />
      </svg>
      <div className="coach-legend faint"><span><i className="l-actual" />Your path</span><span><i className="l-ideal" />3° path (±150 ft)</span><span><i className="l-gate" />1000 / 500 ft gates</span></div>
      <ul className="coach-notes">
        {r.notes.map((n, i) => <li key={i} className={n.good ? "good" : "bad"}><span aria-hidden="true">{n.good ? "✓" : "!"}</span>{n.text}</li>)}
      </ul>
    </section>
  );
}
