/* Day and night: follows your device until you pick one, then remembers it. */
(function () {
  "use strict";
  var root = document.documentElement;
  function set(t) { root.dataset.theme = t; var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "light" ? "#DCEEFC" : "#050B1C"); }
  set(root.dataset.theme === "light" ? "light" : "dark");
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (!b) return;
    var t = root.dataset.theme === "light" ? "dark" : "light";
    set(t);
    try { localStorage.setItem("gp-theme", t); } catch (_) { /* private mode */ }
  });
  try {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", function (q) {
      if (!localStorage.getItem("gp-theme")) set(q.matches ? "light" : "dark");
    });
  } catch (_) { /* old browsers */ }
})();
