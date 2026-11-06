/**
 * "Put Glidepath on your Home Screen" help, shown on phones and tablets until
 * the app is opened from the Home Screen. iOS has no install button for web
 * apps, so it gets the Share steps; Android/Chrome gets a real Install button.
 */
import { useEffect, useState } from "react";

interface InstallPrompt extends Event { prompt: () => Promise<void> }
let deferred: InstallPrompt | null = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; });

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isTouch = () => navigator.maxTouchPoints > 0 && window.matchMedia?.("(pointer: coarse)").matches;
const KEY = "glidepath.installHidden";

export function InstallCard() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  useEffect(() => {
    const h = () => setCanPrompt(true);
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (hidden || isStandalone() || !(isIos() || isTouch() || canPrompt)) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
  // The Home Screen app keeps the address it was added from. From the website
  // (https) it can't reach the Bridge on your Wi-Fi, so add it from the Bridge link.
  const fromWebsite = location.protocol === "https:";
  return (
    <section className="glass install-card" aria-label="Install Glidepath">
      <div className="between">
        <h2 className="h2" style={{ margin: 0 }}>Put Glidepath on your Home Screen</h2>
        <button className="btn small" onClick={hide}>Not now</button>
      </div>
      {canPrompt && !isIos() ? (
        <button className="btn primary" onClick={async () => { await deferred?.prompt(); deferred = null; setCanPrompt(false); }}>Install Glidepath</button>
      ) : (
        <ol>
          <li>In <b>Safari</b>, tap <b>Share</b> (the square with an arrow).</li>
          <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li>Open Glidepath from its new icon.</li>
        </ol>
      )}
      {fromWebsite && <p className="small muted" style={{ margin: 0 }}>Do this from your Bridge's link (scan the QR code on your PC) rather than from this website, so the Home Screen app can reach your PC over Wi-Fi.</p>}
    </section>
  );
}
