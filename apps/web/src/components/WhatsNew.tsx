/**
 * "What's new" — shown once, the first time a new version of the app opens.
 * New users (nothing stored yet) don't see it; they get the welcome instead.
 * Keep APP_VERSION in step with the version in Settings and the site (release checklist).
 */
import { useEffect, useState } from "react";

export const APP_VERSION = "1.0.3";
const KEY = "glidepath.seenVersion";

export const WHATS_NEW: { t: string; d: string }[] = [
  { t: "Glidepath AI in Copilot", d: "Sign in and ask anything, free: briefings, what to do next, technique, or how to use Glidepath. It answers from your live flight." },
  { t: "Coaching after every flight", d: "On your review, tap How do I improve? for tips built from your own scores." },
  { t: "Flight complete? Your full review", d: "After you land, tap Yes for a score on your take-off, handling, approach and landing." },
  { t: "SID, STAR and approach", d: "Pick runways and procedures from your sim's own navigation data, like an EFB." },
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
