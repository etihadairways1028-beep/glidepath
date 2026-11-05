/* Glidepath site: demo replay of the SYNTHETIC test flight (demo-flight.json,
   produced by running the real flight engine) plus download wiring. */
(function () {
  "use strict";
  const cfg = window.GLIDEPATH || {};
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- download + repo links ---------- */
  const repoUrl = cfg.repo ? "https://github.com/" + cfg.repo : "#";
  document.querySelectorAll("[data-repo-link]").forEach((a) => (a.href = repoUrl));
  const dlUrl = cfg.downloadUrl || "#download";
  document.querySelectorAll("[data-download]").forEach((a) => {
    a.href = dlUrl;
    if (cfg.downloadUrl) a.setAttribute("download", "");
  });
  if (cfg.sha256) $("sha").textContent = cfg.sha256;
  if (cfg.version) {
    $("build-line").textContent = "Early test build " + cfg.version + ". Not code-signed yet, so Windows asks you to confirm before it opens.";
    $("download-title").textContent = "Glidepath Bridge " + cfg.version + " for Windows";
  }

  /* ---------- reveal on scroll ---------- */
  const reveals = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) reveals.forEach((n) => n.classList.add("in"));
  else {
    const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach((n) => ro.observe(n));
  }

  /* ---------- the real app, live, inside the iPad ---------- */
  const frame = $("ipad-frame");
  const fit = () => { const sc = frame.parentElement.clientWidth / 1180; frame.style.transform = "scale(" + sc + ")"; };
  if (frame && window.matchMedia("(min-width: 721px)").matches) {
    frame.addEventListener("load", () => setTimeout(() => $("ipad-cover").classList.add("gone"), 900));
    frame.src = frame.dataset.src;
    fit();
    window.addEventListener("resize", fit);
  }

  /* ---------- lock screen clock ---------- */
  const tick = () => {
    const d = new Date();
    $("lock-time").textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    $("lock-date").textContent = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };
  tick(); setInterval(tick, 15000);

  /* ---------- callout chips light up in order ---------- */
  document.querySelectorAll(".callouts span").forEach((n, i) => (n.style.animationDelay = (i * 0.45) + "s"));

  /* ---------- touchdown meter: same wording as the flight engine (touchdownWords) ---------- */
  const words = (v) => {
    if (v < 60) return ["Very soft", "#64D2FF", v + " fpm, barely felt. Almost too soft: on a wet or short runway you want it on firmly, so make sure you didn't float."];
    if (v < 150) return ["Smooth", "#30D158", "Smooth touchdown at " + v + " fpm. Exactly what you want."];
    if (v < 240) return ["Normal", "#30D158", "A normal, positive touchdown at " + v + " fpm. That's what line pilots aim for."];
    if (v < 360) return ["Firm", "#FFD60A", "Firm at " + v + " fpm. You'd feel it in the cabin, but it's well inside limits."];
    if (v < 600) return ["Heavy", "#FF9F0A", "Heavy at " + v + " fpm. Start the flare a touch earlier, around 20–30 ft, and keep the power on until it's settled."];
    return ["Hard", "#FF453A", "Hard landing at " + v + " fpm. Beyond about 600 fpm (10 ft/s) most airliners need a hard-landing inspection."];
  };
  const mr = $("m-range");
  const setM = () => { const v = Number(mr.value); const [w, c, t] = words(v); $("m-fpm").textContent = v; $("m-word").textContent = w; $("m-word").style.color = c; $("m-text").textContent = t; };
  mr.addEventListener("input", setM); setM();

  /* ---------- demo ---------- */
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, H = 430, PADL = 84, PADR = 16, PADT = 22, PADB = 26;
  const PHASE = {
    PREFLIGHT: "At the gate", PUSHBACK: "Pushback", TAXI_OUT: "Taxiing out", TAKEOFF: "Takeoff", CLIMB: "Climbing",
    CRUISE: "Cruising", DESCENT: "Descending", APPROACH: "On approach", LANDING: "Landing", TAXI_IN: "Taxiing to the gate", COMPLETED: "On blocks",
  };
  const EVT = {
    OFF_BLOCK: "Off block", PUSHBACK_START: "Pushback", TAXI_START: "Taxi", TAKEOFF_ROLL: "Takeoff roll", WHEELS_UP: "Wheels up",
    TOP_OF_CLIMB: "Top of climb", TOP_OF_DESCENT: "Top of descent", APPROACH_START: "Approach", TOUCHDOWN: "Touchdown",
    RUNWAY_EXIT: "Off the runway", ON_BLOCK: "On block", ENGINES_OFF: "Engines off", GO_AROUND: "Go-around",
  };
  const MARKS = { TOP_OF_CLIMB: "TOC", TOP_OF_DESCENT: "TOD", TOUCHDOWN: "TD" };

  fetch("demo-flight.json").then((r) => r.json()).then(start).catch(() => {
    $("demo").querySelector(".demo-head .section-lede").textContent = "The demo flight could not be loaded. Reload the page to try again.";
  });

  function start(D) {
    const F = D.frames.map((r) => ({ s: r[0], d: r[1], alt: r[2], gs: r[3], vs: r[4], hdg: r[5], phase: r[6], fuel: r[7], ias: r[8], tod: r[9], toGo: r[10] }));
    const total = F[F.length - 1].d, maxAlt = Math.max(...F.map((f) => f.alt)), dur = F[F.length - 1].s;
    const yTop = Math.ceil(maxAlt / 5000) * 5000 + 2000;
    const x = (d) => PADL + (d / total) * (W - PADL - PADR);
    const y = (a) => H - PADB - (a / yTop) * (H - PADT - PADB);
    const startMs = Date.parse(D.startUtc);
    const zulu = (s) => { const t = new Date(startMs + s * 1000); return String(t.getUTCHours()).padStart(2, "0") + String(t.getUTCMinutes()).padStart(2, "0") + "Z"; };
    const ev = (type) => D.events.find((e) => e.type === type);
    const landingAt = ev("TOUCHDOWN") ? ev("TOUCHDOWN").s + 12 : Infinity;

    /* --- static drawing --- */
    const svg = $("profile");
    const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); (parent || svg).appendChild(n); return n; };
    const defs = el("defs", {});
    const grad = el("linearGradient", { id: "fill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0", "stop-color": "#6FB6FF", "stop-opacity": "0.28" }, grad);
    el("stop", { offset: "1", "stop-color": "#6FB6FF", "stop-opacity": "0" }, grad);
    for (let a = 0; a <= yTop; a += 10000) {
      el("line", { x1: PADL, x2: W - PADR, y1: y(a), y2: y(a), stroke: "rgba(255,255,255,0.09)", "stroke-width": 1 });
      const t = el("text", { x: PADL - 10, y: y(a) + 4, "text-anchor": "end", fill: "#93A0BA", "font-size": 17, "font-family": "ui-rounded, -apple-system, Segoe UI, sans-serif" });
      t.textContent = a === 0 ? "0 ft" : (a / 1000) + "k ft";
    }
    // The planned vertical path, ahead of the aircraft, in route magenta.
    const pts = F.map((f) => x(f.d).toFixed(1) + "," + y(f.alt).toFixed(1)).join(" ");
    el("polyline", { points: pts, fill: "none", stroke: "#E05CFF", "stroke-width": 1.5, "stroke-dasharray": "3 5", opacity: 0.55 });
    // 3° glidepath into 23R: 318 ft per nm from 50 ft over the threshold.
    const thr = ev("TOUCHDOWN") ? ev("TOUCHDOWN").d - 0.27 : total - 1.5;
    const gpLen = 16;
    el("line", { x1: x(thr - gpLen), y1: y(257 + 50 + gpLen * 318), x2: x(thr), y2: y(257 + 50), stroke: "#EAF0FB", "stroke-width": 1, opacity: 0.35 });
    const gpl = el("text", { x: x(thr - gpLen) - 6, y: y(257 + 50 + gpLen * 318) - 6, "text-anchor": "end", fill: "#93A0BA", "font-size": 17 });
    gpl.textContent = "3° glidepath";
    const area = el("polygon", { fill: "url(#fill)", points: "" });
    const flown = el("polyline", { fill: "none", stroke: "#6FB6FF", "stroke-width": 2.5, "stroke-linejoin": "round", points: "" });
    const markLayer = el("g", {});
    const halo = el("circle", { r: 11, fill: "#6FB6FF", opacity: 0.18 });
    const dot = el("circle", { r: 5, fill: "#EAF0FB", stroke: "#6FB6FF", "stroke-width": 2.5 });

    // Altitude-profile bars on the card: the shape of the whole flight, lit up to the current position.
    const BARS = 28, barsEl = $("bars");
    for (let i = 0; i < BARS; i++) {
      const d = ((i + 0.5) / BARS) * total;
      const f = F.reduce((b, c) => (Math.abs(c.d - d) < Math.abs(b.d - d) ? c : b), F[0]);
      const bar = document.createElement("i");
      bar.style.height = 4 + 44 * (f.alt / maxAlt) + "px";
      barsEl.appendChild(bar);
    }

    // Landing table
    renderWeights(D);

    /* --- playback --- */
    let t = 0, playing = false, speed = 40, last = 0, shownEvents = 0;
    const speeds = [20, 40, 80];
    const idxAt = (s) => { let lo = 0, hi = F.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (F[m].s <= s) lo = m; else hi = m - 1; } return lo; };

    function render() {
      const i = idxAt(t), f = F[i], n = F[Math.min(F.length - 1, i + 1)];
      const k = n.s > f.s ? Math.min(1, (t - f.s) / (n.s - f.s)) : 0;
      const d = f.d + (n.d - f.d) * k, a = f.alt + (n.alt - f.alt) * k;
      const path = F.slice(0, i + 1).map((p) => x(p.d).toFixed(1) + "," + y(p.alt).toFixed(1));
      path.push(x(d).toFixed(1) + "," + y(a).toFixed(1));
      flown.setAttribute("points", path.join(" "));
      area.setAttribute("points", x(0) + "," + y(0) + " " + path.join(" ") + " " + x(d).toFixed(1) + "," + y(0));
      for (const c of [halo, dot]) { c.setAttribute("cx", x(d)); c.setAttribute("cy", y(a)); }

      // Event markers on the profile + timeline chips.
      const passed = D.events.filter((e) => e.s <= t);
      if (passed.length !== shownEvents) {
        shownEvents = passed.length;
        markLayer.replaceChildren();
        const tl = $("timeline");
        tl.replaceChildren();
        for (const e of passed) {
          if (MARKS[e.type]) {
            const mx = x(e.d), my = y(e.alt || 0);
            el("line", { x1: mx, x2: mx, y1: my - 6, y2: my - 22, stroke: "#93A0BA", "stroke-width": 1 }, markLayer);
            const lbl = el("text", { x: mx, y: my - 28, "text-anchor": "middle", fill: "#EAF0FB", "font-size": 17, "font-family": "ui-rounded, -apple-system, Segoe UI, sans-serif" }, markLayer);
            lbl.textContent = MARKS[e.type];
          }
          if (!EVT[e.type]) continue;
          const li = document.createElement("li");
          li.innerHTML = "<b>" + EVT[e.type] + "</b><span class='data'>" + zulu(e.s) + "</span>";
          tl.appendChild(li);
        }
      }

      // Card
      const offBlock = ev("OFF_BLOCK"), wheelsUp = ev("WHEELS_UP"), td = ev("TOUCHDOWN"), onBlock = ev("ON_BLOCK");
      $("phase").textContent = PHASE[f.phase] || f.phase;
      $("dep-time").textContent = offBlock && t >= offBlock.s ? "Off block " + zulu(offBlock.s) : "Heathrow";
      $("arr-time").textContent = onBlock && t >= onBlock.s ? "On block " + zulu(onBlock.s) : "Manchester";
      const lit = Math.round((d / total) * BARS);
      [...barsEl.children].forEach((b, j) => b.classList.toggle("on", j < lit));
      if (onBlock && t >= onBlock.s) {
        $("mid-big").textContent = fmtDur(td.s - wheelsUp.s);
        $("mid-sub").textContent = "Airborne time, " + Math.round(total) + " nm flown";
      } else if (wheelsUp && t >= wheelsUp.s && (!td || t < td.s)) {
        const mins = f.gs > 60 ? (f.toGo / f.gs) * 60 : null;
        $("mid-big").textContent = Math.round(f.toGo) + " nm";
        $("mid-sub").textContent = mins ? "to Manchester, about " + Math.round(mins) + " min at this speed" : "to Manchester";
      } else if (offBlock && t >= offBlock.s) {
        $("mid-big").textContent = fmtDur(t - offBlock.s);
        $("mid-sub").textContent = td && t >= td.s ? "Since off block" : "Since off block, on the ground";
      } else {
        $("mid-big").textContent = "—";
        $("mid-sub").textContent = "Waiting for off-block";
      }
      $("r-alt").textContent = num(a) + " ft";
      $("r-gs").textContent = num(f.gs) + " kt";
      $("r-vs").textContent = Math.abs(f.vs) < 100 ? "Level" : (f.vs > 0 ? "+" : "") + num(f.vs);
      $("r-fuel").textContent = num(f.fuel) + " kg";
      const tod = $("tod");
      if (f.tod !== null && f.tod > 0) {
        tod.hidden = false;
        tod.innerHTML = "Top of descent in " + f.tod.toFixed(1) + " min <small>estimate on a 3° path</small>";
      } else tod.hidden = true;
      const g = $("grade");
      if (D.landing && t >= landingAt) {
        g.hidden = false;
        $("g-letter").textContent = D.landing.grade;
        $("g-text").textContent = D.landing.touchdownVsFpm + " fpm, " + D.landing.peakG + " g, runway " + (D.landing.runway ? D.landing.runway.ident : "unknown") + ". " + D.landing.verdict;
      } else g.hidden = true;

      $("scrub").value = String(Math.round((t / dur) * 1000));
      $("clock").textContent = zulu(t);
    }

    function frame(now) {
      if (!playing) return;
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      t = Math.min(dur, t + dt * speed);
      render();
      if (t >= dur) { setPlaying(false); return; }
      requestAnimationFrame(frame);
    }
    function setPlaying(p) {
      playing = p;
      $("play-icon").setAttribute("d", p ? "M5 4h4v12H5zM11 4h4v12h-4z" : "M6 4l10 6-10 6z");
      $("play").setAttribute("aria-label", p ? "Pause" : "Play");
      if (p) { if (t >= dur) t = 0; last = 0; requestAnimationFrame(frame); }
    }
    $("play").addEventListener("click", () => setPlaying(!playing));
    $("speed").addEventListener("click", () => {
      speed = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
      $("speed").textContent = speed + "×";
    });
    $("scrub").addEventListener("input", (e) => { t = (Number(e.target.value) / 1000) * dur; render(); });
    document.querySelectorAll('a[href="#demo"]').forEach((a) => a.addEventListener("click", () => { if (!playing) setPlaying(true); }));

    render();
    // One orchestrated moment: the replay starts once, when the demo first scrolls into view.
    if (!reduced && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); setPlaying(true); }
      }, { threshold: 0.45 });
      io.observe($("phase"));
    }
  }

  function renderWeights(D) {
    const p = D.landingProfile, L = D.landing;
    if (!p || !L) return;
    const full = {
      sinkRate: p.idealVsFpm[0] + "–" + p.idealVsFpm[1] + " fpm",
      gLoad: "up to 1.15 g",
      bounce: "no bounce",
      bank: "within 2°",
      pitch: "2° to " + (p.tailStrikePitchDeg - 2) + "° nose up",
      centreline: "within 6 ft",
      touchdownZone: p.touchdownZoneFt[0].toLocaleString() + "–" + p.touchdownZoneFt[1].toLocaleString() + " ft past the threshold",
    };
    const body = $("weights-body");
    for (const c of L.components) {
      const tr = document.createElement("tr");
      const val = c.value === null ? "not available" : (c.id === "bounce" ? String(c.value) : num(c.value, c.id === "gLoad" ? 2 : 0)) + (c.unit ? (c.unit === "°" ? "°" : " " + c.unit) : "");
      tr.innerHTML = "<td>" + c.label + "</td><td>" + full[c.id] + "</td><td class='num'>" + c.weight + "%</td><td class='num" + (c.score === null ? " na" : "") + "'>" + val + (c.score === null ? "" : " → " + c.score) + "</td>";
      body.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = "<td><b>Overall</b></td><td></td><td></td><td class='num'><b>" + L.grade + "</b> (" + L.score + ")</td>";
    body.appendChild(tr);
  }

  function num(v, dp) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: dp || 0, minimumFractionDigits: dp || 0 }); }
  function fmtDur(s) { const m = Math.max(0, Math.round(s / 60)); return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m"; }
})();
