/** Every flight in the logbook on one simple map: an arc per route, a dot per airport, three totals. */
import { useEffect, useRef, useState } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { loadAirportDb } from "../data/airports";
import { drawLand, fit, greatCircle, loadLand, type ArtPt } from "./routeArt";

interface Route { a: ArtPt & { code: string }; b: ArtPt & { code: string }; n: number }

export function AllFlightsMap({ flights }: { flights: FlightSummary[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [routes, setRoutes] = useState<Route[] | null>(null);
  useEffect(() => {
    let off = false;
    void loadAirportDb().then((db) => {
      const where = (code: string | null | undefined, plan?: { icao: string; lat: number; lon: number }) => {
        if (plan && plan.icao === code) return { code: plan.icao, lat: plan.lat, lon: plan.lon };
        const a = code ? db.get(code) : null;
        return a ? { code: code!, lat: a.lat, lon: a.lon } : null;
      };
      const by = new Map<string, Route>();
      for (const f of flights) {
        const a = where(f.departureIcao, f.plan?.origin), b = where(f.arrivalIcao, f.plan?.destination);
        if (!a || !b || a.code === b.code) continue;
        const k = [a.code, b.code].sort().join("-");
        const r = by.get(k); if (r) r.n++; else by.set(k, { a, b, n: 1 });
      }
      if (!off) setRoutes([...by.values()]);
    });
    return () => { off = true; };
  }, [flights]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !routes) return;
    let off = false;
    const draw = async () => {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const c = cv.getContext("2d")!; c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const box = { x: 0, y: 0, w, h };
      c.fillStyle = "#10141D"; c.fillRect(0, 0, w, h);
      const all = routes.flatMap((r) => [r.a, r.b]);
      const pr = fit(all.length ? all : [{ lat: 50, lon: -10 }, { lat: 20, lon: 60 }], box, 0.12);
      const land = await loadLand(); if (off) return;
      drawLand(c, pr, box, land, "#1E2433", "rgba(255,255,255,.07)");
      c.lineCap = "round";
      for (const r of routes) {
        c.lineWidth = Math.min(4, 1.6 + r.n * 0.5); c.strokeStyle = "rgba(100,181,255,.85)";
        c.beginPath();
        greatCircle(r.a, r.b, 48).forEach((p, i) => { const [x, y] = pr.map(p.lon, p.lat); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
        c.stroke();
      }
      const seen = new Set<string>();
      for (const p of all) {
        if (seen.has(p.code)) continue; seen.add(p.code);
        const [x, y] = pr.map(p.lon, p.lat);
        c.fillStyle = "#F5F7FA"; c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
      }
      if (seen.size <= 12) {
        c.font = '600 11px -apple-system, "Segoe UI", Inter, sans-serif'; c.fillStyle = "rgba(245,247,250,.8)";
        for (const code of seen) { const p = all.find((q) => q.code === code)!; const [x, y] = pr.map(p.lon, p.lat); c.fillText(code, x + 6, y - 5); }
      }
    };
    void draw();
    const ro = new ResizeObserver(() => void draw()); ro.observe(cv);
    return () => { off = true; ro.disconnect(); };
  }, [routes]);

  if (!flights.length) return null;
  const airports = new Set(flights.flatMap((f) => [f.departureIcao, f.arrivalIcao].filter(Boolean)));
  const nm = flights.reduce((s, f) => s + (f.distanceNm && f.distanceNm > 1 ? f.distanceNm : 0), 0);
  return (
    <section className="glass all-map" aria-label="All your flights on a map">
      <canvas ref={ref} className="all-map-cv" />
      <div className="all-map-stats">
        <span><b className="data">{flights.length}</b> flight{flights.length === 1 ? "" : "s"}</span>
        <span><b className="data">{airports.size}</b> airport{airports.size === 1 ? "" : "s"}</span>
        {nm > 0 && <span><b className="data">{Math.round(nm).toLocaleString("en-US")}</b> nm</span>}
      </div>
    </section>
  );
}
