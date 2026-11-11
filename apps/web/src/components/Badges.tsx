/** Badges: milestones earned from the logbook (computed, never invented). */
import { useMemo } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { computeBadges, type Badge } from "@glidepath/flight-engine";

const GLYPH: Record<Badge["icon"], string> = {
  plane: "M21 15.5v-1.8l-8-5V4.5a1.5 1.5 0 0 0-3 0v4.2l-8 5v1.8l8-2.4v4.3l-2.2 1.6V21l3.7-1 3.7 1v-2l-2.2-1.6v-4.3z",
  feather: "M20 4c-7 0-12 5-13 12l-3 4M7 16h7M9 12h7.5M20 4c0 6-3 11-9 12",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  target: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
};
const HUE: Record<Badge["icon"], string> = { plane: "#0A84FF", feather: "#30D158", globe: "#64D2FF", clock: "#FF9F0A", moon: "#5E5CE6", star: "#FFD60A", target: "#FF453A", wind: "#40C8E0", route: "#BF5AF2" };

export function Badges({ flights }: { flights: FlightSummary[] }) {
  const badges = useMemo(() => computeBadges(flights), [flights]);
  const earned = badges.filter((b) => b.earned).length;
  const order = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || (b.progress ?? 0) - (a.progress ?? 0));
  return (
    <section className="glass badges">
      <div className="between" style={{ marginBottom: 12 }}>
        <span className="h2">Badges</span>
        <span className="faint" style={{ fontSize: 13 }}>{earned} of {badges.length} earned</span>
      </div>
      <div className="badge-grid">
        {order.map((b) => (
          <div key={b.id} className={`badge${b.earned ? " got" : ""}`} style={{ ["--hue" as string]: HUE[b.icon] }} title={b.how}>
            <span className="badge-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={GLYPH[b.icon]} /></svg></span>
            <span className="badge-t">{b.title}</span>
            <span className="badge-s">{b.earned ? (b.earnedAt ? new Date(b.earnedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Earned") : b.how}</span>
            {b.progress !== null && <span className="badge-bar"><i style={{ width: `${Math.round(b.progress * 100)}%` }} /><em>{b.progressText}</em></span>}
          </div>
        ))}
      </div>
    </section>
  );
}
