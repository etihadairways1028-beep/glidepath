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
