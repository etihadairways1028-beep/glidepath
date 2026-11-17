/**
 * UTC and local time, side by side, the way pilots read them (24-hour, Z for UTC).
 * Ticks on the second; pauses while the app is in the background.
 */
import { useEffect, useState } from "react";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t = 0;
    const tick = () => { setNow(new Date()); t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    const vis = () => { window.clearTimeout(t); if (document.visibilityState === "visible") tick(); };
    tick();
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearTimeout(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return now;
}

const two = (n: number) => String(n).padStart(2, "0");
/** "UTC+4", "UTC−5:30", "UTC" */
function offsetLabel(d: Date): string {
  const m = -d.getTimezoneOffset();
  if (m === 0) return "UTC";
  const sign = m > 0 ? "+" : "−", a = Math.abs(m);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${two(a % 60)}` : ""}`;
}

export function utcParts(d: Date) { return { hm: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`, s: two(d.getUTCSeconds()) }; }
export function localParts(d: Date) { return { hm: `${two(d.getHours())}:${two(d.getMinutes())}`, off: offsetLabel(d) }; }

/** Sidebar: two clear rows. */
export function SideClock() {
  const now = useNow();
  const u = utcParts(now), l = localParts(now);
  return (
    <div className="side-clock" role="timer" aria-label={`UTC ${u.hm}, local ${l.hm}`}>
      <div className="sc-row"><span className="sc-k">UTC</span><span className="sc-v">{u.hm}<small>:{u.s}</small><b>Z</b></span></div>
      <div className="sc-row"><span className="sc-k">Local</span><span className="sc-v loc">{l.hm}<small> {l.off}</small></span></div>
    </div>
  );
}

/** A compact pill for headers (Home on phones and portrait iPad, Glance). */
export function ClockPill({ className = "" }: { className?: string }) {
  const now = useNow();
  const u = utcParts(now), l = localParts(now);
  return (
    <span className={`clock-pill glass ${className}`} role="timer" aria-label={`UTC ${u.hm}, local ${l.hm}`}>
      <span className="cp-utc">{u.hm}<b>Z</b></span>
      <span className="cp-sep" aria-hidden="true" />
      <span className="cp-loc">{l.hm}<small> local</small></span>
    </span>
  );
}
