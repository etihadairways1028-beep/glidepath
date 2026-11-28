/* Liquid cursor: a drop of glass that follows the mouse.
   - The main drop springs after the pointer and stretches with its speed.
   - Two smaller droplets trail behind it, like liquid pulled along.
   - Over anything you can click it swells, wobbles and lights up.
   - On Chrome and Edge it bends what's behind it (liquid.js); elsewhere it's clear glass.
   Mouse only: it waits for a real mouse movement, so touch screens never see it.
   With "reduce motion" on it still follows the pointer, but without stretching or trails.
   The normal cursor stays visible, so nothing about pointing changes. */
(function () {
  "use strict";
  if (window.__lqCursor) return;
  window.__lqCursor = true;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  var css = document.createElement("style");
  css.textContent = [
    ".lqc { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2147482000; border-radius: 50%; opacity: 0; will-change: transform; transition: opacity .35s, width .45s cubic-bezier(.2,1.5,.4,1), height .45s cubic-bezier(.2,1.5,.4,1), margin .45s cubic-bezier(.2,1.5,.4,1); }",
    ".lqc.on { opacity: 1; }",
    ".lqc-main { width: 58px; height: 58px; margin: -29px 0 0 -29px;",
    "  background: radial-gradient(70% 60% at 32% 26%, rgba(255,255,255,.55), rgba(255,255,255,.08) 42%, rgba(255,255,255,0) 62%), radial-gradient(60% 40% at 60% 92%, rgba(255,255,255,.28), transparent 70%);",
    "  box-shadow: inset 2.5px 2.5px 1px -1px rgba(255,255,255,.95), inset -2px -2px 1px -1px rgba(255,255,255,.55), inset 0 0 0 1px rgba(255,255,255,.28), inset 0 0 16px rgba(255,255,255,.22), inset 0 -8px 14px -8px rgba(160,200,255,.45), 0 10px 26px -8px rgba(0,0,0,.45);",
    "  -webkit-backdrop-filter: blur(1px) saturate(190%) brightness(1.14); backdrop-filter: blur(1px) saturate(190%) brightness(1.14); }",
    ".lqc-main.big { width: 92px; height: 92px; margin: -46px 0 0 -46px; box-shadow: inset 3px 3px 1px -1px #fff, inset -2.5px -2.5px 1px -1px rgba(255,255,255,.6), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 0 26px rgba(255,255,255,.3), 0 0 26px rgba(120,170,255,.45), 0 14px 32px -10px rgba(0,0,0,.45); }",
    ".lqc-main.down { width: 44px; height: 44px; margin: -22px 0 0 -22px; }",
    ".lqc-t { background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.9), rgba(255,255,255,.25) 40%, rgba(180,215,255,.12) 65%, rgba(255,255,255,.04));",
    "  box-shadow: inset 1px 1px 1px rgba(255,255,255,.9), inset -1px -1px 1px rgba(255,255,255,.4), 0 3px 8px rgba(0,0,0,.3);",
    "  -webkit-backdrop-filter: blur(1px) saturate(170%) brightness(1.1); backdrop-filter: blur(1px) saturate(170%) brightness(1.1); }",
    ".lqc-t1 { width: 20px; height: 20px; margin: -10px 0 0 -10px; }",
    ".lqc-t2 { width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; }",
    "@keyframes lqcWobble { 0% { border-radius: 50%; } 25% { border-radius: 58% 42% 55% 45% / 45% 55% 45% 55%; } 50% { border-radius: 44% 56% 46% 54% / 56% 44% 56% 44%; } 75% { border-radius: 53% 47% 50% 50% / 48% 52% 50% 50%; } 100% { border-radius: 50%; } }",
    ".lqc-main.big { animation: lqcWobble 1.6s ease-in-out infinite; }",
    "@media (prefers-reduced-motion: reduce) { .lqc-main.big { animation: none; } .lqc-t { display: none; } }",
    "@media print { .lqc { display: none !important; } }",
  ].join("\n");

  var main, t1, t2, started = false;
  function make(cls) { var e = document.createElement("div"); e.className = "lqc " + cls; e.setAttribute("aria-hidden", "true"); document.body.appendChild(e); return e; }
  function start() {
    if (started) return;
    started = true;
    (document.head || document.documentElement).appendChild(css);
    main = make("lqc-main");
    if (!reduce) { t1 = make("lqc-t lqc-t1"); t2 = make("lqc-t lqc-t2"); }
    // Bend the background through the glass where the browser can (liquid.js loads before or after this).
    var lens = function () {
      if (!window.liquidGlass) return false;
      window.liquidGlass.attach(main, { bezel: 26, strength: 84, extra: "saturate(190%) brightness(1.14)" });
      if (t1) window.liquidGlass.attach(t1, { bezel: 9, strength: 26, extra: "saturate(170%) brightness(1.1)" });
      return true;
    };
    if (!lens()) addEventListener("load", lens, { once: true });
    requestAnimationFrame(tick);
  }

  var CLICKABLE = "a, button, summary, label, select, input, textarea, [role='button'], [role='tab'], .btn, .chip, .more-tile, .b-card, .launch-app, .tab, li";
  var tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, ax1 = 0, ay1 = 0, ax2 = 0, ay2 = 0, shown = false, last = 0;

  addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    if (!started) { start(); x = ax1 = ax2 = e.clientX; y = ay1 = ay2 = e.clientY; }
    tx = e.clientX; ty = e.clientY; last = performance.now();
    if (!shown) { shown = true; main.classList.add("on"); if (t1) { t1.classList.add("on"); t2.classList.add("on"); } }
    var t = e.target;
    main.classList.toggle("big", !!(t && t.closest && t.closest(CLICKABLE)));
    // Not over embedded pages (the "Try it" iPad) or the 3D map, where it would get in the way.
    var hide = !!(t && t.closest && t.closest("iframe, canvas, .maplibregl-map, input, textarea, [contenteditable]"));
    main.style.visibility = hide ? "hidden" : "";
    if (t1) { t1.style.visibility = t2.style.visibility = main.style.visibility; }
  }, { passive: true });
  addEventListener("pointerdown", function (e) { if (main && e.pointerType === "mouse") main.classList.add("down"); }, { passive: true });
  addEventListener("pointerup", function () { if (main) main.classList.remove("down"); }, { passive: true });
  document.addEventListener("mouseleave", function () { if (!main) return; shown = false; main.classList.remove("on"); if (t1) { t1.classList.remove("on"); t2.classList.remove("on"); } });

  function place(el, px, py, sx, sy, ang) {
    el.style.transform = "translate(" + px.toFixed(1) + "px," + py.toFixed(1) + "px)" + (ang != null ? " rotate(" + ang.toFixed(1) + "deg) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")" : "");
  }
  function tick() {
    if (reduce) {
      x = tx; y = ty; place(main, x, y);
    } else {
      // a springy follow: pulled toward the pointer, with a little overshoot
      vx = vx * 0.6 + (tx - x) * 0.17; vy = vy * 0.6 + (ty - y) * 0.17; x += vx; y += vy;
      var sp = Math.min(Math.hypot(vx, vy), 44), st = 1 + sp / 50;
      place(main, x, y, st, 1 / Math.sqrt(st), Math.atan2(vy, vx) * 180 / Math.PI);
      // trailing droplets: each follows the one in front, more lazily
      ax1 += (x - ax1) * 0.22; ay1 += (y - ay1) * 0.22; ax2 += (ax1 - ax2) * 0.2; ay2 += (ay1 - ay2) * 0.2;
      place(t1, ax1, ay1); place(t2, ax2, ay2);
      // the trail tucks back into the drop when the mouse rests
      var still = performance.now() - last > 260 && Math.hypot(x - ax2, y - ay2) < 3;
      t1.style.opacity = t2.style.opacity = still ? "0" : "";
    }
    requestAnimationFrame(tick);
  }
})();
