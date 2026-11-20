/**
 * "What's new" — shown once, the first time a new version of the app opens.
 * New users (nothing stored yet) don't see it; they get the welcome instead.
 * Keep APP_VERSION in step with the version in Settings and the site (release checklist).
 */
import { useEffect, useState } from "react";
import { Icon } from "./ui";

export const APP_VERSION = "1.0.9";
const KEY = "glidepath.seenVersion";

export type WnIcon = "map" | "flight" | "remote" | "book" | "gear" | "spark" | "download" | "search" | "tower" | "cloud" | "layers" | "target";
export interface WnItem { v: string; ic: WnIcon; t: string; d: string }
export const WHATS_NEW: WnItem[] = [
  { v: "1.0.9", ic: "remote", t: "Pair by code on any Wi-Fi", d: "Type the code on your iPad and stay right where you are. If your router blocks the direct link, Glidepath goes through its own relay instead. Your PC still checks the code." },
  { v: "1.0.9", ic: "download", t: "A new Updates page", d: "See which version of the app and the Bridge you have, check for updates and watch them install." },
  { v: "1.0.9", ic: "spark", t: "Better on iPad and phone", d: "Bigger tab bar, notifications that stay out of the way, and your live flight first on the Flight screen." },
  { v: "1.0.8", ic: "download", t: "Updates by itself", d: "The app on your iPad, phone and PC switches to the newest version by itself. The Bridge installs its updates while the sim is closed." },
  { v: "1.0.7", ic: "map", t: "Your MSFS flight plan on the map", d: "Plan in the MSFS world map (or load a .PLN) and Glidepath shows the route, SID and STAR by itself. SimBrief loads by itself too once you've saved your SimBrief name." },
  { v: "1.0.7", ic: "target", t: "Safer with the simulator", d: "The Bridge only reads your own aircraft. Sim AI traffic and the sim's SID/STAR lists are off, so they can't upset MSFS." },
  { v: "1.0.5", ic: "gear", t: "A new Bridge", d: "A cleaner Bridge window: live altitude, speed and heading, and one place to connect your iPad by code, account or QR." },
  { v: "1.0.5", ic: "search", t: "Flight cards like a tracker", d: "Tap any aircraft for a bold flight card, live data tiles and a smooth trail. Search with Ctrl+F." },
  { v: "1.0.5", ic: "cloud", t: "SimBrief without the Bridge", d: "Load your latest plan on any device and see it on the map before you start the sim." },
  { v: "1.0.4", ic: "layers", t: "Your plan on the live map", d: "Route, SID and STAR with every waypoint's planned altitude, top of climb and descent, your active leg, and holds at any waypoint." },
  { v: "1.0.4", ic: "gear", t: "Glidepath in its own window", d: "On your PC, the Bridge opens Glidepath in its own app window, already connected." },
  { v: "1.0.3", ic: "flight", t: "A full flight plan", d: "Route, every waypoint with airway, altitude and distance, where you are along it, fuel and weights." },
  { v: "1.0.3", ic: "remote", t: "Connects by itself", d: "Open Glidepath on the sim PC and it's connected. Paired devices stay paired and reconnect when the Bridge opens." },
  { v: "1.0.2", ic: "tower", t: "Online now", d: "Search any callsign or airport on the live map, see the busiest airports, follow pilots with a star, and spot emergencies." },
  { v: "1.0.2", ic: "book", t: "Your logbook, mapped", d: "Every flight on one map, a short replay video of each, and you can delete flights." },
];

function read(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function write(v: string) { try { localStorage.setItem(KEY, v); } catch { /* private mode: show again next time, harmless */ } }

/** Open the sheet from anywhere (Settings › What's new). */
export function showWhatsNew() { window.dispatchEvent(new Event("gp-whatsnew")); }

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const seen = read();
    if (seen === null) write(APP_VERSION); // first ever open: nothing to compare against
    else if (seen !== APP_VERSION) { const id = setTimeout(() => setOpen(true), 900); return () => clearTimeout(id); }
  }, []);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("gp-whatsnew", on);
    return () => window.removeEventListener("gp-whatsnew", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const close = () => { write(APP_VERSION); setOpen(false); };
  if (!open) return null;
  const latest = WHATS_NEW.filter((x) => x.v === WHATS_NEW[0]!.v);
  const earlier = WHATS_NEW.filter((x) => x.v !== WHATS_NEW[0]!.v).slice(0, 6);
  return (
    <div className="wn-scrim" onClick={close}>
      <div className="wn-sheet" role="dialog" aria-modal="true" aria-labelledby="wn-title" onClick={(e) => e.stopPropagation()}>
        <div className="wn-hero" aria-hidden="true">
          <svg viewBox="0 0 400 150" className="wn-sky">
            <defs><linearGradient id="wnl" x1="0" x2="1"><stop offset="0" stopColor="#5E5CE6" stopOpacity="0" /><stop offset=".5" stopColor="#64D2FF" /><stop offset="1" stopColor="#5E5CE6" stopOpacity="0" /></linearGradient></defs>
            <path className="wn-arc" d="M-10 130 C 120 10, 280 10, 410 130" fill="none" stroke="url(#wnl)" strokeWidth="2.5" strokeLinecap="round" />
            <g className="wn-plane"><path d={PLANE} fill="#fff" /></g>
            {[[40, 30], [90, 70], [160, 22], [250, 55], [330, 28], [370, 80], [210, 100]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={k % 2 ? 1.2 : 1.8} className="wn-star" style={{ animationDelay: `${k * 0.35}s` }} />)}
          </svg>
          <div className="wn-ver">Glidepath {APP_VERSION}</div>
        </div>
        <div className="wn-body">
          <h2 id="wn-title">What's new</h2>
          <div className="wn-cards">
            {latest.map((x, k) => (
              <div className="wn-card" key={x.t} style={{ animationDelay: `${150 + k * 90}ms` }}>
                <span className="wn-ic">{Icon[x.ic]()}</span>
                <div><b>{x.t}</b><p>{x.d}</p></div>
              </div>
            ))}
          </div>
          {earlier.length > 0 && <>
            <p className="wn-h">Recently</p>
            <ul className="wn-list">
              {earlier.map((x, k) => <li key={x.t} style={{ animationDelay: `${450 + k * 60}ms` }}><span className="wn-tag">{x.v}</span><div><b>{x.t}</b><span>{x.d}</span></div></li>)}
            </ul>
          </>}
        </div>
        <div className="wn-foot">
          <a className="btn" href="#/updates" onClick={close}>All updates</a>
          <button className="btn primary" onClick={close} autoFocus>Continue</button>
        </div>
      </div>
    </div>
  );
}

const PLANE = "M15 0C15-1.3 13.4-2.2 11.5-2.2H3L-5.5-14h-3l4 11.8H-11L-14.5-7h-2l1.6 4.8V2.2L-16.5 7h2L-11 2.2h6.5l-4 11.8h3L3 2.2h8.5C13.4 2.2 15 1.3 15 0z";
