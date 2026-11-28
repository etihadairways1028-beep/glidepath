/**
 * "Put Glidepath on your Home Screen" help, shown on phones and tablets until
 * the app is opened from the Home Screen. iOS has no install button for web
 * apps, so it gets the Share steps; Android/Chrome gets a real Install button.
 */
import { useEffect, useState } from "react";
import { settingsStore } from "../data/store";

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
 * Shown whenever the app is opened from the Bridge's own address (plain http on the local network).
 * That copy lives on the PC, so once the Bridge is closed it can't open at all, and Safari won't
 * keep a saved copy of a plain-http page. The website version keeps a saved copy, always opens,
 * and reaches this PC through the Bridge's online link. While that link is up, one tap moves you
 * over already paired, with no code to type.
 */
export function BridgeIconTip() {
  const TIP = "glidepath.bridgeIconTip";
  const LINK = "glidepath.pcLink";
  const fromBridge = location.protocol === "http:" && !/^(localhost|127\.)/.test(location.hostname);
  // "Not now" hides it for three days, not forever: this is what makes the app fail later.
  const [hidden, setHidden] = useState(() => { try { const t = Number(localStorage.getItem(TIP) || 0); return t > 1 && Date.now() - t < 3 * 864e5; } catch { return false; } });
  const [bid, setBid] = useState<string | null>(() => { try { return localStorage.getItem(LINK); } catch { return null; } });
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (!fromBridge) return;
    let live = true;
    const check = () => fetch("/api/pclink", { headers: { Authorization: `Bearer ${settingsStore.get().token}` }, cache: "no-store" }).then((r) => r.json() as Promise<{ online: boolean; bid: string }>).then((j) => {
      if (!live) return;
      setOnline(!!j.online);
      if (j.bid) { setBid(j.bid); try { localStorage.setItem(LINK, j.bid); } catch { /* ignore */ } }
    }).catch(() => { if (live) setOnline(false); });
    check();
    const t = setInterval(check, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [fromBridge]);
  if (hidden || !fromBridge) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(TIP, String(Date.now())); } catch { /* ignore */ } };
  const { token } = settingsStore.get();
  const paired = bid && token ? `${HOSTED}#pc=${encodeURIComponent(bid)}&token=${encodeURIComponent(token)}` : null;
  const standalone = isStandalone();
  return (
    <section className="glass install-card" aria-label="Make Glidepath open even when your PC is off" style={{ marginBottom: 14 }}>
      <div className="between">
        <h2 className="h2" style={{ margin: 0 }}>Make Glidepath open even when your PC is off</h2>
        <button className="btn small" onClick={hide}>Not now</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        You opened Glidepath from your PC{standalone ? "'s Home Screen icon" : ""}, so it only works while the Bridge is running. Close the Bridge and {standalone ? "this icon" : "this page"} won't open.
        The website version always opens, keeps your logbook, and still connects to this PC.
      </p>
      {online && paired ? (
        <>
          <a className="btn primary" href={paired}>Switch to the always-on version</a>
          <p className="small muted" style={{ margin: 0 }}>It opens already connected to this PC. Then tap <b>Share</b>, <b>Add to Home Screen</b>{standalone ? ", and delete this old icon" : ""}.</p>
        </>
      ) : (
        <>
          <a className="btn primary" href={HOSTED}>Open the website version</a>
          <p className="small muted" style={{ margin: 0 }}>There, type the code shown on your PC, then tap <b>Share</b>, <b>Add to Home Screen</b>{standalone ? ", and delete this old icon" : ""}.</p>
        </>
      )}
    </section>
  );
}
