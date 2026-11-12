/**
 * "Share your landing": a story-sized picture of a flight (route, landing,
 * times) drawn on a canvas from the flight's own data, ready to send to
 * Instagram, WhatsApp or Discord, or save to Photos.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FlightSummary } from "@glidepath/protocol";

interface Pt { lat: number; lon: number }
const W = 1080, H = 1920;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';
const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };

const dur = (ms: number | null | undefined) => { if (!ms || ms <= 0) return "—"; const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

function greatCircle(a: Pt, b: Pt, n = 64): Pt[] {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * r, a.lon * r, b.lat * r, b.lon * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!d) return [a, b];
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
  });
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  c.beginPath(); c.moveTo(x + rad, y); c.arcTo(x + w, y, x + w, y + h, rad); c.arcTo(x + w, y + h, x, y + h, rad); c.arcTo(x, y + h, x, y, rad); c.arcTo(x, y, x + w, y, rad); c.closePath();
}

/** Draw the card. Returns a PNG blob. */
export async function drawShareCard(f: FlightSummary, track: Pt[]): Promise<Blob> {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  // Background: deep night with soft colour.
  const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#071233"); bg.addColorStop(0.55, "#0B1C4A"); bg.addColorStop(1, "#1A0B3A"); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  for (const [x, y, rr, col] of [[180, 300, 700, "rgba(47,91,255,.55)"], [950, 1250, 760, "rgba(191,90,242,.42)"], [200, 1700, 600, "rgba(100,210,255,.30)"]] as const) {
    const g = c.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  // Glass panel helper
  const glass = (x: number, y: number, w: number, h: number, rad = 48) => {
    c.save(); roundRect(c, x, y, w, h, rad);
    const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, "rgba(255,255,255,.20)"); g.addColorStop(0.35, "rgba(255,255,255,.06)"); g.addColorStop(1, "rgba(255,255,255,.12)");
    c.fillStyle = g; c.fill(); c.lineWidth = 2.5; c.strokeStyle = "rgba(255,255,255,.55)"; c.stroke(); c.restore();
  };
  c.textBaseline = "alphabetic"; c.fillStyle = "#fff";

  // Header
  c.font = `700 34px ${FONT}`; c.fillStyle = "rgba(235,240,255,.75)"; c.fillText("GLIDEPATH", 90, 140);
  const date = new Date(f.wheelsDownAt ?? f.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  c.textAlign = "right"; c.fillText(date, W - 90, 140); c.textAlign = "left";
  c.fillStyle = "#fff"; c.font = `800 150px ${FONT}`;
  const route = `${f.departureIcao ?? "····"} → ${f.arrivalIcao ?? "····"}`;
  let size = 150; while (c.measureText(route).width > W - 180 && size > 80) { size -= 6; c.font = `800 ${size}px ${FONT}`; }
  c.fillText(route, 90, 310);
  c.font = `500 40px ${FONT}`; c.fillStyle = "rgba(235,240,255,.75)";
  const names = [f.departureName, f.arrivalName].filter(Boolean).join(" to ");
  if (names) c.fillText(names.length > 46 ? names.slice(0, 45) + "…" : names, 90, 375);

  // Route panel
  const box = { x: 70, y: 430, w: W - 140, h: 620 };
  glass(box.x, box.y, box.w, box.h);
  let pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2 && f.plan?.origin && f.plan?.destination) pts = greatCircle(f.plan.origin, f.plan.destination);
  if (pts.length >= 2) {
    const midLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length, k = Math.cos((midLat * Math.PI) / 180);
    let lons = pts.map((p) => p.lon);
    if (Math.max(...lons) - Math.min(...lons) > 180) lons = lons.map((l) => (l < 0 ? l + 360 : l)); // across the date line
    const xs = lons.map((l) => l * k), ys = pts.map((p) => -p.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 110, s = Math.min((box.w - pad * 2) / Math.max(x1 - x0, 1e-6), (box.h - pad * 2) / Math.max(y1 - y0, 1e-6));
    const ox = box.x + box.w / 2 - ((x0 + x1) / 2) * s, oy = box.y + box.h / 2 - ((y0 + y1) / 2) * s;
    const P = xs.map((x, i) => [ox + x * s, oy + ys[i]! * s] as const);
    // faint grid
    c.save(); roundRect(c, box.x, box.y, box.w, box.h, 48); c.clip();
    c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 2;
    for (let gx = box.x + 60; gx < box.x + box.w; gx += 90) { c.beginPath(); c.moveTo(gx, box.y); c.lineTo(gx, box.y + box.h); c.stroke(); }
    for (let gy = box.y + 50; gy < box.y + box.h; gy += 90) { c.beginPath(); c.moveTo(box.x, gy); c.lineTo(box.x + box.w, gy); c.stroke(); }
    c.restore();
    const line = (w: number, col: string, blur = 0) => { c.save(); c.shadowColor = col; c.shadowBlur = blur; c.strokeStyle = col; c.lineWidth = w; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); P.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.restore(); };
    line(22, "rgba(10,132,255,.35)", 30); line(8, "#64D2FF", 12); line(3, "#ffffff");
    const dot = (x: number, y: number, label: string | null | undefined, col: string) => {
      c.fillStyle = col; c.beginPath(); c.arc(x, y, 16, 0, Math.PI * 2); c.fill(); c.lineWidth = 6; c.strokeStyle = "#fff"; c.stroke();
      if (!label) return;
      c.font = `800 40px ${FONT}`; const tw = c.measureText(label).width;
      const lx = Math.min(Math.max(x - tw / 2 - 18, box.x + 24), box.x + box.w - tw - 60), ly = y + (y > box.y + box.h - 120 ? -88 : 34);
      c.fillStyle = "rgba(0,0,0,.45)"; roundRect(c, lx, ly, tw + 36, 58, 18); c.fill();
      c.fillStyle = "#fff"; c.fillText(label, lx + 18, ly + 43);
    };
    dot(P[0]![0], P[0]![1], f.departureIcao, "#30D158");
    dot(P.at(-1)![0], P.at(-1)![1], f.arrivalIcao, "#0A84FF");
  } else {
    c.font = `600 44px ${FONT}`; c.fillStyle = "rgba(235,240,255,.6)"; c.textAlign = "center"; c.fillText("Route map needs the flight's track", W / 2, box.y + box.h / 2); c.textAlign = "left";
  }

  // Landing panel
  const l = f.landings.at(-1);
  const ly = 1090;
  glass(70, ly, W - 140, 330);
  c.font = `700 32px ${FONT}`; c.fillStyle = "rgba(235,240,255,.7)"; c.fillText("LANDING", 120, ly + 72);
  if (l) {
    const fpm = l.touchdownVsFpm === null ? null : Math.round(Math.abs(l.touchdownVsFpm));
    c.font = `800 150px ${FONT}`; c.fillStyle = "#fff"; c.fillText(fpm === null ? "—" : String(fpm), 116, ly + 230);
    const w = c.measureText(fpm === null ? "—" : String(fpm)).width;
    c.font = `600 50px ${FONT}`; c.fillStyle = "rgba(235,240,255,.8)"; c.fillText("fpm", 130 + w, ly + 230);
    c.font = `500 36px ${FONT}`; c.fillStyle = "rgba(235,240,255,.7)";
    const sub = [l.runway?.ident ? `Runway ${l.runway.ident}` : null, l.peakG ? `${l.peakG.toFixed(2)} G` : null, l.bounces ? `${l.bounces} bounce${l.bounces > 1 ? "s" : ""}` : "No bounce"].filter(Boolean).join("  ·  ");
    c.fillText(sub, 122, ly + 292);
    // grade badge
    const g = l.grade ?? "—", gc = GRADE_COLOR[g] ?? "#64D2FF";
    c.save(); c.shadowColor = gc; c.shadowBlur = 40; c.fillStyle = gc; c.beginPath(); c.arc(W - 220, ly + 165, 105, 0, Math.PI * 2); c.fill(); c.restore();
    c.lineWidth = 6; c.strokeStyle = "rgba(255,255,255,.8)"; c.beginPath(); c.arc(W - 220, ly + 165, 105, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#06122e"; c.font = `900 ${g.length > 1 ? 96 : 120}px ${FONT}`; c.textAlign = "center"; c.fillText(g, W - 220, ly + 165 + (g.length > 1 ? 34 : 42)); c.textAlign = "left";
  } else {
    c.font = `600 60px ${FONT}`; c.fillStyle = "#fff"; c.fillText("No landing recorded", 120, ly + 200);
  }

  // Stats grid
  const stats: Array<[string, string]> = [
    ["AIR TIME", dur(f.wheelsDownAt && f.wheelsUpAt ? f.wheelsDownAt - f.wheelsUpAt : null)],
    ["BLOCK TIME", dur((f.onBlockAt ?? f.endedAt ?? 0) - (f.offBlockAt ?? f.startedAt))],
    ["DISTANCE", f.distanceNm ? `${Math.round(f.distanceNm).toLocaleString("en-US")} nm` : "—"],
    ["AIRCRAFT", f.aircraft?.icaoType ?? f.plan?.aircraftIcao ?? "—"],
  ];
  const gy = 1450, gw = (W - 140 - 30) / 2, gh = 160;
  stats.forEach(([k, v], i) => {
    const x = 70 + (i % 2) * (gw + 30), y = gy + Math.floor(i / 2) * (gh + 30);
    glass(x, y, gw, gh, 40);
    c.font = `700 28px ${FONT}`; c.fillStyle = "rgba(235,240,255,.65)"; c.fillText(k, x + 40, y + 60);
    c.font = `800 66px ${FONT}`; c.fillStyle = "#fff";
    let fs = 66; while (c.measureText(v).width > gw - 80 && fs > 36) { fs -= 4; c.font = `800 ${fs}px ${FONT}`; }
    c.fillText(v, x + 40, y + 128);
  });

  // Footer
  c.font = `600 30px ${FONT}`; c.fillStyle = "rgba(235,240,255,.6)"; c.textAlign = "center";
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
