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
