/**
 * Liquid Glass strength. One number (0–100) sets how clear the glass is, how
 * much it blurs, and how bright its edges are. On desktop Chrome and Edge the
 * glass also bends what's behind it at the edges, like the real thing.
 */
const clamp = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 95)) / 100;

export function applyGlass(level: number): void {
  const L = clamp(level);
  const r = document.documentElement.style;
  const f = (n: number) => n.toFixed(3);
  // Clear body, bright thick rim.
  r.setProperty("--lg-tint", `rgba(20, 22, 36, ${f(0.62 - 0.56 * L)})`);
  r.setProperty("--lg-tint-l", `rgba(255, 255, 255, ${f(0.78 - 0.64 * L)})`);
  r.setProperty("--lg-tint2", `rgba(255, 255, 255, ${f(0.05 + 0.04 * L)})`);
  r.setProperty("--lg-blurpx", `${Math.round(40 - 26 * L)}px`);
  r.setProperty("--lg-rim-a", f(0.35 + 0.6 * L));
  r.setProperty("--lg-edge-a", f(0.08 + 0.3 * L));
  document.documentElement.dataset.lg = L >= 0.6 ? "clear" : "frost";
  installRefraction(L);
}

let installed = false;
function installRefraction(L: number) {
  const root = document.documentElement;
  // Only Chromium can bend the backdrop with an SVG filter; Safari ignores it, so leave it off there.
  const chromium = /Chrome\//.test(navigator.userAgent) && !("ontouchend" in document);
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const on = chromium && fine && L >= 0.6 && !matchMedia("(prefers-reduced-transparency: reduce)").matches;
  root.toggleAttribute("data-refract", on);
  if (!on || installed) return;
  installed = true;
  // A displacement map: neutral in the middle, sloping at the edges, so only the rim bends the light.
  const map = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs>
<linearGradient id="x" x1="0" x2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#000"/></linearGradient>
<filter id="b"><feGaussianBlur stdDeviation="22"/></filter></defs>
<rect width="400" height="400" fill="url(#x)"/><rect width="400" height="400" fill="url(#y)" style="mix-blend-mode:screen"/>
<rect x="34" y="34" width="332" height="332" rx="60" fill="#808000" filter="url(#b)"/></svg>`;
  const href = `data:image/svg+xml;utf8,${encodeURIComponent(map)}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  svg.innerHTML = `<filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feImage href="${href}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>
<feDisplacementMap in="SourceGraphic" in2="map" scale="38" xChannelSelector="R" yChannelSelector="G" result="bent"/>
<feGaussianBlur in="bent" stdDeviation="3"/></filter>`;
  document.body.appendChild(svg);
}
