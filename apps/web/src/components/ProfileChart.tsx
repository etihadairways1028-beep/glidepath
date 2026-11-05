/** Altitude (and optionally groundspeed) against time, drawn from the recorded trail. */
import type { TrailPoint } from "../data/store";

export function ProfileChart({ trail, height = 180, showSpeed = false, marks = [] }: { trail: TrailPoint[]; height?: number; showSpeed?: boolean; marks?: Array<{ t: number; label: string }> }) {
  const W = 900, H = height, L = 56, R = 16, T = 14, B = 24;
  if (trail.length < 2) return <div className="faint" style={{ padding: "24px 0", textAlign: "center" }}>The profile appears once the aircraft starts moving.</div>;
  const t0 = trail[0]!.t, t1 = trail[trail.length - 1]!.t;
  const maxAlt = Math.max(1000, ...trail.map((p) => p.alt));
  const top = Math.ceil(maxAlt / 5000) * 5000;
  const maxGs = Math.max(100, ...trail.map((p) => p.gs));
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (a: number) => H - B - (a / top) * (H - T - B);
  const ys = (g: number) => H - B - (g / maxGs) * (H - T - B);
  const step = Math.max(1, Math.floor(trail.length / 600));
  const pts = trail.filter((_, i) => i % step === 0 || i === trail.length - 1);
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.alt).toFixed(1)}`).join(" ");
  const spd = pts.map((p) => `${x(p.t).toFixed(1)},${ys(p.gs).toFixed(1)}`).join(" ");
  const ticks = [0, top / 2, top];
  const mins = (t1 - t0) / 60000;
  const tickEvery = mins > 600 ? 120 : mins > 180 ? 60 : mins > 60 ? 15 : 5;
  const timeTicks: number[] = [];
  for (let m = tickEvery; m < mins; m += tickEvery) timeTicks.push(t0 + m * 60000);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Altitude profile">
      <defs>
        <linearGradient id="pf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
      </defs>
      {ticks.map((a) => (
        <g key={a}>
          <line x1={L} x2={W - R} y1={y(a)} y2={y(a)} stroke="rgba(176,200,255,0.1)" />
          <text x={L - 8} y={y(a) + 4} textAnchor="end">{a === 0 ? "0" : `${Math.round(a / 1000)}k ft`}</text>
        </g>
      ))}
      {timeTicks.map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{Math.round((t - t0) / 60000)}m</text>)}
      <polygon points={`${x(t0)},${y(0)} ${line} ${x(t1)},${y(0)}`} fill="url(#pf)" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
      {showSpeed && <polyline points={spd} fill="none" stroke="var(--hold)" strokeWidth="1.4" strokeDasharray="4 4" opacity="0.8" />}
      {marks.filter((m) => m.t >= t0 && m.t <= t1).map((m) => (
        <g key={m.label + m.t}>
          <line x1={x(m.t)} x2={x(m.t)} y1={T} y2={H - B} stroke="rgba(238,243,252,0.18)" strokeDasharray="2 4" />
          <text x={x(m.t) + 4} y={T + 10} style={{ fill: "var(--ink)" }}>{m.label}</text>
        </g>
      ))}
      <circle cx={x(t1)} cy={y(trail[trail.length - 1]!.alt)} r="4.5" fill="#fff" stroke="var(--accent)" strokeWidth="2.5" />
    </svg>
  );
}
