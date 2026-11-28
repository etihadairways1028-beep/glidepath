/* Liquid glass lens.
   For each glass element, draw a refraction map that matches its exact size and
   corner radius: the middle is left clear, and toward the rim the background is
   pulled in from further inside, like looking through the thick rounded edge of
   a glass slab. Red, green and blue bend by slightly different amounts, which
   gives the faint rainbow fringe real glass has.
   Only Chromium can use an SVG filter as a backdrop; other browsers keep the
   CSS-only glass (clear middle, bright rim) and this script does nothing. */
(function () {
  const ua = navigator.userAgentData;
  const chromium = !!(ua && ua.brands && ua.brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)));
  const reduce = matchMedia("(prefers-reduced-transparency: reduce)").matches;
  if (!chromium || reduce || !CSS.supports("backdrop-filter", "url(#x)")) return;

  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  const ready = () => document.body.appendChild(svg);
  if (document.body) ready(); else addEventListener("DOMContentLoaded", ready);

  const maps = new Map();
  let n = 0;

  /* Refraction map for a rounded rectangle, drawn at half size (the filter scales it up smoothly). */
  function makeMap(w, h, r, bezel) {
    const key = w + "x" + h + "r" + r + "b" + bezel;
    if (maps.has(key)) return maps.get(key);
    const q = 2;
    const W = Math.max(2, Math.round(w / q)), H = Math.max(2, Math.round(h / q));
    const R = r / q, B = Math.max(1, bezel / q);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const hx = W / 2, hy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = x + 0.5 - hx, py = y + 0.5 - hy;
        const ax = Math.abs(px), ay = Math.abs(py);
        const qx = ax - (hx - R), qy = ay - (hy - R);
        let dist, nx, ny;
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1;
          dist = R - l; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py);
        } else if (qx > qy) {
          dist = R - qx; nx = Math.sign(px); ny = 0;
        } else {
          dist = R - qy; nx = 0; ny = Math.sign(py);
        }
        let m = 0;
        if (dist < B) {
          const t = 1 - Math.max(0, dist) / B; // 1 at the rim, 0 where the flat middle starts
          m = t * t * (1.6 - 0.6 * t);         // grows smoothly toward the edge, strongest at the rim
        }
        const i = (y * W + x) * 4;
        d[i] = 128 - nx * m * 127;     // pull from inside: point the sample toward the centre
        d[i + 1] = 128 - ny * m * 127;
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    maps.set(key, url);
    return url;
  }

  function filterFor(el, id, w, h, r, bezel, strength) {
    let f = svg.querySelector("#" + id);
    if (!f) {
      f = document.createElementNS(NS, "filter");
      f.id = id;
      svg.appendChild(f);
    }
    f.setAttribute("x", "0"); f.setAttribute("y", "0");
    f.setAttribute("width", w); f.setAttribute("height", h);
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    const s = strength;
    f.innerHTML =
      `<feImage href="${makeMap(w, h, r, bezel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="0.4" result="src"/>` +
      `<feDisplacementMap in="src" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="dr"/>` +
      `<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>` +
      `<feDisplacementMap in="src" in2="map" scale="${s * 0.965}" xChannelSelector="R" yChannelSelector="G" result="dg"/>` +
      `<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>` +
      `<feDisplacementMap in="src" in2="map" scale="${s * 0.93}" xChannelSelector="R" yChannelSelector="G" result="db"/>` +
      `<feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>` +
      `<feBlend in="r" in2="g" mode="screen" result="rg"/>` +
      `<feBlend in="rg" in2="b" mode="screen"/>`;
  }

  const state = new WeakMap();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) schedule(e.target);
  });
  const pending = new Set();
  let raf = 0;
  function schedule(el) {
    pending.add(el);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const list = [...pending]; pending.clear(); list.forEach(apply); });
  }

  function apply(el) {
    const st = state.get(el);
    if (!st || !el.isConnected) return;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return;
    let r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    r = Math.min(r, w / 2, h / 2);
    const bezel = Math.max(6, Math.min(st.bezel, Math.min(w, h) * 0.34));
    const sig = w + "," + h + "," + r;
    if (st.sig === sig) return;
    st.sig = sig;
    filterFor(el, st.id, w, h, r, bezel, st.strength);
    el.style.setProperty("backdrop-filter", `url(#${st.id}) ${st.extra}`, "important");
    el.classList.add("lq-lens");
  }

  /* opts: bezel (px of curved rim), strength (px the rim bends the background), extra (more backdrop filters) */
  function attach(el, opts) {
    if (state.has(el)) return;
    state.set(el, {
      id: "lq" + n++,
      bezel: (opts && opts.bezel) || 18,
      strength: (opts && opts.strength) || 60,
      extra: (opts && opts.extra) || "blur(1.5px) saturate(185%) brightness(1.08)",
      sig: "",
    });
    ro.observe(el);
    schedule(el);
  }

  /* rules: [[selector, opts], ...]. Re-scans when the page changes (single-page apps). */
  function watch(rules) {
    const scan = () => {
      for (const [sel, o] of rules) document.querySelectorAll(sel).forEach((el) => attach(el, o));
    };
    scan();
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.liquidGlass = { attach, watch };
})();
