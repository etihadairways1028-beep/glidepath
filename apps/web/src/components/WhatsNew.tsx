/**
 * "What's new" — shown once, the first time a new version of the app opens.
 * New users (nothing stored yet) don't see it; they get the welcome instead.
 * Keep APP_VERSION in step with the version in Settings and the site (release checklist).
 */
import { useEffect, useState } from "react";

export const APP_VERSION = "1.0.7";
const KEY = "glidepath.seenVersion";

export const WHATS_NEW: { t: string; d: string }[] = [
  { t: "Your MSFS flight plan on the map", d: "Plan in the MSFS world map (or load a .PLN) and Glidepath shows the route, SID and STAR by itself. SimBrief loads by itself too once you've saved your SimBrief name." },
  { t: "Safer with the simulator", d: "The Bridge only reads your own aircraft again. Sim AI traffic and the sim's SID/STAR lists are off, so they can't upset MSFS." },
  { t: "A new Bridge", d: "A cleaner Bridge window: live altitude, speed and heading, and one place to connect your iPad by code, account or QR." },
  { t: "Flight cards like a tracker", d: "Tap any aircraft for a bold flight card, live data tiles and a smooth trail from where it was first seen. Search with Ctrl+F." },
  { t: "SimBrief without the Bridge", d: "Load your latest plan on any device and see it on the map before you start the sim." },
  { t: "Glidepath in its own window", d: "On your PC, the Bridge opens Glidepath in its own app window, connected, with your iPad code in Settings." },
  { t: "Your plan on the live map", d: "Route, SID and STAR with every waypoint's planned altitude, top of climb and descent, your active leg, and holds you can place at any waypoint." },
  { t: "A full flight plan", d: "Your SimBrief plan on the Flight screen: route, every waypoint with airway, altitude and distance, where you are along it, fuel and weights." },
  { t: "Connects by itself", d: "Open Glidepath on the sim PC and it's connected. Paired devices stay paired and reconnect when the Bridge opens." },
  { t: "Online now", d: "Search any callsign or airport on the live map, see the busiest airports, follow pilots with a star, and spot emergencies." },
  { t: "Your logbook, mapped", d: "Every flight on one map, a short replay video of each, and you can delete flights." },
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
  return (
    <div className="wn-scrim" onClick={close}>
      <div className="wn-sheet glass strong" role="dialog" aria-modal="true" aria-labelledby="wn-title" onClick={(e) => e.stopPropagation()}>
        <div className="wn-badge">Glidepath {APP_VERSION}</div>
        <h2 id="wn-title">What's new</h2>
        <ul className="wn-list">
          {WHATS_NEW.map((x, i) => (
            <li key={x.t} style={{ animationDelay: `${120 + i * 70}ms` }}>
              <span className="wn-dot" aria-hidden="true" />
              <div><b>{x.t}</b><span>{x.d}</span></div>
            </li>
          ))}
        </ul>
        <button className="btn primary wn-go" onClick={close} autoFocus>Continue</button>
      </div>
    </div>
  );
}
