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
export const HOSTED = "https://glidepath-ad9.pages.dev/app/";

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
  // The Home Screen app keeps the address it was added from. Added from the Bridge (plain http),
  // it can only open while the PC's Bridge is running. Added from the website, it always opens
  // (it keeps a saved copy) and reaches the PC over the Bridge's secure link.
  const fromBridge = location.protocol === "http:" && !/^(localhost|127\.)/.test(location.hostname);
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
      {fromBridge && <p className="small muted" style={{ margin: 0 }}>Best from the website, so the icon always opens, even when your PC is off: in Safari go to <a href={HOSTED}>{HOSTED.replace("https://", "")}</a>, type the code shown on your PC, then add it to your Home Screen there.</p>}
    </section>
  );
}

/**
 * Shown inside a Home Screen app that was added from the Bridge (plain http). Safari can't keep a
 * saved copy of those, so the icon won't open while the PC or the Bridge is off. Offer the website
 * version, which always opens and still connects to the PC.
 */
export function BridgeIconTip() {
  const TIP = "glidepath.bridgeIconTip";
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(TIP) === "1"; } catch { return false; } });
  const fromBridge = location.protocol === "http:" && !/^(localhost|127\.)/.test(location.hostname);
  if (hidden || !fromBridge || !isStandalone()) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(TIP, "1"); } catch { /* ignore */ } };
  return (
    <section className="glass install-card" aria-label="Get a Home Screen icon that always opens" style={{ marginBottom: 14 }}>
      <div className="between">
        <h2 className="h2" style={{ margin: 0 }}>Get an icon that always opens</h2>
        <button className="btn small" onClick={hide}>Not now</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        This icon was added from your PC, so it can only open while the Bridge is running. If you close the Bridge after a flight, it shows a blank screen.
        For one that always opens: in Safari go to <b>{HOSTED.replace("https://", "")}</b>, type the code shown on your PC, tap Share, then <b>Add to Home Screen</b>. Then delete this icon.
      </p>
      <a className="btn primary" href={HOSTED} target="_blank" rel="noreferrer">Open the website version</a>
    </section>
  );
}
