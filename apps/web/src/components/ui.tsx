import type { ReactNode } from "react";
import { useApp } from "../data/store";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  home: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></svg>,
  map: () => <svg viewBox="0 0 24 24" {...P}><path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2zM9 4v14M15 6v14" /></svg>,
  flight: () => <svg viewBox="0 0 24 24" {...P}><path d="M21 15.5v-1.8l-8-5V4.5a1.5 1.5 0 0 0-3 0v4.2l-8 5v1.8l8-2.4v4.3l-2.2 1.6V21l3.7-1 3.7 1v-2l-2.2-1.6v-4.3z" /></svg>,
  book: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6" /></svg>,
  tower: () => <svg viewBox="0 0 24 24" {...P}><path d="M8 3h8l-1 5H9zM9 8l-1 13h8L15 8M6 21h12M10.5 13h3" /></svg>,
  gear: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>,
  more: () => <svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>,
  expand: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  target: () => <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>,
  layers: () => <svg viewBox="0 0 24 24" {...P}><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" /></svg>,
  close: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  back: () => <svg viewBox="0 0 24 24" {...P}><path d="M15 5l-7 7 7 7" /></svg>,
  spark: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7zM19 16c.3 1.6 1.1 2.4 2.7 2.7-1.6.3-2.4 1.1-2.7 2.7-.3-1.6-1.1-2.4-2.7-2.7 1.6-.3 2.4-1.1 2.7-2.7z" /></svg>,
  speaker: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 10v4h4l5 4V6L8 10zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>,
  send: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>,
  download: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14" /></svg>,
};

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#0D1730" />
      <path d="M6 8 L21 21" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15 25 H27" stroke="#EEF3FC" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function ConnPill() {
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const sim = useApp((s) => s.status?.simState);
  const simName = useApp((s) => s.status?.simulator?.name);
  if (mode === "demo") return <span className="pill demo"><span className="dot" />Demo flight</span>;
  if (mode === "none") return <span className="pill"><span className="dot" />Not connected</span>;
  if (conn === "live") {
    if (sim === "connected") return <span className="pill live" title={simName}><span className="dot" />{simName?.replace("Microsoft Flight Simulator", "MSFS") ?? "Live"}</span>;
    return <span className="pill wait"><span className="dot" />Bridge connected, waiting for sim</span>;
  }
  if (conn === "connecting" || conn === "reconnecting") return <span className="pill wait"><span className="dot" />{conn === "connecting" ? "Connecting…" : "Reconnecting…"}</span>;
  return <span className="pill bad"><span className="dot" />{conn === "unauthorised" ? "Pairing key rejected" : "Bridge unreachable"}</span>;
}

export function Tile({ k, v, unit, na }: { k: string; v: ReactNode; unit?: string; na?: boolean }) {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      {na ? <div className="v na">Not available</div> : <div className="v">{v}{unit && <span className="unit">{unit}</span>}</div>}
    </div>
  );
}

export function Kv({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <div className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export function Notice({ children, info }: { children: ReactNode; info?: boolean }) {
  return <div className={`notice${info ? " info" : ""}`}>{children}</div>;
}

export function Grade({ grade, score }: { grade: string; score?: number }) {
  const cls = grade.startsWith("A") ? "" : grade === "B" || grade === "C" ? " mid" : " low";
  return <span className={`grade${cls}`} title={score !== undefined ? `${score} / 100` : undefined}>{grade}</span>;
}

export function Section({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass pad ${className ?? ""}`}>
      <div className="between" style={{ marginBottom: 12 }}><h2 className="h2">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

export function onOff(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "—" : v ? "On" : "Off";
}
