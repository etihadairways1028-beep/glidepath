/** Every landing you've made, at a glance: touchdown rate per flight, best, average and trend. Tap a bar to reopen that debrief. */
import { useMemo } from "react";
import type { FlightSummary } from "@glidepath/protocol";

const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };

export function LandingHistory({ flights }: { flights: FlightSummary[] }) {
  const rows = useMemo(() => flights
    .filter((f) => f.status === "completed")
    .flatMap((f) => f.landings.filter((l) => l.touchdownVsFpm !== null).map((l) => ({ id: f.id, at: l.t ?? f.wheelsDownAt ?? f.startedAt, fpm: Math.round(Math.abs(l.touchdownVsFpm!)), g: l.peakG, grade: l.grade ?? null, apt: f.arrivalIcao, rwy: l.runway?.ident ?? null, type: f.aircraft?.icaoType ?? null })))
    .sort((a, b) => a.at - b.at), [flights]);
  if (rows.length < 2) return null;
  const last = rows.slice(-40);
  const max = Math.max(400, ...last.map((r) => r.fpm));
  const avg = Math.round(rows.reduce((s, r) => s + r.fpm, 0) / rows.length);
  const best = rows.reduce((a, b) => (b.fpm < a.fpm ? b : a));
  const recent = rows.slice(-5), before = rows.slice(-10, -5);
  const trend = before.length ? Math.round(recent.reduce((s, r) => s + r.fpm, 0) / recent.length - before.reduce((s, r) => s + r.fpm, 0) / before.length) : null;
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <section className="glass pad landing-history">
      <div className="between wrap" style={{ gap: 10 }}>
        <div>
          <div className="eyebrow">Every landing</div>
          <h2 className="h2" style={{ margin: "4px 0 0" }}>{rows.length} landings, {avg} fpm on average</h2>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <a className="stat-chip lh-chip" href={`#/logbook/${best.id}`}><b className="data">{best.fpm}</b><span>best fpm · {best.apt ?? "—"}</span></a>
          {trend !== null && <div className="stat-chip lh-chip"><b className="data" style={{ color: trend <= 0 ? "#30D158" : "#FF9F0A" }}>{trend <= 0 ? "↓" : "↑"} {Math.abs(trend)}</b><span>fpm, last 5 vs 5 before</span></div>}
        </div>
      </div>
      <div className="lh-chart" role="list" aria-label="Touchdown rate for each landing, oldest first">
        <span className="lh-line" style={{ bottom: `${(180 / max) * 100}%` }}><em>180</em></span>
        <span className="lh-line hard" style={{ bottom: `${(600 / max) * 100}%`, display: max >= 600 ? undefined : "none" }}><em>600 hard</em></span>
        {last.map((r, i) => (
          <a key={`${r.id}-${i}`} role="listitem" className="lh-bar" href={`#/logbook/${r.id}`} title={`${date(r.at)} · ${r.apt ?? ""}${r.rwy ? ` ${r.rwy}` : ""} · ${r.fpm} fpm${r.g ? ` · ${r.g.toFixed(2)} G` : ""}${r.grade ? ` · ${r.grade}` : ""}${r.type ? ` · ${r.type}` : ""}`}>
            <span style={{ height: `${Math.max(3, (r.fpm / max) * 100)}%`, background: GRADE_COLOR[r.grade ?? ""] ?? "#8E9AAF" }} />
          </a>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Your last {last.length} landings, oldest on the left. Tap a bar to open that debrief; use "Best landing" below to sort every flight by touchdown.</p>
    </section>
  );
}
