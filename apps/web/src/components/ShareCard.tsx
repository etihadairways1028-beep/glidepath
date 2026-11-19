/**
 * "Share your landing": a story-sized picture of a flight (route, landing,
 * times) drawn on a canvas from the flight's own data, ready to send to
 * Instagram, WhatsApp or Discord, or save to Photos.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FlightSummary } from "@glidepath/protocol";
import { drawLand, drawTrack, fit, greatCircle, loadLand, roundRect, trackNm, type ArtPt } from "./routeArt";

type Pt = ArtPt;
const W = 1080, H = 1920;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';
const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };
const INK = "#F5F7FA", QUIET = "rgba(235,240,250,.58)", BG = "#0B0D12", SEA = "#10141D", LAND = "#1E2433";

/** Minutes as "1h 25m"; nothing (a dash) when the time isn't known, never a made-up zero. */
const dur = (ms: number | null | undefined) => { if (!ms || ms < 60_000) return "—"; const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

/** Draw the card: flat, from the flight's own data. Returns a PNG blob. */
export async function drawShareCard(f: FlightSummary, track: Pt[]): Promise<Blob> {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.textBaseline = "alphabetic";

  // Header
  c.font = `700 32px ${FONT}`; c.fillStyle = QUIET; c.fillText("GLIDEPATH", 80, 130);
  const date = new Date(f.wheelsDownAt ?? f.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  c.textAlign = "right"; c.fillText(date, W - 80, 130); c.textAlign = "left";
  const route = `${f.departureIcao ?? "····"} → ${f.arrivalIcao ?? "····"}`;
  let size = 140; c.font = `800 ${size}px ${FONT}`; while (c.measureText(route).width > W - 160 && size > 80) { size -= 6; c.font = `800 ${size}px ${FONT}`; }
  c.fillStyle = INK; c.fillText(route, 76, 290);
  c.font = `500 38px ${FONT}`; c.fillStyle = QUIET;
  const names = [f.departureName, f.arrivalName].filter(Boolean).join(" to ");
  if (names) c.fillText(names.length > 48 ? names.slice(0, 47) + "…" : names, 80, 352);

  // Map: the real coastline and the route as flown, coloured by altitude
  const box = { x: 60, y: 410, w: W - 120, h: 800 };
  let pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const planned = pts.length < 2 && f.plan?.origin && f.plan?.destination;
  if (planned) pts = greatCircle(f.plan!.origin, f.plan!.destination);
  c.save(); roundRect(c, box.x, box.y, box.w, box.h, 36); c.clip();
  c.fillStyle = SEA; c.fillRect(box.x, box.y, box.w, box.h);
  if (pts.length >= 2) {
    const pr = fit(pts, box, 0.16);
    drawLand(c, pr, box, await loadLand(), LAND, "rgba(255,255,255,.08)");
    if (planned) { c.setLineDash([18, 14]); c.lineWidth = 7; c.strokeStyle = "rgba(255,255,255,.75)"; c.beginPath(); pts.forEach((p, i) => { const [x, y] = pr.map(p.lon, p.lat); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.setLineDash([]); }
    else drawTrack(c, pr, pts, 9);
    const end = (p: Pt, label: string | null | undefined, up: boolean) => {
      const [x, y] = pr.map(p.lon, p.lat);
      c.fillStyle = INK; c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.fill(); c.lineWidth = 5; c.strokeStyle = BG; c.stroke();
      if (!label) return;
      c.font = `700 36px ${FONT}`; const tw = c.measureText(label).width;
      const lx = Math.min(Math.max(x - tw / 2 - 16, box.x + 20), box.x + box.w - tw - 52), ly = up ? y - 82 : y + 30;
      c.fillStyle = "rgba(11,13,18,.82)"; roundRect(c, lx, ly, tw + 32, 52, 14); c.fill();
      c.fillStyle = INK; c.fillText(label, lx + 16, ly + 38);
    };
    const [, ya] = pr.map(pts[0]!.lon, pts[0]!.lat), [, yb] = pr.map(pts.at(-1)!.lon, pts.at(-1)!.lat);
    end(pts[0]!, f.departureIcao, ya <= yb); end(pts.at(-1)!, f.arrivalIcao, yb < ya);
  } else {
    c.font = `600 40px ${FONT}`; c.fillStyle = QUIET; c.textAlign = "center"; c.fillText("No route was recorded for this flight", W / 2, box.y + box.h / 2); c.textAlign = "left";
  }
  c.restore();
  if (planned) { c.font = `500 28px ${FONT}`; c.fillStyle = QUIET; c.fillText("Planned route (no track was recorded)", box.x + 4, box.y + box.h + 44); }

  // Landing
  const l = f.landings.at(-1);
  const ly = 1330;
  c.font = `700 30px ${FONT}`; c.fillStyle = QUIET; c.fillText("LANDING", 80, ly);
  if (l) {
    const fpm = l.touchdownVsFpm === null ? null : Math.round(Math.abs(l.touchdownVsFpm));
    const big = fpm === null ? "—" : String(fpm);
    c.font = `800 150px ${FONT}`; c.fillStyle = INK; c.fillText(big, 74, ly + 150);
    const w = c.measureText(big).width;
    c.font = `600 48px ${FONT}`; c.fillStyle = QUIET; c.fillText("fpm", 92 + w, ly + 150);
    c.font = `500 34px ${FONT}`;
    const sub = [l.runway?.ident ? `Runway ${l.runway.ident}` : null, l.peakG ? `${l.peakG.toFixed(2)} G` : null, l.bounces ? `${l.bounces} bounce${l.bounces > 1 ? "s" : ""}` : "No bounce"].filter(Boolean).join("  ·  ");
    c.fillText(sub, 80, ly + 210);
    if (l.grade) {
      const g = l.grade, gc = GRADE_COLOR[g] ?? "#64D2FF";
      c.font = `800 64px ${FONT}`; const gw = c.measureText(g).width + 72;
      c.fillStyle = gc; roundRect(c, W - 80 - gw, ly + 52, gw, 110, 55); c.fill();
      c.fillStyle = BG; c.textAlign = "center"; c.fillText(g, W - 80 - gw / 2, ly + 130); c.textAlign = "left";
    }
  } else {
    c.font = `600 56px ${FONT}`; c.fillStyle = INK; c.fillText("No landing recorded", 80, ly + 110);
  }

  // Numbers: worked out from the flight; a dash where it genuinely isn't known
  const trackLen = !planned && pts.length > 1 ? trackNm(pts) : 0;
  const dist = f.distanceNm && f.distanceNm > 1 ? f.distanceNm : trackLen > 1 ? trackLen : null;
  const stats: Array<[string, string]> = [
    ["AIR TIME", dur(f.wheelsDownAt && f.wheelsUpAt ? f.wheelsDownAt - f.wheelsUpAt : null)],
    ["BLOCK TIME", dur(f.offBlockAt && (f.onBlockAt ?? f.endedAt) ? (f.onBlockAt ?? f.endedAt)! - f.offBlockAt : null)],
    ["DISTANCE", dist ? `${Math.round(dist).toLocaleString("en-US")} nm` : "—"],
    ["AIRCRAFT", f.aircraft?.icaoType ?? f.plan?.aircraftIcao ?? "—"],
  ];
  const gy = 1620, gw = (W - 160) / 2;
  c.fillStyle = "rgba(255,255,255,.10)"; c.fillRect(80, gy - 50, W - 160, 2);
  stats.forEach(([k, v], i) => {
    const x = 80 + (i % 2) * gw, y = gy + Math.floor(i / 2) * 120;
    c.font = `700 26px ${FONT}`; c.fillStyle = QUIET; c.fillText(k, x, y);
    let fs = 56; c.font = `700 ${fs}px ${FONT}`; while (c.measureText(v).width > gw - 40 && fs > 34) { fs -= 4; c.font = `700 ${fs}px ${FONT}`; }
    c.fillStyle = INK; c.fillText(v, x, y + 62);
  });

  c.font = `500 28px ${FONT}`; c.fillStyle = QUIET; c.textAlign = "center";
  c.fillText(`${[f.plan?.callsign ?? f.callsign, "Flown in Microsoft Flight Simulator"].filter(Boolean).join("  ·  ")}`, W / 2, H - 46);
  c.textAlign = "left";

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
}

/** Button plus a preview sheet with Share and Save. */
export function ShareCardButton({ flight, track }: { flight: FlightSummary; track: Pt[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true, u: string | null = null;
    setErr(null);
    drawShareCard(flight, track).then((b) => { if (!alive) return; u = URL.createObjectURL(b); setBlob(b); setUrl(u); }, (e) => setErr(String(e?.message ?? e)));
    return () => { alive = false; if (u) URL.revokeObjectURL(u); setUrl(null); setBlob(null); };
  }, [open, flight, track]);
  const file = () => new File([blob!], `glidepath-${flight.departureIcao ?? "dep"}-${flight.arrivalIcao ?? "arr"}.png`, { type: "image/png" });
  const canShareFile = typeof navigator !== "undefined" && !!navigator.canShare && blob ? (() => { try { return navigator.canShare({ files: [file()] }); } catch { return false; } })() : false;
  const save = () => { if (!url) return; const a = document.createElement("a"); a.href = url; a.download = file().name; document.body.appendChild(a); a.click(); a.remove(); };
  const share = async () => { try { await navigator.share({ files: [file()], title: "My Glidepath flight" }); } catch { /* cancelled */ } };
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Share</button>
      {open && createPortal(
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Share your flight" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="glass strong share-sheet">
            <div className="between"><h2 className="h2" style={{ margin: 0 }}>Share your flight</h2><button className="btn small" onClick={() => setOpen(false)}>Done</button></div>
            <div className="share-preview">{url ? <img src={url} alt="Your flight card" /> : err ? <p className="form-err">{err}</p> : <div className="skeleton" style={{ width: "100%", height: "100%" }} />}</div>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              {canShareFile && <button className="btn primary" disabled={!blob} onClick={share}>Share…</button>}
              <button className={`btn${canShareFile ? "" : " primary"}`} disabled={!url} onClick={save}>Save image</button>
            </div>
            <p className="faint" style={{ fontSize: 12, margin: 0, textAlign: "center" }}>Story size (1080 × 1920), made from this flight's own data.</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
