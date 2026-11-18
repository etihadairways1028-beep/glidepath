/**
 * Pointer-driven hover effects: buttons get a light that follows the cursor,
 * cards tilt a little towards it. Only on devices with a real mouse, and never
 * when the person has asked for reduced motion.
 */
const SEL_LIGHT = ".btn, .nav-a, .seg button, .rc-tog, .cl-link, .ch-list button, .tab";
const SEL_TILT = ".tile, .badge, .rc-target, .welcome-feats li, .tl-card, .board-row:not(.hd)";

export function installHover(): void {
  if (typeof window === "undefined") return;
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let tilted: HTMLElement | null = null;
  document.addEventListener("pointermove", (e) => {
    const t = e.target as Element | null;
    const light = t?.closest?.(SEL_LIGHT) as HTMLElement | null;
    if (light) {
      const r = light.getBoundingClientRect();
      light.style.setProperty("--hx", `${e.clientX - r.left}px`);
      light.style.setProperty("--hy", `${e.clientY - r.top}px`);
    }
    const tilt = t?.closest?.(SEL_TILT) as HTMLElement | null;
    if (tilted && tilted !== tilt) { tilted.style.removeProperty("--rx"); tilted.style.removeProperty("--ry"); }
    if (tilt) {
      const r = tilt.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.setProperty("--rx", `${(x * 7).toFixed(2)}deg`);
      tilt.style.setProperty("--ry", `${(-y * 7).toFixed(2)}deg`);
      tilt.style.setProperty("--hx", `${e.clientX - r.left}px`);
      tilt.style.setProperty("--hy", `${e.clientY - r.top}px`);
    }
    tilted = tilt;
  }, { passive: true });
}

/** A liquid ripple from the exact spot you press, on every button. */
export function installRipple(): void {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Touch screens (iPad, iPhone) get a plain press state instead: moving glass flickers in Safari.
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  document.addEventListener("pointerdown", (e) => {
    const b = (e.target as Element | null)?.closest?.(".btn, .rc-tog, .seg button, .nav-a, .tab") as HTMLElement | null;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement("span");
    s.className = "gp-ripple";
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.style.overflow = "hidden";
    b.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }, { passive: true });
}

const SEL_POP = ".btn, .rc-tog, .seg button, .chip-btn, .quick-a, .more-tile, .cr-tile, .rc-steps button, .radar-btn, .radar-play, .wn-go, .basemap, .wall-sw, .tab, .nav-a";
/**
 * On release, the button springs past its size and settles, and a ring bursts outward from it.
 * Every device (touch included: it animates `scale` and `outline`, not the glass), never with reduced motion.
 */
export function installPop(): void {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.addEventListener("pointerup", (e) => {
    const b = (e.target as Element | null)?.closest?.(SEL_POP) as HTMLElement | null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    // A data attribute, not a class: React rewrites className when a toggle changes state.
    b.removeAttribute("data-pop");
    void b.offsetWidth; // restart the animation on quick repeat presses
    b.setAttribute("data-pop", "");
    const done = (ev: AnimationEvent) => {
      if (ev.target !== b || ev.animationName !== "gpRing") return;
      b.removeAttribute("data-pop"); b.removeEventListener("animationend", done);
    };
    b.addEventListener("animationend", done);
    window.setTimeout(() => b.removeAttribute("data-pop"), 3000); // in case the animation never runs
  }, { passive: true });
}
