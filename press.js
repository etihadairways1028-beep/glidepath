/* Liquid press: what happens when you press any button.
   1. The button squashes like a drop of jelly under your finger, then springs back with a wobble.
   2. A ring of glass ripples out from the exact spot you pressed.
   3. Little glass droplets splash out past the edge and fall away.
   4. On release, a streak of light runs across the glass.
   Effects are drawn in a layer above the page, so no button's own markup or
   layout is touched. With "reduce motion" on, only a gentle press remains. */
(function () {
  "use strict";
  if (window.__lqPress) return;
  window.__lqPress = true;

  const SEL = [
    "button", ".btn", "[role='button']", "[role='tab']", ".tab", ".chip", ".ts-chip", ".stat-chip",
    ".launch-app", ".more-tile", ".b-card", ".b-tile", ".v2-pill", ".efb-app", ".radar-btn",
    ".nav a", ".menu-sheet a", ".g3-works li", ".g3-app-grid li a", ".theme-btn", ".cta a",
  ].join(",");
  const SKIP = ".maplibregl-canvas, .maplibregl-ctrl-attrib, [data-no-press]";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  let layer = null;
  function getLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.className = "lqp-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }

  const css = document.createElement("style");
  css.textContent = `
.lqp-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; overflow: hidden; contain: strict; }
.lqp-clip { position: fixed; overflow: hidden; pointer-events: none; }
.lqp-ring { position: absolute; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,0) 44%, rgba(255,255,255,.8) 60%, rgba(190,225,255,.55) 67%, rgba(255,255,255,0) 72%),
              radial-gradient(circle, rgba(255,255,255,.4), rgba(255,255,255,0) 60%); }
.lqp-glow { position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.75), inset 0 0 22px rgba(255,255,255,.45); }
.lqp-streak { position: absolute; top: -20%; bottom: -20%; width: 38%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.75) 50%, transparent); filter: blur(2px); }
.lqp-drop { position: fixed; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 32% 28%, rgba(255,255,255,.95), rgba(255,255,255,.35) 35%, rgba(170,210,255,.18) 60%, rgba(255,255,255,.05) 75%);
  box-shadow: inset -1px -1px 2px rgba(255,255,255,.6), inset 1px 1px 1px rgba(255,255,255,.9), 0 2px 6px rgba(0,0,0,.25); }
.lqp-burst { position: fixed; border-radius: 50%; pointer-events: none; border: 2px solid rgba(255,255,255,.7);
  box-shadow: 0 0 12px rgba(160,210,255,.6), inset 0 0 8px rgba(255,255,255,.5); }
`;
  (document.head || document.documentElement).appendChild(css);

  function radiusOf(el, w, h) {
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return Math.min(r, w / 2, h / 2);
  }

  function clipBox(r, rad) {
    const c = document.createElement("div");
    c.className = "lqp-clip";
    c.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${rad}px`;
    getLayer().appendChild(c);
    return c;
  }

  const ease = { spring: "cubic-bezier(.25, 1.6, .45, 1)", out: "cubic-bezier(.2, .8, .2, 1)" };

  function press(el, e) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const calm = reduce.matches;
    const small = Math.max(r.width, r.height) < 120;

    // 1. squash under the finger (scale is separate from transform, so layouts that use transform are untouched)
    const sx = small ? 0.88 : 0.95, sy = small ? 1.07 : 1.025;
    const to = calm ? "0.97 0.97" : `${sx} ${sy}`;
    if (el.__lqSq) el.__lqSq.anim.cancel();
    const anim = el.animate([{ scale: "1 1" }, { scale: to }], { duration: 110, easing: "ease-out", fill: "forwards" });
    el.__lqSq = { anim, to };
    setTimeout(() => { if (el.__lqSq && el.__lqSq.anim === anim) release(el); }, 2500); // never stay squashed
    if ("vibrate" in navigator) try { navigator.vibrate(6); } catch (_) { /* not allowed */ }
    if (calm) return;

    const rad = radiusOf(el, r.width, r.height);
    const x = (e.clientX || r.left + r.width / 2) - r.left, y = (e.clientY || r.top + r.height / 2) - r.top;

    // 2. glass ripple from the touch point, plus the rim lighting up
    const clip = clipBox(r, rad);
    const size = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2.2;
    const ring = document.createElement("span");
    ring.className = "lqp-ring";
    ring.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px`;
    clip.appendChild(ring);
    ring.animate([{ transform: "scale(0)", opacity: 1 }, { transform: "scale(1)", opacity: 0 }], { duration: 750, easing: ease.out, fill: "forwards" });
    const glow = document.createElement("span");
    glow.className = "lqp-glow";
    clip.appendChild(glow);
    glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 600, easing: "ease-out", fill: "forwards" });

    // 3. droplets splash out past the edge, arc and fall
    const n = small ? 7 : 10;
    const cx = r.left + x, cy = r.top + y;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("span");
      d.className = "lqp-drop";
      const s = 7 + Math.random() * (small ? 8 : 11);
      d.style.cssText = `width:${s}px;height:${s}px;left:${cx - s / 2}px;top:${cy - s / 2}px`;
      getLayer().appendChild(d);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const dist = (small ? 44 : 64) + Math.random() * 46;
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * 0.8 - 18;
      d.animate([
        { transform: "translate(0,0) scale(.3)", opacity: 0 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1.15, .9)`, opacity: 1, offset: 0.22 },
        { transform: `translate(${dx * 0.9}px, ${dy * 0.9 + 14}px) scale(.9, 1)`, opacity: 0.95, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy + 40}px) scale(.5, .75)`, opacity: 0 },
      ], { duration: 700 + Math.random() * 250, easing: "cubic-bezier(.15,.7,.35,1)", fill: "forwards" }).onfinish = () => d.remove();
    }
    // a thin glass shock ring that pops outward around the button
    const burst = document.createElement("span");
    burst.className = "lqp-burst";
    const bs = Math.max(r.width, r.height);
    burst.style.cssText = `width:${bs}px;height:${bs}px;left:${r.left + r.width / 2 - bs / 2}px;top:${r.top + r.height / 2 - bs / 2}px;border-radius:${Math.min(rad * (bs / Math.min(r.width, r.height)), bs / 2)}px`;
    getLayer().appendChild(burst);
    burst.animate([
      { transform: `scale(${r.width / bs}, ${r.height / bs})`, opacity: 0.9 },
      { transform: `scale(${(r.width + 46) / bs}, ${(r.height + 46) / bs})`, opacity: 0 },
    ], { duration: 520, easing: ease.out, fill: "forwards" }).onfinish = () => burst.remove();

    el.__lqp = { clip, r, rad };
    setTimeout(() => clip.remove(), 1400);
  }

  function release(el) {
    const calm = reduce.matches;
    const sq = el.__lqSq;
    el.__lqSq = null;
    const from = sq ? sq.to : "1 1";
    if (sq) sq.anim.cancel();
    // spring back with a wobble, like jelly settling
    el.animate(calm ? [{ scale: from }, { scale: "1 1" }] : [
      { scale: from },
      { scale: "1.07 0.94", offset: 0.28 },
      { scale: "0.97 1.03", offset: 0.55 },
      { scale: "1.015 0.99", offset: 0.78 },
      { scale: "1 1" },
    ], { duration: calm ? 160 : 620, easing: "ease-out" });
    const st = el.__lqp;
    el.__lqp = null;
    if (calm || !st || !st.clip.isConnected) return;
    // 4. a streak of light across the glass
    const streak = document.createElement("span");
    streak.className = "lqp-streak";
    st.clip.appendChild(streak);
    streak.animate([{ left: "-45%" }, { left: "115%" }], { duration: 520, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
  }

  let active = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    const t = e.target;
    if (!t || !t.closest || t.closest(SKIP)) return;
    const el = t.closest(SEL);
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    active = el;
    press(el, e);
  }, { passive: true, capture: true });
  const end = () => { if (active) { release(active); active = null; } };
  document.addEventListener("pointerup", end, { passive: true, capture: true });
  document.addEventListener("pointercancel", end, { passive: true, capture: true });
  // keyboard presses get the same feel
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat && document.activeElement && document.activeElement.matches && document.activeElement.matches(SEL)) {
      const el = document.activeElement, r = el.getBoundingClientRect();
      active = el;
      press(el, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }
  });
  document.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") end(); });
})();
