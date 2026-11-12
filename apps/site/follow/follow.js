/* Follow this flight: shows a pilot's live link on a map, refreshing every 10 seconds. */
(function () {
  "use strict";
  var id = (new URLSearchParams(location.search).get("f") || "").toLowerCase();
  var $ = function (x) { return document.getElementById(x); };
  var PHASE = { PREFLIGHT: "At the gate", PUSHBACK: "Pushing back", TAXI_OUT: "Taxiing out", TAKEOFF: "Taking off", CLIMB: "Climbing", CRUISE: "Cruising", DESCENT: "Descending", APPROACH: "On approach", LANDING: "Landing", TAXI_IN: "Taxiing in", COMPLETED: "Landed" };
  var fmt = function (n) { return Math.round(n).toLocaleString("en-US"); };

  function message(h, t) { $("msg-h").textContent = h; $("msg-t").textContent = t; $("msg").hidden = false; }
  if (!/^[a-z2-9]{6,16}$/.test(id)) { message("This link isn't complete", "Ask the pilot to send the link again."); return; }

  var bases = ["/acct"];
  fetch("../cloud.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (c) { if (c && c.api) bases.push(String(c.api).replace(/\/+$/, "")); }).catch(function () {});

  function get() {
    var i = 0;
    function next() {
      if (i >= bases.length) return Promise.reject(new Error("offline"));
      var b = bases[i++];
      return fetch(b + "/live/" + id, { cache: "no-store" }).then(function (r) {
        if (r.status === 404) return r.json().then(function (j) { if (j && j.error) { var e = new Error(j.error); e.notFound = true; throw e; } return next(); }, next);
        if (!r.ok) return next();
        return r.json();
      }, function (e) { if (e && e.notFound) throw e; return next(); });
    }
    return next();
  }

  var map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [0, 25], zoom: 1.6, attributionControl: { compact: true } });
  var plane = document.createElement("div");
  plane.innerHTML = '<svg class="plane" viewBox="0 0 24 24"><path fill="#fff" stroke="#0A84FF" stroke-width="1.1" d="M21 15.5v-1.8l-8-5V4.5a1.5 1.5 0 0 0-3 0v4.2l-8 5v1.8l8-2.4v4.3l-2.2 1.6V21l3.7-1 3.7 1v-2l-2.2-1.6v-4.3z"/></svg>';
  var marker = null, apts = [], first = true, follow = true, ready = false, pending = null;
  map.on("load", function () {
    map.addSource("trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "trail-glow", type: "line", source: "trail", paint: { "line-color": "#0A84FF", "line-width": 8, "line-opacity": 0.25, "line-blur": 4 } });
    map.addLayer({ id: "trail", type: "line", source: "trail", paint: { "line-color": "#64D2FF", "line-width": 3 }, layout: { "line-cap": "round", "line-join": "round" } });
    map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [2, 2] } });
    ready = true;
    if (pending) draw(pending);
  });
  map.on("dragstart", function () { follow = false; $("center").hidden = false; });
  $("center").onclick = function () { follow = true; $("center").hidden = true; if (marker) map.easeTo({ center: marker.getLngLat(), zoom: Math.max(map.getZoom(), 6) }); };

  function draw(d) {
    pending = d;
    var info = d.info || {}, pos = d.pos;
    $("card").hidden = false; $("msg").hidden = true;
    $("route").textContent = (info.dep || "····") + " → " + (info.arr || "····");
    var who = [info.callsign, info.aircraft, info.pilot ? "flown by " + info.pilot : null].filter(Boolean).join(" · ");
    $("sub").textContent = who || "A Glidepath flight";
    var st = $("status");
    if (d.live) { st.className = "status"; $("status-t").textContent = PHASE[info.phase] || "Live"; }
    else { st.className = "status off"; $("status-t").textContent = d.ended ? "Flight ended" : (pos ? "Paused" : "Waiting to start"); }
    if (pos) {
      $("alt").textContent = pos.onGround ? "Ground" : pos.alt != null ? (pos.alt >= 18000 ? "FL" + String(Math.round(pos.alt / 100)).padStart(3, "0") : fmt(pos.alt) + " ft") : "—";
      $("gs").textContent = pos.gs != null ? fmt(pos.gs) + " kt" : "—";
      $("togo").textContent = info.distToGoNm != null ? fmt(info.distToGoNm) + " nm" : "—";
    }
    var ago = Math.max(0, Math.round((Date.now() - d.updatedAt) / 1000));
    $("foot").innerHTML = (pos ? "Updated " + (ago < 10 ? "just now" : ago < 60 ? ago + " s ago" : Math.round(ago / 60) + " min ago") + ". " : "The pilot's sim hasn't sent a position yet. ") + 'Tracked with <a href="../">Glidepath</a>, free for MSFS.';
    if (!ready) return; // the map is still loading; the card above is already up to date
    if (pos) {
      var at = [pos.lon, pos.lat];
      if (!marker) marker = new maplibregl.Marker({ element: plane, rotationAlignment: "map" }).setLngLat(at).addTo(map);
      marker.setLngLat(at); marker.setRotation(pos.hdg || 0);
      if (first) { map.jumpTo({ center: at, zoom: 6 }); first = false; } else if (follow) map.easeTo({ center: at, duration: 1500 });
    }
    var tr = (d.trail || []).map(function (p) { return [p[1], p[0]]; });
    if (pos) tr.push([pos.lon, pos.lat]);
    map.getSource("trail").setData({ type: "Feature", geometry: { type: "LineString", coordinates: tr }, properties: {} });
    if (info.arrLat != null && pos) map.getSource("route").setData({ type: "Feature", geometry: { type: "LineString", coordinates: [[pos.lon, pos.lat], [info.arrLon, info.arrLat]] }, properties: {} });
    if (!apts.length) [["dep", info.depLat, info.depLon, info.dep], ["arr", info.arrLat, info.arrLon, info.arr]].forEach(function (a) {
      if (a[1] == null || a[2] == null || !a[3]) return;
      var el = document.createElement("div"); el.className = "apt"; el.textContent = a[3];
      apts.push(new maplibregl.Marker({ element: el }).setLngLat([a[2], a[1]]).addTo(map));
    });
  }

  var stopped = false;
  function poll() {
    if (stopped) return;
    get().then(function (d) {
      draw(d);
      if (d.ended) { stopped = true; return; }
      setTimeout(poll, d.live ? 10000 : 20000);
    }, function (e) {
      if (e && e.notFound) { message("This flight link has ended", "Live links stop a few days after the flight. Ask the pilot for a new one."); return; }
      if (!pending) message("Can't reach Glidepath", "Check your internet connection. Trying again…");
      setTimeout(poll, 15000);
    });
  }
  poll();
})();
