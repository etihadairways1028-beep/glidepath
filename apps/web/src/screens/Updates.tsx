/**
 * Updates: which version of the app and the Bridge you have, checking for new ones,
 * and every release so far. Installing plays the same short flight as the update banner.
 */
import { useEffect, useState } from "react";
import { APP_VERSION, WHATS_NEW } from "../components/WhatsNew";
import { Icon } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";

interface BridgeUpdate { current: string; latest: string | null; state: string; progress: number; notes: string | null; message: string | null; canInstall: boolean; checkedAt?: number | null }
const onBridge = () => location.protocol === "http:" && location.pathname.startsWith("/app");
const PLANE = "M15 0C15-1.3 13.4-2.2 11.5-2.2H3L-5.5-14h-3l4 11.8H-11L-14.5-7h-2l1.6 4.8V2.2L-16.5 7h2L-11 2.2h6.5l-4 11.8h3L3 2.2h8.5C13.4 2.2 15 1.3 15 0z";

export function UpdatesScreen() {
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const bridgeVersion = useApp((s) => s.status?.bridgeVersion ?? null);
  const [app, setApp] = useState<"idle" | "checking" | "current" | "new" | "offline">("idle");
  const [bu, setBu] = useState<BridgeUpdate | null>(null);
  const [bState, setBState] = useState<"idle" | "checking">("idle");

  const checkApp = async () => {
    if (onBridge() || typeof __BUILD_ID__ === "undefined") { setApp("current"); return; }
    setApp("checking");
    const t0 = Date.now();
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
      const v = r.ok ? (await r.json()) as { build?: string } : null;
      await new Promise((res) => setTimeout(res, Math.max(0, 900 - (Date.now() - t0))));
      setApp(v?.build && v.build !== __BUILD_ID__ ? "new" : "current");
    } catch { setApp("offline"); }
  };
  const checkBridge = async () => {
    const b = activeBridge();
    if (!b || mode !== "bridge") return;
    setBState("checking");
    const t0 = Date.now();
    try { const u = await b.post<BridgeUpdate>("/api/update/check", {}).catch(() => b.get<BridgeUpdate>("/api/update")); setBu(u); } catch { /* older Bridge */ }
    await new Promise((res) => setTimeout(res, Math.max(0, 900 - (Date.now() - t0))));
    setBState("idle");
  };
  useEffect(() => { void checkApp(); }, []);
  useEffect(() => { if (mode === "bridge" && conn === "live") void activeBridge()?.get<BridgeUpdate>("/api/update").then(setBu).catch(() => undefined); }, [mode, conn, bridgeVersion]);
  useEffect(() => { const h = (e: Event) => { const d = (e as CustomEvent).detail as BridgeUpdate | null; if (d) setBu(d); }; window.addEventListener("gp-bridge-update", h); return () => window.removeEventListener("gp-bridge-update", h); }, []);

  const bridgeNew = !!bu && bu.state === "available" && !!bu.latest;
  const allCurrent = app === "current" && (mode !== "bridge" || (bu && !bridgeNew));
  const versions = [...new Set(WHATS_NEW.map((x) => x.v))];

  return (
    <div className="stack upd-page">
      <section className={`upd-hero${allCurrent ? " ok" : ""}${app === "checking" || bState === "checking" ? " busy" : ""}`}>
        <svg viewBox="0 0 600 220" className="uh-sky" aria-hidden="true">
          <defs>
            <radialGradient id="uhg" cx="50%" cy="100%" r="80%"><stop offset="0" stopColor="#0A84FF" stopOpacity=".55" /><stop offset="1" stopColor="#0A84FF" stopOpacity="0" /></radialGradient>
            <linearGradient id="uhl" x1="0" x2="1"><stop offset="0" stopColor="#64D2FF" stopOpacity="0" /><stop offset=".5" stopColor="#64D2FF" /><stop offset="1" stopColor="#5E5CE6" stopOpacity="0" /></linearGradient>
          </defs>
          <rect width="600" height="220" fill="url(#uhg)" />
          <circle cx="300" cy="250" r="170" className="uh-ring r1" /><circle cx="300" cy="250" r="125" className="uh-ring r2" /><circle cx="300" cy="250" r="80" className="uh-ring r3" />
          <path id="uh-orbit" d="M60 210 C 160 40, 440 40, 540 210" fill="none" stroke="url(#uhl)" strokeWidth="2.5" strokeLinecap="round" className="uh-path" />
          <g className="uh-plane"><path d={PLANE} fill="#fff" transform="scale(1.3)" /></g>
        </svg>
        <div className="uh-text">
          <div className="uh-state">{allCurrent ? <><span className="uh-tick">✓</span> Everything is up to date</> : app === "checking" || bState === "checking" ? "Checking for updates…" : app === "new" || bridgeNew ? "An update is ready" : "Updates"}</div>
          <h1>Updates</h1>
          <p>Glidepath keeps itself current: the app switches to new versions by itself, and the Bridge installs its updates while the sim is closed.</p>
        </div>
      </section>

      <div className="grid cols-2 upd-cards">
        <section className="glass updc">
          <div className="uv-top"><span className="uv-ic">{Icon.home()}</span><div><b>Glidepath app</b><span className="data">Version {APP_VERSION}</span></div></div>
          <p className="muted">{app === "new" ? "A newer version is on the website." : app === "offline" ? "Couldn't check right now. Glidepath checks again by itself." : onBridge() ? "This copy comes from your Bridge and updates with it." : "On this device, the app updates by itself."}</p>
          <div className="uv-row">
            {app === "new"
              ? <button className="btn primary" onClick={() => window.dispatchEvent(new Event("gp-update-app"))}>Update now</button>
              : <button className="btn" disabled={app === "checking"} onClick={() => void checkApp()}>{app === "checking" ? <span className="uv-spin" aria-label="Checking" /> : app === "current" ? "Up to date ✓" : "Check now"}</button>}
          </div>
        </section>
        <section className="glass updc">
          <div className="uv-top"><span className="uv-ic b">{Icon.gear()}</span><div><b>Glidepath Bridge</b><span className="data">{mode === "demo" ? "Demo flight running" : bridgeVersion ? `Version ${bridgeVersion}` : "Not connected"}</span></div></div>
          <p className="muted">{mode !== "bridge" ? "Connect your PC to see its Bridge version." : bridgeNew ? `Version ${bu!.latest} is ready.${bu!.canInstall ? " Windows asks once on the PC." : ""}` : bu?.state === "error" ? bu.message ?? "The last check didn't work." : "Installs updates by itself while the sim is closed, never during a flight."}</p>
          <div className="uv-row">
            {mode !== "bridge" ? <a className="btn" href="#/settings">Connect</a>
              : bridgeNew && bu!.canInstall ? <button className="btn primary" onClick={() => window.dispatchEvent(new Event("gp-update-bridge"))}>Update now</button>
              : bridgeNew ? <a className="btn primary" href="https://glidepath-ad9.pages.dev/#download" target="_blank" rel="noreferrer">Download</a>
              : <button className="btn" disabled={bState === "checking"} onClick={() => void checkBridge()}>{bState === "checking" ? <span className="uv-spin" aria-label="Checking" /> : bu && !bridgeNew ? "Up to date ✓" : "Check now"}</button>}
          </div>
        </section>
      </div>

      <section className="glass upd-log">
        <h2>Release notes</h2>
        <ol className="ul-time">
          {versions.map((v, k) => (
            <li key={v} style={{ animationDelay: `${k * 70}ms` }}>
              <div className="ul-dot" aria-hidden="true" />
              <div className="ul-v"><b className="data">{v}</b>{v === APP_VERSION && <span className="ul-now">You have this</span>}</div>
              <ul>{WHATS_NEW.filter((x) => x.v === v).map((x) => <li key={x.t}><b>{x.t}</b><span>{x.d}</span></li>)}</ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
