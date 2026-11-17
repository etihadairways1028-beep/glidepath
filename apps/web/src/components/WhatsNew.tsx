/**
 * "What's new" — shown once, the first time a new version of the app opens.
 * New users (nothing stored yet) don't see it; they get the welcome instead.
 * Keep APP_VERSION in step with the version in Settings and the site (release checklist).
 */
import { useEffect, useState } from "react";

export const APP_VERSION = "1.0.4";
const KEY = "glidepath.seenVersion";

export const WHATS_NEW: { t: string; d: string }[] = [
  { t: "A real flight profile", d: "The live card now draws your climb, cruise and descent, lights up what you've flown, and marks T/C and T/D with their times. Your plane rides the line." },
  { t: "UTC and local time", d: "Always in the sidebar, and on Home and Glance: Zulu time with seconds, and your local time." },
  { t: "Made for iPad", d: "Glance fits the screen, the autopilot stays in view, and messages no longer cover titles or buttons." },
  { t: "Copilot answers instantly", d: "Glidepath AI starts answering in about half a second, word by word, and keeps your conversation when you switch screens." },
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
