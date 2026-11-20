/**
 * "Watch the replay": a short video of the flight, drawn from its own recorded track:
 * the route grows along the real coastline, coloured by altitude, with the aircraft,
 * its time, altitude and speed, and the landing at the end. Plays here; Save video
 * records it to a file (MP4 where the browser can, otherwise WebM).
 */
import { useEffect, useRef, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { bearing, drawLand, drawPlane, drawTrack, fit, loadLand, roundRect, type ArtPt, type Projection } from "./routeArt";

const S = 1080, FPS = 30, INTRO = 1.0, FLY = 11.0, OUTRO = 2.5, LEN = INTRO + FLY + OUTRO;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, system-ui, sans-serif';
const INK = "#F5F7FA", QUIET = "rgba(235,240,250,.6)", BG = "#0B0D12";
const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const zulu = (t?: number) => (t ? `${new Date(t).toISOString().slice(11, 16)}Z` : "");

interface Prepared { pts: ArtPt[]; cum: number[]; pr: Projection; base: HTMLCanvasElement }

async function prepare(track: ArtPt[]): Promise<Prepared | null> {
  const pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 3) return null;
  // Progress follows distance flown (with a little time), so taxiing doesn't eat the video.
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const d = Math.hypot((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat);
    const dt = a.t && b.t ? (b.t - a.t) / 3.6e6 : 0;
    cum.push(cum[i - 1]! + d + dt * 0.02);
  }
  const box = { x: 0, y: 0, w: S, h: S };
  const pr = fit(pts, { x: 40, y: 150, w: S - 80, h: S - 420 }, 0.1);
  const base = document.createElement("canvas"); base.width = S; base.height = S;
  const c = base.getContext("2d")!;
  c.fillStyle = "#10141D"; c.fillRect(0, 0, S, S);
  drawLand(c, pr, box, await loadLand(), "#1E2433", "rgba(255,255,255,.08)");
  // The whole route, faint, so you see where it's going.
  c.globalAlpha = 0.22; drawTrack(c, pr, pts, 5); c.globalAlpha = 1;
  return { pts, cum, pr, base };
}

function frame(c: CanvasRenderingContext2D, P: Prepared, f: FlightSummary, t: number) {
  const { pts, cum, pr, base } = P;
  c.drawImage(base, 0, 0);
  const k = ease(Math.max(0, Math.min(1, (t - INTRO) / FLY)));
  const goal = k * cum.at(-1)!;
  let i = 1; while (i < cum.length - 1 && cum[i]! < goal) i++;
  drawTrack(c, pr, pts, 9, i + 1);
  const here = pts[i]!, prev = pts[Math.max(0, i - 3)]!;
  const [x, y] = pr.map(here.lon, here.lat);
  drawPlane(c, x, y, bearing(prev, here), 46);

  // Top: the route and date
  const grad = c.createLinearGradient(0, 0, 0, 150); grad.addColorStop(0, "rgba(11,13,18,.92)"); grad.addColorStop(1, "rgba(11,13,18,0)");
  c.fillStyle = grad; c.fillRect(0, 0, S, 170);
  c.fillStyle = INK; c.font = `800 72px ${FONT}`; c.fillText(`${f.departureIcao ?? "····"} → ${f.arrivalIcao ?? "····"}`, 56, 100);
  c.font = `600 28px ${FONT}`; c.fillStyle = QUIET; c.textAlign = "right";
  c.fillText(new Date(f.wheelsDownAt ?? f.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), S - 56, 92); c.textAlign = "left";

  // Bottom: time, altitude, speed for this moment
  c.fillStyle = "rgba(11,13,18,.9)"; c.fillRect(0, S - 170, S, 170);
  const alt = Math.round(here.alt ?? 0), climb = (here.alt ?? 0) - (pts[Math.max(0, i - 6)]!.alt ?? 0);
  const phase = alt < 300 && (here.gs ?? 0) < 60 ? "Taxi" : climb > 300 ? "Climbing" : climb < -300 ? "Descending" : alt > 10000 ? "Cruise" : "Flying";
  // Vertical speed now, in fpm, from altitude over the last few points' time.
  const back = pts[Math.max(0, i - 4)]!;
  const dtMin = here.t && back.t ? (here.t - back.t) / 60000 : 0;
  const vs = dtMin > 0.05 ? Math.round(((here.alt ?? 0) - (back.alt ?? 0)) / dtMin / 50) * 50 : 0;
  const cells: Array<[string, string]> = [["TIME", zulu(here.t) || "—"], ["ALTITUDE", alt >= 18000 ? `FL${String(Math.round(alt / 100)).padStart(3, "0")}` : `${alt.toLocaleString("en-US")} ft`], ["SPEED", `${Math.round(here.gs ?? 0)} kt`], [`V/S · ${phase.toUpperCase()}`, `${vs > 0 ? "+" : ""}${vs.toLocaleString("en-US")} fpm`]];
  // Altitude profile strip just above the readout, with where we are on it.
  const top = Math.max(...pts.map((q) => q.alt ?? 0), 1000), sx = (j: number) => 56 + ((S - 112) * cum[j]!) / cum.at(-1)!, sy = (a: number) => S - 182 - (Math.max(0, a) / top) * 62;
  c.fillStyle = "rgba(11,13,18,.72)"; c.fillRect(0, S - 256, S, 86);
  c.beginPath(); c.moveTo(sx(0), sy(0)); pts.forEach((q, j) => c.lineTo(sx(j), sy(q.alt ?? 0))); c.lineTo(sx(pts.length - 1), sy(0)); c.closePath();
  c.fillStyle = "rgba(10,132,255,.16)"; c.fill();
  c.beginPath(); pts.forEach((q, j) => (j ? c.lineTo(sx(j), sy(q.alt ?? 0)) : c.moveTo(sx(j), sy(q.alt ?? 0)))); c.strokeStyle = "rgba(255,255,255,.28)"; c.lineWidth = 2; c.stroke();
  c.save(); c.beginPath(); c.rect(0, S - 256, sx(i), 86); c.clip();
  c.beginPath(); pts.forEach((q, j) => (j ? c.lineTo(sx(j), sy(q.alt ?? 0)) : c.moveTo(sx(j), sy(q.alt ?? 0)))); c.strokeStyle = "#64B5FF"; c.lineWidth = 3.5; c.stroke(); c.restore();
  c.beginPath(); c.arc(sx(i), sy(here.alt ?? 0), 8, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 3; c.strokeStyle = "#0A84FF"; c.stroke();
  cells.forEach(([kk, v], j) => {
    const cx = 56 + j * ((S - 112) / 4);
    c.font = `700 22px ${FONT}`; c.fillStyle = QUIET; c.fillText(kk, cx, S - 108);
    c.font = `700 44px ${FONT}`; c.fillStyle = INK; c.fillText(v, cx, S - 56);
  });
  const barY = S - 170; c.fillStyle = "rgba(255,255,255,.12)"; c.fillRect(0, barY, S, 4); c.fillStyle = "#0A84FF"; c.fillRect(0, barY, S * k, 4);

  // End: the landing
  const o = Math.max(0, Math.min(1, (t - INTRO - FLY) / 0.5));
  const l = f.landings.at(-1);
  if (o > 0 && l) {
    c.globalAlpha = o;
    const w = 660, h = 250, bx = (S - w) / 2, by = 360 - (1 - o) * 30;
    c.fillStyle = "rgba(11,13,18,.94)"; roundRect(c, bx, by, w, h, 36); c.fill();
    c.font = `700 26px ${FONT}`; c.fillStyle = QUIET; c.fillText(`LANDED${f.arrivalIcao ? ` AT ${f.arrivalIcao}` : ""}`, bx + 44, by + 66);
    const fpm = l.touchdownVsFpm === null ? "—" : String(Math.round(Math.abs(l.touchdownVsFpm)));
    c.font = `800 110px ${FONT}`; c.fillStyle = INK; c.fillText(fpm, bx + 40, by + 190);
    const fw = c.measureText(fpm).width; c.font = `600 40px ${FONT}`; c.fillStyle = QUIET; c.fillText("fpm", bx + 56 + fw, by + 190);
    if (l.grade) {
      const g = l.grade; c.font = `800 60px ${FONT}`; const gw = c.measureText(g).width + 60;
      c.fillStyle = GRADE_COLOR[g] ?? "#64D2FF"; roundRect(c, bx + w - 44 - gw, by + 100, gw, 100, 50); c.fill();
      c.fillStyle = BG; c.textAlign = "center"; c.fillText(g, bx + w - 44 - gw / 2, by + 172); c.textAlign = "left";
    }
    c.globalAlpha = 1;
  }
  c.font = `600 22px ${FONT}`; c.fillStyle = "rgba(235,240,250,.4)"; c.textAlign = "right"; c.fillText("GLIDEPATH", S - 56, S - 186); c.textAlign = "left";
}

function pickType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [["video/mp4;codecs=avc1", "mp4"], ["video/mp4", "mp4"], ["video/webm;codecs=vp9", "webm"], ["video/webm", "webm"]] as const) {
    try { if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }; } catch { /* keep looking */ }
  }
  return null;
}

export function ReplayVideo({ flight, track }: { flight: FlightSummary; track: ArtPt[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [prep, setPrep] = useState<Prepared | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [rec, setRec] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const tRef = useRef(LEN);
  useEffect(() => { let off = false; setPrep(undefined); void prepare(track).then((p) => { if (!off) setPrep(p); }); return () => { off = true; }; }, [track.length, track[0]?.t]);
  // Show the finished route until played.
  useEffect(() => { const c = ref.current?.getContext("2d"); if (c && prep) frame(c, prep, flight, tRef.current); }, [prep, flight]);
  useEffect(() => {
    if (!playing || !prep) return;
    const c = ref.current!.getContext("2d")!;
    let raf = 0; const start = performance.now() - (tRef.current >= LEN ? 0 : tRef.current * 1000);
    if (tRef.current >= LEN) tRef.current = 0;
    const tick = (now: number) => {
      tRef.current = Math.min(LEN, (now - start) / 1000);
      frame(c, prep, flight, tRef.current);
      if (tRef.current < LEN) raf = requestAnimationFrame(tick); else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, prep, flight]);

  const save = async () => {
    const type = pickType();
    if (!type || !prep || !ref.current) { setErr("This browser can't save video. Try Chrome, Edge or Safari."); return; }
    setErr(null); setPlaying(false);
    const cv = ref.current, c = cv.getContext("2d")!;
    const stream = cv.captureStream(FPS);
    const r = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((res) => { r.onstop = () => res(); });
    r.start(250);
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = (now: number) => {
        const t = Math.min(LEN, (now - t0) / 1000);
        frame(c, prep, flight, t); setRec(t / LEN);
        if (t < LEN) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    r.stop(); await done; setRec(null); tRef.current = LEN;
    const blob = new Blob(chunks, { type: type.mime.split(";")[0] });
    const name = `glidepath-${flight.departureIcao ?? "dep"}-${flight.arrivalIcao ?? "arr"}.${type.ext}`;
    const file = new File([blob], name, { type: blob.type });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "My Glidepath flight" }); return; } } catch { /* fall back to download */ }
    const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  };

  if (prep === null) return null; // no recorded track to replay
  return (
    <div className="rv">
      <canvas ref={ref} width={S} height={S} className="replay-cv" aria-label="Replay of the flight's route" />
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn primary" disabled={!prep || rec !== null} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Watch the replay"}</button>
        <button className="btn" disabled={!prep || rec !== null} onClick={() => void save()}>{rec !== null ? `Making video ${Math.round(rec * 100)}%` : "Save video"}</button>
      </div>
      {err && <p className="err-text">{err}</p>}
    </div>
  );
}
