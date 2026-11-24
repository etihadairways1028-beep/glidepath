/*
 * Home page motion: the demo flight flying across the hero, the iPad scroll film,
 * and the "hold the glidepath" game. All data shown is the synthetic demo flight
 * (labelled as such on the page); nothing here talks to a simulator.
 */
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = (u) => 1 - Math.pow(1 - u, 3);
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (parent) parent.appendChild(n); return n; };

  /* ------------------------------ HERO ------------------------------ */
  const svg = document.getElementById("lh-map");
  const cardsBox = document.getElementById("lh-cards");
  if (svg && cardsBox) {
    // Real airport and waypoint positions (approximate for the arrival fixes); the flight itself is the synthetic demo.
    const ROUTE = [["EGLL", 51.4706, -0.4619, "ap"], ["CPT", 51.4925, -1.2195, "sid"], ["HON", 52.3569, -1.6626, "en"], ["TNT", 53.0539, -1.67, "en"], ["MIRSI", 53.33, -1.80, "star"], ["DAYNE", 53.392, -2.02, "star"], ["EGCC", 53.3537, -2.275, "ap"]];
    const APPROACH = [["DAYNE", 53.392, -2.02], ["CI23R", 53.452, -2.118], ["FF23R", 53.41, -2.19], ["RW23R", 53.3624, -2.2571]];
    const OTHERS = [["EGBB", 52.454, -1.748], ["EGNX", 52.831, -1.328], ["EGGW", 51.875, -0.368], ["EGSS", 51.885, 0.235], ["EGKK", 51.148, -0.19], ["EGGD", 51.383, -2.719], ["EGNM", 53.866, -1.661], ["EGGP", 53.334, -2.85], ["EGFF", 51.397, -3.343], ["EGNS", 54.083, -4.623], ["EGCN", 53.475, -1.004], ["EGSH", 52.676, 1.283], ["EGTE", 50.734, -3.414], ["EGHI", 50.95, -1.357]];
    const K = Math.cos(52.4 * Math.PI / 180);
    let W = 0, H = 0, sc = 1, ox = 0, oy = 0;
    const P = (lat, lon) => [ox + lon * K * sc, oy - lat * sc];
    const layout = () => {
      W = innerWidth; H = Math.max(560, svg.getBoundingClientRect().height || innerHeight);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const lons = ROUTE.map((r) => r[2] * K), lats = ROUTE.map((r) => r[1]);
      const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
      const wide = W > 900;
      const box = wide ? [W * 0.5, H * 0.13, W * 0.95, H * 0.8] : [W * 0.12, H - 360, W * 0.8, H - 120];
      sc = Math.min((box[2] - box[0]) / (x1 - x0), (box[3] - box[1]) / (y1 - y0));
      // Heathrow bottom-right, Manchester top-left: mirror nothing, just place the box.
      ox = box[0] + ((box[2] - box[0]) - (x1 - x0) * sc) / 2 - x0 * sc;
      oy = box[1] + ((box[3] - box[1]) - (y1 - y0) * sc) / 2 + y1 * sc;
      build();
    };
    let LAND = null;
    fetch("assets/uk-land.json").then((r) => r.json()).then((l) => { LAND = l; if (W) build(); }).catch(() => undefined);
    let routePath, flownPath, appPath, plane, routeLen = 0, appLen = 0, segs = [];
    const build = () => {
      svg.textContent = "";
      const defs = el("defs", {}, svg);
      const g1 = el("linearGradient", { id: "lhFlown", x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
      el("stop", { offset: 0, "stop-color": "#3CE0FF" }, g1); el("stop", { offset: 1, "stop-color": "#7C8CFF" }, g1);
      const glow = el("filter", { id: "lhGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
      el("feGaussianBlur", { stdDeviation: 6, result: "b" }, glow); const m = el("feMerge", {}, glow); el("feMergeNode", { in: "b" }, m); el("feMergeNode", { in: "SourceGraphic" }, m);
      // Coastlines (Natural Earth, public domain)
      if (LAND) { const land = el("g", { class: "lh-land" }, svg); for (const ring of LAND) el("path", { d: "M" + ring.map(([lo, la]) => P(la, lo).map((v) => v.toFixed(1)).join(",")).join("L") + "Z" }, land); }
      // Lat/lon grid
      const grid = el("g", { class: "lh-grid" }, svg);
      for (let lat = 49; lat <= 57; lat += 0.5) { const [, y] = P(lat, 0); el("line", { x1: 0, x2: W, y1: y, y2: y }, grid); }
      for (let lon = -7; lon <= 3; lon += 0.5) { const [x] = P(52, lon); el("line", { x1: x, x2: x, y1: 0, y2: H }, grid); }
      const oth = el("g", { class: "lh-others" }, svg);
      for (const [id, la, lo] of OTHERS) { const [x, y] = P(la, lo); el("circle", { cx: x, cy: y, r: 3 }, oth); const t = el("text", { x: x + 7, y: y + 4 }, oth); t.textContent = id; }
      const pts = ROUTE.map((r) => P(r[1], r[2]));
      const d = "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" L");
      el("path", { d, class: "lh-route" }, svg);
      flownPath = el("path", { d, class: "lh-flown", stroke: "url(#lhFlown)", filter: "url(#lhGlow)" }, svg);
      routePath = flownPath;
      routeLen = routePath.getTotalLength();
      flownPath.style.strokeDasharray = `${routeLen} ${routeLen}`;
      // cumulative length to each fix, so the plane sits on the drawn line
      segs = [0]; for (let i = 1; i < pts.length; i++) segs.push(segs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const ap = APPROACH.map((r) => P(r[1], r[2]));
      appPath = el("path", { d: "M" + ap.map((p) => p.join(",")).join(" L"), class: "lh-app" }, svg);
      appLen = appPath.getTotalLength(); appPath.style.strokeDasharray = `${appLen} ${appLen}`; appPath.style.strokeDashoffset = appLen;
      const fx = el("g", { class: "lh-fixes" }, svg);
      ROUTE.forEach(([id, la, lo, kind]) => { const [x, y] = P(la, lo); el("circle", { cx: x, cy: y, r: kind === "ap" ? 6 : 4.5, class: `k-${kind}` }, fx); const t = el("text", { x, y: y + (kind === "ap" ? 24 : 20), class: `k-${kind}` }, fx); t.textContent = id; });
      plane = el("g", { class: "lh-plane" }, svg);
      el("circle", { r: 22, class: "lh-halo" }, plane);
      el("path", { d: "M16 0C16-1.4 14.3-2.4 12.3-2.4H3.2L-5.9-15h-3.2l4.3 12.6H-11.8L-15.5-7.5h-2.1l1.7 5.1v4.8l-1.7 5.1h2.1l3.7-5.1h7l-4.3 12.6h3.2L3.2 2.4h9.1C14.3 2.4 16 1.4 16 0z", class: "lh-ac" }, plane);
    };
    const at = (nmFrac) => { // point and heading along the route
      const L = clamp(nmFrac) * routeLen, a = routePath.getPointAtLength(L), b = routePath.getPointAtLength(Math.min(routeLen, L + 2));
      const b2 = L + 2 > routeLen ? routePath.getPointAtLength(L - 2) : b; const hdg = L + 2 > routeLen ? Math.atan2(a.y - b2.y, a.x - b2.x) : Math.atan2(b.y - a.y, b.x - a.x);
      return { x: a.x, y: a.y, deg: hdg * 180 / Math.PI };
    };

    const hud = { phase: document.getElementById("lh-phase"), alt: document.getElementById("lh-alt"), gs: document.getElementById("lh-gs"), vs: document.getElementById("lh-vs"), togo: document.getElementById("lh-togo") };
    const pdone = document.getElementById("lh-pdone"), pdot = document.getElementById("lh-pdot");
    // The map leans a little toward the pointer.
    if (!reduced && matchMedia("(hover: hover)").matches) addEventListener("pointermove", (e) => {
      const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
      svg.style.transform = `perspective(1600px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) scale(1.04)`;
      cardsBox.style.transform = `translate(${(x * -10).toFixed(1)}px, ${(y * -8).toFixed(1)}px)`;
    }, { passive: true });
    const PH = { PREFLIGHT: "Gate", PUSHBACK: "Pushback", TAXI_OUT: "Taxi", TAKEOFF: "Takeoff", CLIMB: "Climb", CRUISE: "Cruise", DESCENT: "Descent", APPROACH: "Approach", LANDING: "Landing", TAXI_IN: "Taxi in", PARKED: "Parked", COMPLETED: "Parked" };
    const fmt = (n) => Math.round(n).toLocaleString("en-US");

    fetch("demo-flight.json").then((r) => r.json()).then((demo) => {
      const F = demo.frames, total = F[F.length - 1][1] || 167;
      const S = F[F.length - 1][0];
      const find = (s) => { let lo = 0, hi = F.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid][0] <= s) lo = mid; else hi = mid - 1; } return F[lo]; };
      const firstS = (pred) => (F.find(pred) || [S])[0];
      const sTOC = (demo.events.find((e) => e.type === "TOP_OF_CLIMB") || {}).s ?? firstS((f) => f[6] === "CRUISE");
      const sTOD = firstS((f) => f[9] !== null && f[9] <= 4 && f[6] === "CRUISE");
      const sDES = firstS((f) => f[6] === "DESCENT");
      const sAPP = firstS((f) => f[10] !== null && f[10] < 28 && f[0] > sDES);
      const sLAND = (demo.events.find((e) => /TOUCHDOWN|LANDED/.test(e.type)) || {}).s ?? firstS((f) => f[6] === "LANDING" || f[6] === "TAXI_IN");
      const L = demo.landing || { touchdownVsFpm: 140, grade: "A", score: 94.5, peakG: 1.12 };
      const CARDS = [
        { s0: 0, s1: 330, at: "EGLL", tone: "atis", k: "EGLL · ATIS", h: "<b class='lt'>G</b> Information Golf", p: "Runway 27R · wind 250/12 · QNH 1018" },
        { s0: 330, s1: sTOC - 60, at: "CPT", tone: "sid", k: "Departure", h: "CPT3G from 27R", p: "V1 125 · VR 133 · V2 137" },
        { s0: sTOC - 40, s1: sTOC + 420, at: "plane", tone: "toc", k: "Top of climb", h: "FL240 reached", p: `${Math.round(F.find((f) => f[0] >= sTOC)?.[1] ?? 70)} nm after departure` },
        { s0: sTOD - 30, s1: sDES + 80, at: "plane", tone: "tod", k: "Glidepath", h: "Top of descent in 4 min", p: "Expect runway 23R at Manchester" },
        { s0: sAPP - 60, s1: sLAND - 20, at: "EGCC", tone: "atis", k: "EGCC · ATIS", h: "<b class='lt'>K</b> Information Kilo", p: "Runway 23R · 230/18G28 · QNH 1009" },
        { s0: sAPP, s1: sLAND - 20, at: "DAYNE", tone: "app", k: "Approach", h: "RNAV 23R via DAYNE", p: "Drawn fix by fix to the runway" },
        { s0: sLAND, s1: S + 999, at: "EGCC", tone: "land", k: "Landed · runway 23R", h: `<b class='gr'>${L.grade}</b> ${Math.round(Math.abs(L.touchdownVsFpm))} fpm`, p: `${(L.peakG ?? 1.12).toFixed(2)} g · score ${Math.round(L.score ?? 94)} · flight review ready` },
      ];
      const nodes = CARDS.map((c) => { const n = document.createElement("div"); n.className = `lh-card t-${c.tone}`; n.innerHTML = `<em>${c.k}</em><strong>${c.h}</strong><span>${c.p}</span>`; cardsBox.appendChild(n); return n; });
      const where = (c, pl) => {
        if (c.at === "plane") return [pl.x, pl.y];
        const r = ROUTE.find((x) => x[0] === c.at) || APPROACH.find((x) => x[0] === c.at); return P(r[1], r[2]);
      };
      layout(); addEventListener("resize", () => { layout(); }, { passive: true });

      const FLY = 34, HOLD = 5, LOOP = FLY + HOLD; // seconds on screen for the whole flight, then a pause on the landing
      let t0 = performance.now(), visible = true;
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(svg);
      const frame = (now) => {
        requestAnimationFrame(frame);
        if (!visible) return;
        let tau = ((now - t0) / 1000) % LOOP;
        if (reduced) tau = FLY * 0.62;
        const s = Math.min(S, (tau / FLY) * S);
        const f = find(s);
        const frac = clamp(f[1] / total);
        flownPath.style.strokeDashoffset = String(routeLen * (1 - frac));
        const pl = at(frac);
        plane.setAttribute("transform", `translate(${pl.x.toFixed(1)} ${pl.y.toFixed(1)}) rotate(${pl.deg.toFixed(1)}) scale(${W > 900 ? 1.25 : 1})`);
        const appU = clamp((s - sAPP) / 240);
        appPath.style.strokeDashoffset = String(appLen * (1 - ease(appU)));
        appPath.style.opacity = s < sAPP ? "0" : "1";
        // fade the whole scene out and back in around the loop point
        const fade = tau > LOOP - .7 ? (LOOP - tau) / .7 : tau < .5 ? tau / .5 : 1;
        svg.style.opacity = String(.35 + .65 * fade); cardsBox.style.opacity = String(fade);
        CARDS.forEach((c, i) => {
          const on = s >= c.s0 && s <= c.s1, n = nodes[i];
          n.classList.toggle("on", on);
          if (on || n.classList.contains("was")) { let [x, y] = where(c, pl); x = Math.max(6, Math.min(x, W - (n.offsetWidth || 220) - 30)); n.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; }
          n.classList.toggle("was", on);
        });
        if (pdone) { pdone.style.strokeDashoffset = String(1 - frac); pdot.setAttribute("cx", (2 + 136 * frac).toFixed(1)); pdot.setAttribute("cy", (30 - 24 * clamp(f[2] / 24000)).toFixed(1)); }
        hud.phase.textContent = PH[f[6]] || f[6]; hud.alt.textContent = `${fmt(f[2])} ft`; hud.gs.textContent = `${fmt(f[3])} kt`;
        hud.vs.textContent = f[4] > 50 ? `+${fmt(f[4])}` : fmt(f[4]); hud.togo.textContent = `${Math.round(f[10] ?? 0)} nm`;
      };
      requestAnimationFrame(frame);
    }).catch(() => { layout(); });
  }

  /* Works-with strip: a slow endless marquee */
  const mq = document.querySelector(".works-with.marquee");
  if (mq && !reduced) { const track = document.createElement("div"); track.className = "mq-track"; [...mq.children].forEach((c) => track.appendChild(c)); track.innerHTML += track.innerHTML; mq.appendChild(track); }

  /* ---------------------------- SCROLL FILM ---------------------------- */
  const film = document.querySelector(".film"), pad = document.getElementById("film-pad");
  if (film && pad) {
    const shots = [...pad.querySelectorAll("img")], arts = [...document.querySelectorAll("#film-copy article")], dots = [...document.querySelectorAll(".film-dots i")];
    const N = shots.length, groups = [...document.querySelectorAll(".fc-group")];
    let ticking = false;
    const run = () => {
      ticking = false;
      const r = film.getBoundingClientRect(), span = Math.max(1, r.height - innerHeight);
      const p = clamp(-r.top / span), local = p * N;
      const k = ease(clamp(p / 0.1)), wide = innerWidth > 900;
      const sway = Math.sin(local * Math.PI) * (wide ? 6 : 3), side = wide ? 1 : 0;
      pad.style.transform = reduced ? "none" : `perspective(2200px) translate3d(${side * (6 - 4 * k)}vw, ${(1 - k) * 14}vh, 0) rotateX(${26 * (1 - k)}deg) rotateY(${-sway - 6 * side * k}deg) rotateZ(${-8 * (1 - k)}deg) scale(${.74 + .26 * k})`;
      shots.forEach((im, i) => { const o = i === 0 && local < .5 ? 1 : i === N - 1 && local > N - .5 ? 1 : clamp(1.6 - Math.abs(local - (i + .5)) * 2.2); im.style.opacity = String(o); im.style.transform = `scale(${1.04 - .04 * o})`; });
      arts.forEach((a, i) => { const d = local - (i + .5), o = i === 0 && local < .5 ? 1 : i === N - 1 && local > N - .5 ? 1 : clamp(1.4 - Math.abs(d) * 2.4); a.style.opacity = String(o); a.style.transform = `translateY(${(-d * 60).toFixed(1)}px)`; a.style.pointerEvents = o > .5 ? "auto" : "none"; });
      groups.forEach((g, i) => { const d = local - (i + .5), o = i === 0 && local < .5 ? 1 : i === N - 1 && local > N - .5 ? 1 : clamp(1.5 - Math.abs(d) * 2.6);
        g.style.opacity = String(o); [...g.children].forEach((c, j) => { c.style.transform = `translate3d(${(1 - o) * (j ? -40 : 40)}px, ${(-d * (j ? 90 : 140)).toFixed(1)}px, 0) scale(${.86 + .14 * o})`; }); });
      const cur = Math.min(N - 1, Math.floor(local)); dots.forEach((d, i) => d.classList.toggle("on", i === cur));
      film.style.setProperty("--film-p", p.toFixed(3));
    };
    addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true });
    addEventListener("resize", run, { passive: true }); run();
  }

  /* ------------------------------- FLY IT ------------------------------- */
  const flyPad = document.getElementById("fly-pad"), go = document.getElementById("fly-go");
  if (flyPad && go) {
    const $ = (id) => document.getElementById(id);
    const me = $("fly-me"), dot = $("fly-dot"), halo = $("fly-halo"), link = $("fly-link"), core = $("fly-core"), cmd = $("fly-cmd");
    const nm = $("fly-nm"), ht = $("fly-ht"), result = $("fly-result"), best = $("fly-best");
    const DUR = 22, GREEN = 50;
    let st = null;
    let target = { x: 0, y: 0 }, keys = new Set();
    const toLocal = (e) => { const r = flyPad.querySelector("svg").getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 640 - 320, y: ((e.clientY - r.top) / r.height) * 640 - 320 }; };
    flyPad.addEventListener("pointermove", (e) => { if (st) target = toLocal(e); });
    flyPad.addEventListener("pointerdown", (e) => { if (st) { target = toLocal(e); flyPad.setPointerCapture?.(e.pointerId); } });
    flyPad.addEventListener("keydown", (e) => { if (/^Arrow/.test(e.key) && st) { keys.add(e.key); e.preventDefault(); } });
    flyPad.addEventListener("keyup", (e) => keys.delete(e.key));
    const saved = () => { try { return JSON.parse(localStorage.getItem("gp.flyBest") || "null"); } catch { return null; } };
    const showBest = () => { const b = saved(); if (b) { best.hidden = false; best.textContent = `Your best: ${b.grade}, ${b.pct}% in the green ring`; } };
    showBest();
    const say = (t, tone) => { cmd.textContent = t; cmd.className = `fly-cmd ${tone || ""}`; };
    const draw = (x, y) => {
      me.setAttribute("transform", `translate(${320 + x} ${320 + y})`); link.setAttribute("x2", 320 + x); link.setAttribute("y2", 320 + y);
      const good = Math.hypot(x, y) < GREEN, col = good ? "#3CFF8F" : Math.hypot(x, y) < 120 ? "#FFB340" : "#FF5A5A";
      dot.setAttribute("fill", col); halo.setAttribute("fill", col); link.setAttribute("stroke", col);
      core.setAttribute("fill", good ? "rgba(60,255,143,.32)" : "rgba(60,255,143,.12)");
    };
    const start = () => {
      result.hidden = true; flyPad.classList.add("running"); flyPad.focus({ preventScroll: true });
      const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6, Math.random() * 6];
      st = { t: 0, x: 130, y: -90, vx: 0, vy: 0, ph, inGreen: 0, sum: 0, last: performance.now(), calls: new Set() };
      target = { x: 130, y: -90 };
      go.textContent = "Restart"; requestAnimationFrame(tick);
    };
    const CALLS = [[500, "500"], [400, "Minimums"], [100, "100"], [50, "50"], [30, "30"], [20, "20"], [10, "10"]];
    const tick = (now) => {
      if (!st) return;
      const dt = Math.min(.05, (now - st.last) / 1000); st.last = now; st.t += dt;
      const t = st.t, gust = 1 + .6 * Math.max(0, Math.sin(t * 1.3 + st.ph[3]));
      const wx = (70 * Math.sin(t * .55 + st.ph[0]) + 40 * Math.sin(t * 1.7 + st.ph[1])) * gust, wy = (50 * Math.sin(t * .45 + st.ph[2]) + 25 * Math.sin(t * 2.1 + st.ph[0])) * gust;
      if (keys.size) { const k = 260 * dt; if (keys.has("ArrowLeft")) target.x -= k; if (keys.has("ArrowRight")) target.x += k; if (keys.has("ArrowUp")) target.y -= k; if (keys.has("ArrowDown")) target.y += k; }
      target.x = clamp(target.x, -300, 300); target.y = clamp(target.y, -300, 300);
      // The aircraft follows your input with lag; the wind keeps pushing it off.
      st.vx += ((target.x - st.x) * 2.2 - st.vx * 1.6 + wx) * dt; st.vy += ((target.y - st.y) * 2.2 - st.vy * 1.6 + wy) * dt;
      st.x = clamp(st.x + st.vx * dt, -290, 290); st.y = clamp(st.y + st.vy * dt, -290, 290);
      const dev = Math.hypot(st.x, st.y); if (dev < GREEN) st.inGreen += dt; st.sum += dev * dt;
      draw(st.x, st.y);
      const left = Math.max(0, 1 - t / DUR), height = Math.round(1300 * left), dist = 4 * left;
      nm.textContent = `${dist.toFixed(1)} nm`; ht.textContent = `${height.toLocaleString("en-US")} ft`;
      const call = CALLS.find(([h, w]) => height <= h && !st.calls.has(w));
      if (call) { st.calls.add(call[1]); st.callAt = t; st.call = call[1]; }
      if (st.call && t - st.callAt < .8) say(st.call, "call");
      else if (dev < GREEN) say("On the glidepath", "good");
      else { const v = st.y < -GREEN * .6 ? "Ease down" : st.y > GREEN * .6 ? "Ease up" : "", h = st.x < -GREEN * .6 ? "right" : st.x > GREEN * .6 ? "left" : ""; say(v && h ? `${v}, ease ${h}` : v || `Ease ${h}`, "warn"); }
      if (t >= DUR) return finish();
      requestAnimationFrame(tick);
    };
    const finish = () => {
      const pct = Math.round((st.inGreen / DUR) * 100), avg = st.sum / DUR, endDev = Math.hypot(st.x, st.y);
      const fpm = Math.round(clamp(110 + Math.max(0, st.y) * 2.2 + endDev * .8 + avg * .4, 70, 980));
      const score = clamp(Math.round(100 - avg * .45 - Math.max(0, fpm - 180) * .08), 0, 100);
      const grade = score >= 90 ? "A" : score >= 78 ? "B" : score >= 62 ? "C" : score >= 45 ? "D" : "F";
      const words = fpm < 180 ? "Smooth" : fpm < 360 ? "Normal" : fpm < 600 ? "Firm" : "Hard";
      flyPad.classList.remove("running"); say(grade <= "B" ? "Nice landing" : "Landed", grade <= "B" ? "good" : "warn");
      result.hidden = false;
      result.innerHTML = `<div class="fr-g g-${grade}">${grade}</div><div class="fr-t"><b>${words} · ${fpm} fpm</b><span>${pct}% of the approach in the green ring · score ${score}</span></div><div class="fr-b"><button class="btn small primary" type="button" data-again>Fly it again</button><a class="btn small glass" href="#download">Get Glidepath for your sim</a></div>`;
      result.querySelector("[data-again]").addEventListener("click", start);
      const b = saved(); if (!b || score > b.score) { try { localStorage.setItem("gp.flyBest", JSON.stringify({ grade, pct, score })); } catch { /* private */ } }
      showBest(); st = null;
    };
    go.addEventListener("click", start);
    draw(130, -90);
  }
})();
