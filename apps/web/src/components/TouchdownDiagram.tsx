/**
 * Where the wheels met the runway, drawn on the runway that was used.
 * Uses the landing report's measured distance past the threshold and offset
 * from the centreline, and the runway's real length from the airport database.
 * Nothing is drawn that wasn't measured.
 */
import { useEffect, useState } from "react";
import type { LandingReport } from "@glidepath/protocol";
import { loadAirportDb } from "../data/airports";
import { fmt } from "../data/derive";

const TDZ_START = 500, TDZ_END = 3000, AIM = 1000;

export function TouchdownDiagram({ l }: { l: LandingReport }) {
  const rw = l.runway;
  const [len, setLen] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(150);
  useEffect(() => {
    if (!rw) return;
    let off = false;
    void loadAirportDb().then((db) => {
      const apt = db.nearest({ lat: l.lat, lon: l.lon }, { maxNm: 5 });
      const end = apt ? db.runwayEnds(apt.code).find((e) => e.ident.toUpperCase() === rw.ident.toUpperCase()) : null;
      if (!off && end) { setLen(end.lengthFt || null); setWidth(end.widthFt || 150); }
    }).catch(() => undefined);
    return () => { off = true; };
  }, [rw?.ident, l.lat, l.lon]);
  if (!rw) return null;

  const d = rw.distanceFromThresholdFt, off = rw.centrelineOffsetFt;
  const shown = Math.max(len ?? 0, d * 1.25, 6000);
  const W = 640, H = 150, X0 = 34, X1 = W - 18, CY = 70, HALF = 30;
  const x = (ft: number) => X0 + (Math.min(ft, shown) / shown) * (X1 - X0);
  const halfW = width / 2;
  const dotY = CY + Math.max(-1.25, Math.min(1.25, off / halfW)) * HALF;
  const inTdz = d >= TDZ_START && d <= TDZ_END;
  const where = d < TDZ_START ? "short of the touchdown zone" : inTdz ? "in the touchdown zone" : "past the touchdown zone (long)";
  const side = Math.abs(off) < 3 ? "on the centreline" : `${fmt(Math.abs(off))} ft ${off > 0 ? "right" : "left"} of the centreline`;
  const runwayEnd = len ? x(len) : X1;

  return (
    <figure className="td-fig" aria-label={`Touchdown ${fmt(d)} feet past the threshold of runway ${rw.ident}, ${side}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <rect x={X0} y={CY - HALF} width={runwayEnd - X0} height={HALF * 2} rx="3" className="td-rwy" />
        {!len && <text x={X1 - 4} y={CY - HALF - 6} textAnchor="end" className="td-note">runway length unknown</text>}
        <rect x={x(TDZ_START)} y={CY - HALF} width={x(TDZ_END) - x(TDZ_START)} height={HALF * 2} className="td-zone" />
        {[-22, -14, -6, 6, 14, 22].map((o) => <rect key={o} x={X0 + 3} y={CY + o - 2.5} width="14" height="5" className="td-mark" />)}
        <line x1={X0 + 24} y1={CY} x2={runwayEnd - 6} y2={CY} className="td-cl" />
        <rect x={x(AIM) - 12} y={CY - 20} width="24" height="8" className="td-mark" />
        <rect x={x(AIM) - 12} y={CY + 12} width="24" height="8" className="td-mark" />
        <text x={X0 + 2} y={CY + HALF + 18} className="td-lbl">{rw.ident}</text>
        <text x={x(TDZ_START)} y={CY - HALF - 6} className="td-note">touchdown zone</text>
        {[0, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000].filter((f) => f <= shown && f > 0).map((f) => (
          <g key={f}><line x1={x(f)} y1={CY + HALF + 4} x2={x(f)} y2={CY + HALF + 8} className="td-tick" /><text x={x(f)} y={CY + HALF + 20} textAnchor="middle" className="td-note">{f >= 1000 ? `${f / 1000}k` : f}</text></g>
        ))}
        <circle cx={x(d)} cy={dotY} r="11" className={`td-halo ${inTdz ? "ok" : "warn"}`} />
        <circle cx={x(d)} cy={dotY} r="5.5" className={`td-dot ${inTdz ? "ok" : "warn"}`} />
      </svg>
      <figcaption className="muted">Touched down <b>{fmt(d)} ft</b> past the threshold, {where}, {side}. {len ? `Runway ${fmt(len)} ft long.` : ""} Width exaggerated to show the offset.</figcaption>
    </figure>
  );
}
