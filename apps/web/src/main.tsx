import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyLook } from "./components/Look";
import { App } from "./App";
import "./styles.css";
import "./extra.css";
import "./liquid.css";
import "./glass.css";
import "./apple.css";
import "./system.css";
import "./v2.css";
import { installHover, installPop, installRipple } from "./hover";
installHover();
installRipple();
installPop();

// iPad and iPhone Safari only show the pressed (:active) look when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
applyLook();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Offline app shell, only where browsers allow service workers (the hosted https site).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}
// The hosted app and the copy your Bridge serves both keep themselves up to date.
if (location.protocol === "https:" || location.pathname.startsWith("/app")) keepCurrent();

/**
 * Always the newest Glidepath, with nothing to reinstall: every 10 minutes, and whenever you come back
 * to the app, look at the published page. If it points at a newer build than the one running, switch to it
 * (straight away while the app is in the background, otherwise after a short notice).
 */
function keepCurrent(): void {
  const mine = [...document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")].map((x) => new URL(x.src, location.href).pathname).find((x) => /\/assets\/index-/.test(x));
  if (!mine) return;
  let busy = false, shown = false;
  const check = async () => {
    if (busy || !navigator.onLine) return;
    busy = true;
    try {
      const r = await fetch(`./index.html?v=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const html = await r.text();
      const live = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
      if (!live || mine.endsWith(live)) return;
      // Never loop: one try per new build.
      try { if (sessionStorage.getItem("gp-upd") === live) return; sessionStorage.setItem("gp-upd", live); } catch { /* storage off */ }
      const go = async () => {
        try { const ks = (await caches?.keys?.()) ?? []; await Promise.all(ks.map((k) => caches.delete(k))); } catch { /* reload anyway */ }
        location.reload();
      };
      if (document.visibilityState === "hidden") return void go();
      // The app's update flight (it reloads at the end); a plain notice if the app isn't up.
      if ((window as unknown as { __gpUpdHandled?: boolean }).__gpUpdHandled) { window.dispatchEvent(new Event("gp-update-app")); return; }
      if (shown) return;
      shown = true;
      const n = document.createElement("div");
      n.className = "gp-updating glass strong";
      n.setAttribute("role", "status");
      n.textContent = "Updating to the newest Glidepath…";
      document.body.appendChild(n);
      window.setTimeout(() => void go(), 2500);
    } catch { /* offline */ } finally { busy = false; }
  };
  window.setTimeout(() => void check(), 8000);
  window.setInterval(() => void check(), 10 * 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
}

/* Real lens glass on the floating controls (Chromium; other browsers keep the CSS glass). */
{
  type LG = { watch: (rules: [string, { bezel?: number; strength?: number; extra?: string }][]) => void };
  const start = () => {
    const lg = (window as unknown as { liquidGlass?: LG }).liquidGlass;
    if (!lg) return;
    // Only the few floating bars bend the background: lensing every card and button
    // costs too much while scrolling.
    const rules: [string, { bezel?: number; strength?: number; extra?: string }][] = [
      [".tabbar", { bezel: 22, strength: 56, extra: "blur(1px) saturate(140%) brightness(1.04)" }],
      [".v2-pill, .v2-top .side-clock", { bezel: 18, strength: 46, extra: "blur(1px) saturate(140%) brightness(1.04)" }],
    ];
    lg.watch(rules);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}
