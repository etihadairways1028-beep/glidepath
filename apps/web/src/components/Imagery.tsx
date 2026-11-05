/**
 * Pictures that carry information:
 *  - RunwayDiagram: drawn to scale from OurAirports runway coordinates,
 *    with the live wind and the runway most into it.
 *  - AirportHero: the airport's photo and summary from Wikipedia (credited).
 *  - AircraftArt: original side-view illustrations in Glidepath's house
 *    livery (no airline branding), shaped by aircraft category.
 */
import React, { useEffect, useMemo, useState } from "react";
import { landingProfileFor, windComponents } from "@glidepath/flight-engine";
import type { Runway } from "@glidepath/aviation-data";

/* ---------------- runway diagram ---------------- */

export function RunwayDiagram({ runways, windDir, windKt, label }: { runways: Runway[]; windDir?: number | null; windKt?: number | null; label: string }) {
  const geo = useMemo(() => {
    const ends = runways.flatMap((r) => r.ends);
    if (!ends.length) return null;
    const lat0 = ends.reduce((s, e) => s + e.threshold.lat, 0) / ends.length;
    const lon0 = ends.reduce((s, e) => s + e.threshold.lon, 0) / ends.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const P = (lat: number, lon: number) => ({ x: (lon - lon0) * k * 60 * 6076, y: -(lat - lat0) * 60 * 6076 }); // feet
    const segs = runways.map((r) => ({ r, a: P(r.ends[0].threshold.lat, r.ends[0].threshold.lon), b: P(r.ends[1].threshold.lat, r.ends[1].threshold.lon) }));
    const xs = segs.flatMap((s) => [s.a.x, s.b.x]), ys = segs.flatMap((s) => [s.a.y, s.b.y]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 3000);
    const S = 300 / span; // px per foot inside a 400 box
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const T = (p: { x: number; y: number }) => ({ x: 200 + (p.x - cx) * S, y: 200 + (p.y - cy) * S });
    return { segs: segs.map((s) => ({ ...s, A: T(s.a), B: T(s.b) })), S };
  }, [runways]);

  if (!geo) return null;
  let best: string | null = null;
  if (typeof windDir === "number" && windKt) {
    let h = -Infinity;
    for (const r of runways) for (const e of r.ends) {
      const w = windComponents(windDir, windKt, e.headingTrueDeg);
      if (w.headwindKt > h) { h = w.headwindKt; best = e.ident; }
    }
  }
  return (
    <svg className="rwy-diagram" viewBox="0 0 400 400" role="img" aria-label={`Runway layout at ${label}${best ? `; runway ${best} is most into wind` : ""}`}>
      <defs>
        <radialGradient id="rwy-glow" cx="50%" cy="50%" r="60%"><stop offset="0" stopColor="var(--accent)" stopOpacity=".16" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        <marker id="rwy-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--hold)" /></marker>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#rwy-glow)" />
      <circle cx="200" cy="200" r="186" fill="none" stroke="currentColor" strokeOpacity=".12" strokeDasharray="2 6" />
      {geo.segs.map(({ r, A, B }, i) => {
        const ang = Math.atan2(B.y - A.y, B.x - A.x);
        const w = Math.max(7, (r.widthFt ?? 150) * geo.S * 2.2);
        const nx = -Math.sin(ang) * (w / 2), ny = Math.cos(ang) * (w / 2);
        const pts = `${A.x + nx},${A.y + ny} ${B.x + nx},${B.y + ny} ${B.x - nx},${B.y - ny} ${A.x - nx},${A.y - ny}`;
        const lab = (p: { x: number; y: number }, dir: number) => ({ x: p.x - Math.cos(ang) * 16 * dir, y: p.y - Math.sin(ang) * 16 * dir + 4 });
        const la = lab(A, 1), lb = lab(B, -1);
        const hotA = best === r.ends[0].ident, hotB = best === r.ends[1].ident;
        return (
          <g key={i}>
            <polygon points={pts} className={`rwy${hotA || hotB ? " hot" : ""}`} />
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="rwy-cl" />
            <text x={la.x} y={la.y} className={`rwy-id${hotA ? " hot" : ""}`} textAnchor="middle">{r.ends[0].ident}</text>
            <text x={lb.x} y={lb.y} className={`rwy-id${hotB ? " hot" : ""}`} textAnchor="middle">{r.ends[1].ident}</text>
          </g>
        );
      })}
      <g transform="translate(366 36)" className="rwy-north"><path d="M0 -16 L6 6 L0 2 L-6 6 Z" /><text y="22" textAnchor="middle">N</text></g>
      {typeof windDir === "number" && windKt ? (() => {
        // Arrow drawn from where the wind comes from, towards the field.
        const a = ((windDir - 90) * Math.PI) / 180;
        const x1 = 200 + Math.cos(a) * 178, y1 = 200 + Math.sin(a) * 178, x2 = 200 + Math.cos(a) * 128, y2 = 200 + Math.sin(a) * 128;
        return (
          <g className="rwy-wind">
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#rwy-arrow)" />
            <text x={20} y={384}>Wind {String(Math.round(windDir)).padStart(3, "0")}° {Math.round(windKt)} kt{best ? ` · best ${best}` : ""}</text>
          </g>
        );
      })() : <text x={20} y={384} className="rwy-note">No wind report</text>}
    </svg>
  );
}

/* ---------------- airport photo (Wikipedia) ---------------- */

interface WikiSummary { title: string; extract: string; image: string | null; url: string }
const wikiCache = new Map<string, Promise<WikiSummary | null>>();

function wikiFor(name: string, code: string): Promise<WikiSummary | null> {
  const key = code;
  if (!wikiCache.has(key)) {
    wikiCache.set(key, (async () => {
      try {
        const q = encodeURIComponent(/airport|airfield|aerodrome/i.test(name) ? name : `${name} airport`);
        const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=1&format=json&origin=*`).then((r) => r.json());
        const title: string | undefined = s?.query?.search?.[0]?.title;
        if (!title) return null;
        const j = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`).then((r) => r.json());
        if (!j?.extract) return null;
        return { title: j.title, extract: j.extract, image: j.originalimage?.source ?? j.thumbnail?.source ?? null, url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
      } catch {
        return null;
      }
    })());
  }
  return wikiCache.get(key)!;
}

export function AirportHero({ code, name, city, country, children }: { code: string; name: string; city: string; country: string; children?: React.ReactNode }) {
  const [w, setW] = useState<WikiSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setW(null); setLoaded(false); void wikiFor(name, code).then(setW); }, [code, name]);
  return (
    <section className={`glass strong apt-hero${w?.image ? " has-photo" : ""}`}>
      {w?.image && <img src={w.image} alt="" className={`apt-photo${loaded ? " in" : ""}`} onLoad={() => setLoaded(true)} referrerPolicy="no-referrer" />}
      <div className="apt-hero-body">
        <div className="apt-code">{code}</div>
        <h1 className="apt-name">{name}</h1>
        <p className="apt-place">{[city, country].filter(Boolean).join(", ")}</p>
        {children}
        {w && <p className="apt-extract">{w.extract.length > 320 ? w.extract.slice(0, w.extract.lastIndexOf(" ", 320)) + "…" : w.extract}</p>}
        {w && <a className="apt-credit" href={w.url} target="_blank" rel="noreferrer">{w.image ? "Photo and summary" : "Summary"}: Wikipedia</a>}
      </div>
    </section>
  );
}

/* ---------------- aircraft illustrations ---------------- */

export type ArtKind = "narrow" | "wide" | "turboprop" | "light";

export function artKindFor(icaoType: string | null | undefined, title = ""): ArtKind {
  const p = landingProfileFor(icaoType ?? null, title).id;
  return p === "widebody-jet" ? "wide" : p === "turboprop" ? "turboprop" : p === "light-aircraft" ? "light" : "narrow";
}

/** Original side-view artwork. `tilt` (degrees, + = nose down) gives a slight climb/descent attitude. */
export function AircraftArt({ kind, tilt = 0, className }: { kind: ArtKind; tilt?: number; className?: string }) {
  const id = `ac-${kind}`;
  const body = (
    <defs>
      <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#FFFFFF" /><stop offset=".55" stopColor="#E4EAF4" /><stop offset="1" stopColor="#AEB9CC" />
      </linearGradient>
      <linearGradient id={`${id}-tail`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8CC8FF" /><stop offset=".55" stopColor="#3F86F0" /><stop offset="1" stopColor="#6B4CFF" />
      </linearGradient>
      <linearGradient id={`${id}-eng`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F4F7FC" /><stop offset="1" stopColor="#8E9AB0" />
      </linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#25344F" /><stop offset="1" stopColor="#0C1426" /></linearGradient>
    </defs>
  );
  return (
    <svg className={`ac-art ${className ?? ""}`} viewBox="0 0 640 220" role="img" aria-label="Aircraft illustration">
      {body}
      <ellipse cx="320" cy="200" rx="230" ry="8" className="ac-shadow" />
      {/* Drawn nose-left, shown nose-right (flying the route left to right). Positive tilt = nose down. */}
      <g transform={`rotate(${tilt} 320 110)`}>
        <g transform="translate(640 0) scale(-1 1)">
          {kind === "light" ? <Light id={id} /> : kind === "turboprop" ? <Turboprop id={id} /> : <Jet id={id} wide={kind === "wide"} />}
        </g>
      </g>
    </svg>
  );
}

function Jet({ id, wide }: { id: string; wide: boolean }) {
  // Proportions: wide-bodies get a deeper fuselage and larger engines.
  const top = wide ? 62 : 72, bot = wide ? 124 : 112, h = bot - top, mid = (top + bot) / 2;
  const win: React.ReactElement[] = [];
  for (let x = 128; x < (wide ? 470 : 455); x += wide ? 11 : 13) win.push(<rect key={x} x={x} y={top + h * 0.3} width={wide ? 5.5 : 6} height={wide ? 7.5 : 7} rx={2.5} className="ac-win" />);
  const ew = wide ? 92 : 74, eh = wide ? 34 : 27, ex = wide ? 230 : 246, ey = bot - 6;
  return (
    <g>
      {/* far wing, seen below the fuselage */}
      <path d={`M${ex - 20} ${mid + 6} L${ex + 150} ${mid + 4} L${ex + 210} ${bot + 22} L${ex + 168} ${bot + 24} L${ex + 20} ${bot + 2} Z`} fill={`url(#${id}-skin)`} opacity=".78" />
      {/* tail fin */}
      <path d={`M${wide ? 492 : 500} ${top + 2} L${wide ? 546 : 552} ${top - 58} L${wide ? 580 : 584} ${top - 58} L${wide ? 566 : 570} ${top + 4} Z`} fill={`url(#${id}-tail)`} />
      {/* fuselage */}
      <path d={`M34 ${mid + 6} C34 ${top + 8} 66 ${top} 112 ${top} L470 ${top} C500 ${top} 522 ${top - 2} 548 ${top - 10} L590 ${top - 22} C597 ${top - 24} 601 ${top - 18} 596 ${top - 12} L556 ${bot - 16} C544 ${bot - 4} 520 ${bot} 494 ${bot} L112 ${bot} C66 ${bot} 34 ${bot - 4} 34 ${mid + 6} Z`} fill={`url(#${id}-skin)`} />
      {/* house cheatline */}
      <path d={`M58 ${mid + 8} C120 ${mid + 2} 360 ${mid + 4} 560 ${top + 6}`} fill="none" stroke={`url(#${id}-tail)`} strokeWidth={wide ? 5 : 4} strokeLinecap="round" opacity=".95" />
      {/* cockpit windows */}
      <path d={`M60 ${top + 16} C66 ${top + 9} 78 ${top + 6} 92 ${top + 6} L96 ${top + 15} L64 ${top + 19} Z`} fill={`url(#${id}-glass)`} />
      {win}
      {/* doors */}
      <rect x="104" y={top + 10} width="10" height={h * 0.6} rx="3" className="ac-door" />
      <rect x={wide ? 458 : 446} y={top + 10} width="10" height={h * 0.6} rx="3" className="ac-door" />
      {/* horizontal stabiliser */}
      <path d={`M528 ${bot - 22} L606 ${bot - 34} L610 ${bot - 27} L546 ${bot - 10} Z`} fill={`url(#${id}-skin)`} />
      {/* engine */}
      <rect x={ex} y={ey} width={ew} height={eh} rx={eh / 2} fill={`url(#${id}-eng)`} />
      <ellipse cx={ex + 6} cy={ey + eh / 2} rx="6" ry={eh / 2 - 2} className="ac-inlet" />
      <path d={`M${ex + 26} ${ey} L${ex + 54} ${mid + 2}`} stroke="#B8C3D6" strokeWidth="6" strokeLinecap="round" />
      {/* near wing root fairing */}
      <path d={`M${ex - 10} ${bot - 4} C${ex + 40} ${bot + 6} ${ex + 120} ${bot + 4} ${ex + 170} ${bot - 6}`} fill="none" stroke="#9AA6BC" strokeWidth="2" opacity=".6" />
    </g>
  );
}

function Turboprop({ id }: { id: string }) {
  const top = 78, bot = 114, mid = 96;
  const win: React.ReactElement[] = [];
  for (let x = 138; x < 430; x += 16) win.push(<rect key={x} x={x} y={top + 11} width="7" height="9" rx="3.5" className="ac-win" />);
  return (
    <g>
      <path d={`M484 ${top + 2} L540 ${top - 60} L572 ${top - 62} L560 ${top + 2} Z`} fill={`url(#${id}-tail)`} />
      <path d={`M520 ${top - 52} L596 ${top - 60} L598 ${top - 54} L536 ${top - 44} Z`} fill={`url(#${id}-skin)`} />
      <path d={`M40 ${mid + 4} C40 ${top + 6} 70 ${top} 118 ${top} L470 ${top} C510 ${top} 540 ${top - 4} 566 ${top - 12} L572 ${top - 4} L548 ${bot - 10} C536 ${bot - 2} 512 ${bot} 490 ${bot} L118 ${bot} C70 ${bot} 40 ${bot - 4} 40 ${mid + 4} Z`} fill={`url(#${id}-skin)`} />
      <path d={`M62 ${mid + 6} C160 ${mid + 2} 380 ${mid + 4} 552 ${top - 2}`} fill="none" stroke={`url(#${id}-tail)`} strokeWidth="4" strokeLinecap="round" />
      <path d={`M66 ${top + 12} C72 ${top + 6} 84 ${top + 4} 98 ${top + 4} L100 ${top + 13} L70 ${top + 16} Z`} fill={`url(#${id}-glass)`} />
      {win}
      {/* high wing + nacelle + propeller */}
      <path d={`M210 ${top - 4} L380 ${top - 6} L392 ${top} L214 ${top + 4} Z`} fill="#C9D2E1" />
      <rect x="236" y={top - 2} width="72" height="20" rx="10" fill={`url(#${id}-eng)`} />
      <ellipse cx="232" cy={top + 8} rx="4" ry="34" className="ac-prop" />
    </g>
  );
}

function Light({ id }: { id: string }) {
  return (
    <g transform="translate(60 10)">
      <path d="M420 96 L470 40 L492 40 L486 98 Z" fill={`url(#${id}-tail)`} />
      <path d="M452 94 L520 88 L522 95 L462 104 Z" fill={`url(#${id}-skin)`} />
      <path d="M70 104 C70 88 92 80 128 78 L190 70 C210 66 240 66 262 70 L420 92 C440 96 446 104 430 110 L300 120 C260 124 180 126 130 124 C96 122 70 116 70 104 Z" fill={`url(#${id}-skin)`} />
      <path d="M196 72 C214 66 244 66 262 72 L252 92 L196 94 Z" fill={`url(#${id}-glass)`} />
      <path d="M150 66 L360 62 L362 70 L150 74 Z" fill="#C9D2E1" />
      <path d="M90 108 C180 104 300 102 424 100" fill="none" stroke={`url(#${id}-tail)`} strokeWidth="4" strokeLinecap="round" />
      <rect x="54" y="92" width="22" height="22" rx="8" fill={`url(#${id}-eng)`} />
      <ellipse cx="52" cy="103" rx="4" ry="38" className="ac-prop" />
      <path d="M236 122 L226 150 M226 150 h-10" stroke="#8E9AB0" strokeWidth="4" strokeLinecap="round" />
      <circle cx="214" cy="152" r="9" fill="#1A2234" />
      <path d="M110 122 L104 146" stroke="#8E9AB0" strokeWidth="4" strokeLinecap="round" />
      <circle cx="104" cy="150" r="8" fill="#1A2234" />
    </g>
  );
}
