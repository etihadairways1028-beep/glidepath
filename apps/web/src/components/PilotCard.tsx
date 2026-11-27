/**
 * Pilot card: one shareable picture of your whole logbook (every route on a map,
 * hours, flights, distance, landing grades and most-visited airports), drawn on a
 * canvas from your own completed flights. Nothing is estimated or invented: a total
 * that isn't known is left out.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FlightSummary } from "@glidepath/protocol";
import { loadAirportDb } from "../data/airports";
import { drawLand, fit, greatCircle, loadLand, roundRect, type ArtPt } from "./routeArt";
import { gradeOf } from "../screens/Home";

const W = 1080, H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';
const INK = "#F5F7FA", QUIET = "rgba(235,240,250,.58)", BG = "#0B0D12", SEA = "#10141D", LAND = "#1E2433";
const GRADES = ["A+", "A", "B", "C", "D", "F"] as const;
const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };

export interface PilotTotals { flights: number; hours: number; nm: number; landings: number; avgScore: number | null; best: string | null; grades: Record<string, number>; airports: [string, number][]; since: number | null }

export function pilotTotals(done: FlightSummary[]): PilotTotals {
  const grades: Record<string, number> = {}; let sum = 0, n = 0, bestScore = -1, best: string | null = null;
  const ap = new Map<string, number>();
  for (const f of done) {
    for (const l of f.landings ?? []) {
      if (typeof l.score !== "number") continue;
      const g = gradeOf(l.score); grades[g] = (grades[g] ?? 0) + 1; sum += l.score; n++;
      if (l.score > bestScore) { bestScore = l.score; best = `${g} at ${f.arrivalIcao ?? "····"}`; }
    }
    for (const c of [f.departureIcao, f.arrivalIcao]) if (c) ap.set(c, (ap.get(c) ?? 0) + 1);
  }
  const hours = done.reduce((a, f) => a + Math.max(0, (f.onBlockAt ?? f.endedAt ?? f.startedAt) - (f.offBlockAt ?? f.startedAt)), 0) / 3600000;
  return {
    flights: done.length, hours, nm: done.reduce((a, f) => a + (f.distanceNm ?? 0), 0), landings: n,
    avgScore: n ? sum / n : null, best, grades,
    airports: [...ap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
    since: done.length ? Math.min(...done.map((f) => f.startedAt)) : null,
  };
}

async function drawPilotCard(done: FlightSummary[], name: string): Promise<Blob> {
  const T = pilotTotals(done);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = BG; c.fillRect(0, 0, W, H);

  c.font = `700 30px ${FONT}`; c.fillStyle = QUIET; c.fillText("GLIDEPATH  ·  PILOT CARD", 72, 110);
  if (T.since) { c.textAlign = "right"; c.fillText(`Since ${new Date(T.since).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`, W - 72, 110); c.textAlign = "left"; }
  let size = 96; c.font = `800 ${size}px ${FONT}`; const who = name || "My logbook";
  while (c.measureText(who).width > W - 144 && size > 56) { size -= 6; c.font = `800 ${size}px ${FONT}`; }
  c.fillStyle = INK; c.fillText(who, 68, 215);

  // Map with every route flown
  const box = { x: 60, y: 260, w: W - 120, h: 520 };
  const db = await loadAirportDb();
  const where = (code: string | null | undefined, p?: { icao: string; lat: number; lon: number }): ArtPt | null => {
    if (p && p.icao === code) return { lat: p.lat, lon: p.lon };
    const a = code ? db.get(code) : null; return a ? { lat: a.lat, lon: a.lon } : null;
  };
  const routes: ArtPt[][] = [];
  for (const f of done) { const a = where(f.departureIcao, f.plan?.origin), b = where(f.arrivalIcao, f.plan?.destination); if (a && b) routes.push(greatCircle(a, b, 48)); }
  c.save(); roundRect(c, box.x, box.y, box.w, box.h, 36); c.clip(); c.fillStyle = SEA; c.fillRect(box.x, box.y, box.w, box.h);
  const all = routes.flat();
  if (all.length >= 2) {
    const pr = fit(all, box, 0.18);
    drawLand(c, pr, box, await loadLand(), LAND);
    c.lineCap = "round";
    for (const r of routes) {
      c.beginPath(); r.forEach((p, i) => { const [x, y] = pr.map(p.lon, p.lat); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.strokeStyle = "rgba(96,165,250,.85)"; c.lineWidth = 5; c.stroke();
      for (const p of [r[0]!, r[r.length - 1]!]) { const [x, y] = pr.map(p.lon, p.lat); c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fillStyle = INK; c.fill(); }
    }
  } else {
    c.font = `600 34px ${FONT}`; c.fillStyle = QUIET; c.textAlign = "center"; c.fillText("Your routes appear here", W / 2, box.y + box.h / 2); c.textAlign = "left";
  }
  c.restore();

  // Totals
  const stats: [string, string][] = [
    ["Flights", String(T.flights)],
    ["Hours", T.hours >= 10 ? String(Math.round(T.hours)) : T.hours.toFixed(1)],
    ["Distance", `${Math.round(T.nm).toLocaleString()} nm`],
    ["Average landing", T.avgScore !== null ? gradeOf(T.avgScore) : "—"],
  ];
  const sy = 860, gw = (W - 144) / 4;
  stats.forEach(([k, v], i) => {
    const x = 72 + i * gw;
    c.font = `700 24px ${FONT}`; c.fillStyle = QUIET; c.fillText(k.toUpperCase(), x, sy);
    let fs = 60; c.font = `800 ${fs}px ${FONT}`; while (c.measureText(v).width > gw - 24 && fs > 32) { fs -= 4; c.font = `800 ${fs}px ${FONT}`; }
    c.fillStyle = k === "Average landing" && T.avgScore !== null ? GRADE_COLOR[gradeOf(T.avgScore)]! : INK; c.fillText(v, x, sy + 66);
  });

  // Landing grades as a bar
  const by = 1010, bw = W - 144;
  c.font = `700 24px ${FONT}`; c.fillStyle = QUIET; c.fillText(`LANDINGS${T.landings ? `  ·  ${T.landings}` : ""}`, 72, by);
  if (T.landings) {
    let x = 72;
    for (const g of GRADES) {
      const n = T.grades[g] ?? 0; if (!n) continue;
      const w = Math.max(40, (n / T.landings) * bw);
      roundRect(c, x, by + 22, w - 6, 44, 12); c.fillStyle = GRADE_COLOR[g]!; c.fill();
      c.font = `800 24px ${FONT}`; c.fillStyle = "#0B0D12"; if (w > 70) c.fillText(`${g} ${n}`, x + 14, by + 53);
      x += w;
    }
    if (T.best) { c.font = `500 28px ${FONT}`; c.fillStyle = QUIET; c.fillText(`Best: ${T.best}`, 72, by + 112); }
  }
  // Favourite airports
  if (T.airports.length) {
    c.font = `700 24px ${FONT}`; c.fillStyle = QUIET; c.fillText("MOST VISITED", 72, 1190);
    c.font = `700 40px ${FONT}`; c.fillStyle = INK; c.fillText(T.airports.map(([a]) => a).join("   "), 72, 1242);
  }
  c.font = `500 26px ${FONT}`; c.fillStyle = QUIET; c.textAlign = "center";
  c.fillText("Flown in Microsoft Flight Simulator  ·  glidepath-ad9.pages.dev", W / 2, H - 40); c.textAlign = "left";
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
}

export function PilotCardButton({ flights, name }: { flights: FlightSummary[]; name: string }) {
  const done = flights.filter((f) => f.status === "completed");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true, u: string | null = null; setErr(null);
    drawPilotCard(done, name).then((b) => { if (!alive) return; u = URL.createObjectURL(b); setBlob(b); setUrl(u); }, (e) => setErr(String(e?.message ?? e)));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); setUrl(null); setBlob(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const file = () => new File([blob!], "glidepath-pilot-card.png", { type: "image/png" });
  const canShareFile = !!navigator.canShare && !!blob && (() => { try { return navigator.canShare({ files: [file()] }); } catch { return false; } })();
  const save = () => { if (!url) return; const a = document.createElement("a"); a.href = url; a.download = "glidepath-pilot-card.png"; document.body.appendChild(a); a.click(); a.remove(); };
  return (
    <>
      <button className="btn small" disabled={!done.length} onClick={() => setOpen(true)} title={done.length ? "A picture of your whole logbook" : "Finish a flight first"}>Pilot card</button>
      {open && createPortal(
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Your pilot card" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="glass strong share-sheet">
            <div className="between"><h2 className="h2" style={{ margin: 0 }}>Your pilot card</h2><button className="btn small" onClick={() => setOpen(false)}>Done</button></div>
            <div className="share-preview pc-preview">{url ? <img src={url} alt="Your pilot card" /> : err ? <p className="form-err">{err}</p> : <div className="skeleton" style={{ width: "100%", height: "100%" }} />}</div>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              {canShareFile && <button className="btn primary" disabled={!blob} onClick={async () => { try { await navigator.share({ files: [file()], title: "My Glidepath pilot card" }); } catch { /* cancelled */ } }}>Share…</button>}
              <button className={`btn${canShareFile ? "" : " primary"}`} disabled={!url} onClick={save}>Save image</button>
            </div>
            <p className="faint" style={{ fontSize: 12, margin: 0, textAlign: "center" }}>1080 × 1350, made from your {done.length} completed {done.length === 1 ? "flight" : "flights"}.</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
