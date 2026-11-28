/* Home v3: the iPad follows the gate-to-gate story; on phones each step carries its own screen. */
(function () {
  "use strict";
  var steps = Array.prototype.slice.call(document.querySelectorAll(".g3-step"));
  var shots = Array.prototype.slice.call(document.querySelectorAll(".g3-stage img"));
  if (!steps.length) return;
  var srcOf = {};
  shots.forEach(function (im) { srcOf[im.dataset.shot] = im.getAttribute("src"); });
  steps.forEach(function (s) { if (srcOf[s.dataset.shot]) s.style.setProperty("--shot", "url(" + srcOf[s.dataset.shot] + ")"); });
  function show(key) {
    steps.forEach(function (s) { s.classList.toggle("on", s.dataset.shot === key); });
    shots.forEach(function (im) { im.classList.toggle("on", im.dataset.shot === key); });
  }
  show(steps[0].dataset.shot);
  if (!("IntersectionObserver" in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) show(e.target.dataset.shot); });
  }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
  steps.forEach(function (s) { io.observe(s); });
  // Warm the other screens once the page has settled, so switching never shows a blank iPad.
  window.addEventListener("load", function () { setTimeout(function () { shots.forEach(function (im) { im.loading = "eager"; }); }, 1200); });
  // Pause the hero film when it's off screen (saves battery on iPad).
  var film = document.querySelector(".g3-hero-film");
  if (film) new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) film.play().catch(function () {}); else film.pause(); }); }).observe(film);
})();
/* Try it here: load the real app in demo mode inside the iPad, only when asked. */
(function () {
  "use strict";
  var btn = document.getElementById("try-start"), scr = document.getElementById("try-screen");
  if (!btn || !scr) return;
  btn.addEventListener("click", function () {
    var f = document.createElement("iframe");
    f.src = "app/?demo=1"; f.title = "Glidepath demo flight"; f.loading = "eager";
    f.setAttribute("allow", "fullscreen");
    scr.appendChild(f); btn.remove(); fit();
  });
  function fit() { scr.style.setProperty("--k", String(scr.clientWidth / 1180)); }
  fit(); window.addEventListener("resize", fit);
  // stagger the grid tiles
  document.querySelectorAll(".g3-free-grid li, .g3-app-grid li").forEach(function (li, i) { li.style.setProperty("--i", String(i % 12)); });
})();
/* Liquid glass: the light on each glass card follows the pointer. */
(function () {
  "use strict";
  if (!matchMedia("(pointer: fine)").matches) return;
  var sel = ".g3-free-grid li, .g3-app-grid li, .g3-steps3 li, .g3-card, .dl.glass, .faq-list details";
  document.addEventListener("pointermove", function (e) {
    var el = e.target.closest && e.target.closest(sel); if (!el) return;
    var r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (e.clientX - r.left) + "px"); el.style.setProperty("--my", (e.clientY - r.top) + "px");
  }, { passive: true });
})();
/* Buttons: magnetic pull, ripple on press, light that follows the pointer; cards tilt. */
(function () {
  "use strict";
  var fine = matchMedia("(pointer: fine)").matches, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!fine || reduce) return;
  document.querySelectorAll(".btn.big, .btn.primary, .g3-play").forEach(function (b) {
    b.addEventListener("pointermove", function (e) {
      var r = b.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
      b.style.translate = (x * 0.18).toFixed(1) + "px " + (y * 0.25).toFixed(1) + "px";
      b.style.setProperty("--mx", (e.clientX - r.left) + "px"); b.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
    b.addEventListener("pointerleave", function () { b.style.translate = ""; });
    b.style.transition = (b.style.transition ? b.style.transition + "," : "") + "translate .35s cubic-bezier(.2,1.4,.4,1)";
  });
  document.querySelectorAll(".btn.glass").forEach(function (b) {
    b.addEventListener("pointermove", function (e) { var r = b.getBoundingClientRect(); b.style.setProperty("--mx", (e.clientX - r.left) + "px"); b.style.setProperty("--my", (e.clientY - r.top) + "px"); });
  });
  document.querySelectorAll(".g3-free-grid li, .g3-app-grid li, .g3-steps3 li").forEach(function (c) {
    c.addEventListener("pointermove", function (e) {
      var r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty("--ry", (px * 7).toFixed(2) + "deg"); c.style.setProperty("--rx", (-py * 7).toFixed(2) + "deg");
    });
    c.addEventListener("pointerleave", function () { c.style.setProperty("--ry", "0deg"); c.style.setProperty("--rx", "0deg"); });
  });
})();
/* Real lens glass on the floating pieces (Chromium; others keep the CSS glass). */
if (window.liquidGlass) {
  const pill = { bezel: 18, strength: 60, extra: "blur(0.6px) saturate(190%) brightness(1.1)" };
  const desktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (desktop) window.liquidGlass.watch([[".lg :is(.g3-card, .g3-free-grid li, .g3-app-grid li, .g3-steps3 li, .dl.glass, .faq-list details)", { bezel: 26, strength: 70, extra: "blur(8px) saturate(150%) brightness(1.04)" }]]);
  window.liquidGlass.watch([
    [".lg .nav.glass", { bezel: 20, strength: 64, extra: "blur(1px) saturate(190%) brightness(1.08)" }],
    [".lg :is(.btn, .g3-eye, .g3-works li, .g3-trailer-play, .theme-btn, .menu-btn, .g3-play > span, .g3-try-start, .tm-close)", pill],
  ]);
}
