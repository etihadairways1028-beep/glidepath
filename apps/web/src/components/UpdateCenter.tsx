/**
 * Updates, asked for rather than forced:
 *  - The app: a new build on the website → "Glidepath has an update" → Update reloads into it.
 *  - The Bridge: a newer 1.x → "Bridge 1.0.1 is ready" → Update downloads, checks and installs it
 *    on the PC (Windows asks once there), then the Bridge restarts and the app reconnects.
 * Both show the same short flight from the old version to the new one.
 */
import { useEffect, useRef, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";

interface BridgeUpdate { current: string; latest: string | null; state: string; progress: number; notes: string | null; message: string | null; canInstall: boolean }

/** The Bridge serves its own copy of the app at /app over http; that copy updates with the Bridge. */
const onBridge = () => location.protocol === "http:" && location.pathname.startsWith("/app");

const PLANE = "M15 0C15-1.3 13.4-2.2 11.5-2.2H3L-5.5-14h-3l4 11.8H-11L-14.5-7h-2l1.6 4.8V2.2L-16.5 7h2L-11 2.2h6.5l-4 11.8h3L3 2.2h8.5C13.4 2.2 15 1.3 15 0z";
const ROUTE = "M70 160C210 20 430 20 570 160";

interface Flight { title: string; from: string; to: string; target: number; step: number; label: string; pct: string; msg: string; done: boolean; failed: boolean }

/** The update flight. `target` is 0..1 along the route; the plane eases toward it. */
export function UpdateFlight({ f, onClose }: { f: Flight; onClose?: () => void }) {
  const route = useRef<SVGPathElement>(null), flown = useRef<SVGPathElement>(null), plane = useRef<SVGGElement>(null);
  const target = useRef(f.target);
  target.current = f.target;
  useEffect(() => {
    let shown = 0, bob = 0, raf = 0;
    const tick = () => {
      const r = route.current, p = plane.current, fl = flown.current;
      if (r && p && fl) {
        bob += 0.03;
        const t = target.current, goal = t + (t > 0.75 && t < 0.99 ? Math.sin(bob) * 0.012 : 0);
        shown += (goal - shown) * 0.06;
        const L = r.getTotalLength(), s = Math.max(0, Math.min(1, shown));
        const a = r.getPointAtLength(s * L), b = r.getPointAtLength(Math.min(L, s * L + 2)), c = r.getPointAtLength(Math.max(0, s * L - 2));
        p.setAttribute("transform", `translate(${a.x},${a.y}) rotate(${(Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI})`);
        fl.setAttribute("stroke-dasharray", `${s} 1`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const steps = ["Download", "Check", "Install", "Restart"];
  return (
    <div className={`upd-ov${f.done ? " ok" : ""}`} role="dialog" aria-modal="true" aria-label={f.title}>
      <div className="upd-card glass strong">
        <div className="upd-cap">{f.title}</div>
        <svg className="upd-map" viewBox="0 0 640 210" aria-hidden="true">
          <defs>
            <linearGradient id="updg" x1="0" x2="1"><stop offset="0" stopColor="#5E5CE6" /><stop offset="1" stopColor="#64D2FF" /></linearGradient>
            <pattern id="updd" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(255,255,255,.08)" /></pattern>
          </defs>
          <rect width="640" height="210" fill="url(#updd)" />
          <path ref={route} d={ROUTE} fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 9" />
          <path ref={flown} d={ROUTE} fill="none" stroke="url(#updg)" strokeWidth="3.5" strokeLinecap="round" pathLength={1} strokeDasharray="0 1" />
          <circle cx="70" cy="160" r="7" fill="#fff" />
          <circle cx="570" cy="160" r="7" className="upd-dest" />
          <text x="70" y="192" textAnchor="middle" className="upd-v">{f.from}</text>
          <text x="570" y="192" textAnchor="middle" className="upd-v">{f.to}</text>
          <g ref={plane}><path d={PLANE} fill="#fff" transform="scale(1.25)" /></g>
        </svg>
        <div className="upd-row"><span>{f.label}</span><span className="upd-pct">{f.pct}</span></div>
        <div className="upd-steps">{steps.map((s, i) => <span key={s} className={i < f.step || f.done ? "done" : i === f.step ? "on" : ""}>{s}</span>)}</div>
        <p className="upd-msg">{f.msg}</p>
        {(f.failed || f.done) && onClose && <div className="upd-foot"><button className="btn" onClick={onClose}>Close</button></div>}
      </div>
    </div>
  );
}

export function UpdateCenter() {
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const bridgeVersion = useApp((s) => s.status?.bridgeVersion ?? null);
  const [web, setWeb] = useState(false);
  const [bu, setBu] = useState<BridgeUpdate | null>(null);
  const [later, setLater] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const goingTo = useRef<string | null>(null);

  // A new build of the app on the website (the Bridge's own copy updates with the Bridge).
  useEffect(() => {
    if (onBridge() || typeof __BUILD_ID__ === "undefined") return;
    const look = () => void fetch(`version.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { build?: string } | null) => { if (v?.build && v.build !== __BUILD_ID__) setWeb(true); })
      .catch(() => undefined);
    look();
    const t = window.setInterval(look, 10 * 60_000);
    const vis = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // A newer Bridge, asked of the Bridge itself (older Bridges don't know and say 404: fine).
  useEffect(() => {
    if (mode !== "bridge" || conn !== "live" || flight) return;
    const look = () => void activeBridge()?.get<BridgeUpdate>("/api/update").then(setBu).catch(() => undefined);
    look();
    const t = window.setInterval(look, 30 * 60_000);
    return () => window.clearInterval(t);
  }, [mode, conn, flight]);

  // During a Bridge update: follow it, through the restart, until the new version says hello.
  useEffect(() => {
    if (!flight || flight.done || flight.failed || !goingTo.current || flight.title !== "Updating Glidepath Bridge") return;
    if (bridgeVersion === goingTo.current && conn === "live") {
      setFlight((f) => f && { ...f, target: 1, step: 4, label: `Updated to ${goingTo.current}`, pct: "", msg: "The Bridge is back with the new version.", done: true });
      setBu(null);
      return;
    }
    let stop = false;
    const started = Date.now();
    const poll = async () => {
      while (!stop) {
        const b = activeBridge();
        let u: BridgeUpdate | null = null;
        if (conn === "live" && b) { try { u = await b.get<BridgeUpdate>("/api/update"); } catch { u = null; } }
        if (stop) return;
        if (u?.state === "downloading") setFlight((f) => f && { ...f, target: 0.04 + 0.56 * u!.progress, step: 0, label: "Downloading", pct: `${Math.round(u!.progress * 100)}%`, msg: "" });
        else if (u?.state === "verifying") setFlight((f) => f && { ...f, target: 0.64, step: 1, label: "Checking the download", pct: "", msg: "Making sure it's exactly the file we published." });
        else if (u?.state === "installing") setFlight((f) => f && { ...f, target: 0.8, step: 2, label: "Installing", pct: "", msg: "On the PC, Windows asks to allow the update. Click Yes there." });
        else if (u?.state === "error") { setFlight((f) => f && { ...f, label: "Update stopped", pct: "", msg: u!.message ?? "Something went wrong.", failed: true }); return; }
        else if (!u) setFlight((f) => f && { ...f, target: 0.93, step: 3, label: "Restarting the Bridge", pct: "", msg: Date.now() - started > 120_000 ? "Still waiting. Check the PC: Windows may be asking to allow the update." : "If Windows asks on the PC, click Yes." });
        await new Promise((r) => setTimeout(r, 800));
      }
    };
    void poll();
    return () => { stop = true; };
  }, [flight?.title, flight?.done, flight?.failed, conn, bridgeVersion]);

  // After landing, close by itself.
  useEffect(() => {
    if (!flight?.done || flight.title !== "Updating Glidepath Bridge") return;
    const t = window.setTimeout(() => setFlight(null), 3500);
    return () => window.clearTimeout(t);
  }, [flight?.done, flight?.title]);

  const updateApp = async () => {
    setFlight({ title: "Updating Glidepath", from: "now", to: "new", target: 0.1, step: 0, label: "Getting the new version", pct: "", msg: "", done: false, failed: false });
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
      setFlight((f) => f && { ...f, target: 0.55, step: 1, label: "Getting the new version" });
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
      setFlight((f) => f && { ...f, target: 0.85, step: 2, label: "Almost there" });
    } catch { /* reload anyway */ }
    window.setTimeout(() => setFlight((f) => f && { ...f, target: 1, step: 3, label: "Landing", done: true }), 900);
    window.setTimeout(() => location.reload(), 2200);
  };

  const updateBridge = async () => {
    const b = activeBridge();
    const cur = bu ?? await b?.get<BridgeUpdate>("/api/update").catch(() => null) ?? null;
    if (!b || !cur?.latest) return;
    if (!bu) setBu(cur);
    const bu2 = cur;
    goingTo.current = bu2.latest;
    setFlight({ title: "Updating Glidepath Bridge", from: bu2.current, to: bu2.latest!, target: 0.03, step: 0, label: "Starting", pct: "", msg: "", done: false, failed: false });
    try { await b.post("/api/update/install", {}); }
    catch (e) { setFlight((f) => f && { ...f, label: "Update stopped", msg: (e as Error).message, failed: true }); }
  };

  // The Updates page (and the app's own new-version check) start these.
  const fns = useRef({ updateApp, updateBridge, bu });
  fns.current = { updateApp, updateBridge, bu };
  useEffect(() => {
    (window as unknown as { __gpUpdHandled?: boolean }).__gpUpdHandled = true;
    const a = () => void fns.current.updateApp();
    const b = () => void fns.current.updateBridge();
    window.addEventListener("gp-update-app", a); window.addEventListener("gp-update-bridge", b);
    return () => { window.removeEventListener("gp-update-app", a); window.removeEventListener("gp-update-bridge", b); (window as unknown as { __gpUpdHandled?: boolean }).__gpUpdHandled = false; };
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent("gp-bridge-update", { detail: bu })); }, [bu]);

  const bridgeReady = !!bu && bu.state === "available" && !!bu.latest && later !== `bridge-${bu.latest}` && mode === "bridge";
  return (
    <>
      {!flight && (web && later !== "web" ? (
        <div className="upd-bar glass">
          <span className="upd-ic"><svg viewBox="-17 -15 34 30"><path d={PLANE} fill="currentColor" /></svg></span>
          <span className="upd-txt"><b>Glidepath has an update.</b> It takes a few seconds.</span>
          <button className="btn ghost sm" onClick={() => setLater("web")}>Later</button>
          <button className="btn primary sm" onClick={() => void updateApp()}>Update</button>
        </div>
      ) : bridgeReady ? (
        <div className="upd-bar glass">
          <span className="upd-ic"><svg viewBox="-17 -15 34 30"><path d={PLANE} fill="currentColor" /></svg></span>
          <span className="upd-txt"><b>Bridge {bu!.latest} is ready.</b> {bu!.canInstall ? "Update it from here; Windows asks once on the PC." : "Download it from the Glidepath website on your PC."}</span>
          <button className="btn ghost sm" onClick={() => setLater(`bridge-${bu!.latest}`)}>Later</button>
          {bu!.canInstall
            ? <button className="btn primary sm" onClick={() => void updateBridge()}>Update</button>
            : <a className="btn primary sm" href="https://glidepath-ad9.pages.dev/#download" target="_blank" rel="noreferrer">Download</a>}
        </div>
      ) : null)}
      {flight && <UpdateFlight f={flight} onClose={() => setFlight(null)} />}
    </>
  );
}
