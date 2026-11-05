/**
 * Pages served by the Bridge on the local network.
 *
 *  - "/"     Status & diagnostics (shows the pairing link only to this PC).
 *  - "/live" A live flight view for an iPad/phone browser on the same Wi-Fi.
 *            This is the interim tracker until the native Glidepath app
 *            (with Lock Screen Live Activities) ships. Everything on it is
 *            Bridge telemetry; nothing is invented. Values the aircraft does
 *            not expose show as "—".
 *
 * Client code avoids template-literal syntax so it can live inside these strings.
 */
import qrcode from "qrcode-generator";
import type { BridgeStatus } from "@glidepath/protocol";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const BASE_CSS = `
:root{--bg:#05080F;--panel:rgba(14,22,38,.72);--line:rgba(148,180,255,.14);--ink:#E8EEF9;--quiet:#8A97AE;--accent:#5AA9FF;--live:#3DDC97;--caution:#FFB547;--warn:#FF5D5D;--route:#E05CFF}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body{background:radial-gradient(1200px 600px at 70% -10%,rgba(90,169,255,.12),transparent 60%),var(--bg);min-height:100vh}
.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--quiet)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--quiet);margin-right:8px;vertical-align:middle}
.dot.live{background:var(--live);box-shadow:0 0 0 0 rgba(61,220,151,.6);animation:pulse 2s infinite}.dot.warn{background:var(--caution)}.dot.err{background:var(--warn)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(61,220,151,.5)}70%{box-shadow:0 0 0 8px rgba(61,220,151,0)}100%{box-shadow:0 0 0 0 rgba(61,220,151,0)}}
.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:.06em;border:1px solid var(--line);color:var(--quiet)}
.badge.replay{color:var(--caution);border-color:rgba(255,181,71,.4)}
a{color:var(--accent)}
`;

const LOGO = `<svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true" style="border-radius:6px"> <defs>  <linearGradient id="gp-bg" x1="0.1" y1="0" x2="0.9" y2="1">   <stop offset="0" stop-color="#4FB4FF"/>   <stop offset="0.5" stop-color="#2F6BFF"/>   <stop offset="1" stop-color="#7A3CFF"/>  </linearGradient>  <linearGradient id="gp-sheen" x1="0" y1="0" x2="0" y2="1">   <stop offset="0" stop-color="#fff" stop-opacity="0.42"/>   <stop offset="0.55" stop-color="#fff" stop-opacity="0.04"/>   <stop offset="1" stop-color="#fff" stop-opacity="0"/>  </linearGradient>  <linearGradient id="gp-path" x1="0" y1="0" x2="1" y2="1">   <stop offset="0" stop-color="#fff" stop-opacity="0.55"/>   <stop offset="0.6" stop-color="#fff"/>  </linearGradient> </defs> <rect width="64" height="64" rx="15" fill="url(#gp-bg)"/> <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.4" fill="url(#gp-sheen)" stroke="#fff" stroke-opacity="0.28" stroke-width="1.5"/> <path d="M11 16 C 24 16, 31 26, 37 36 C 41.5 43.5, 45 47, 53 47" fill="none" stroke="url(#gp-path)" stroke-width="5.2" stroke-linecap="round"/> <path d="M27 53 H 53" stroke="#fff" stroke-opacity="0.5" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="4.5 4"/> <circle cx="11" cy="16" r="4.2" fill="#fff"/></svg>`;

/** QR code as inline SVG (generated locally, nothing leaves the PC). */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/** /live used to be a lite page; pairing links now open the full app. Keeps old links working. */
export function liveRedirectPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Glidepath</title><script>var t=new URLSearchParams(location.search).get("token");location.replace("/app/"+(t?"#token="+encodeURIComponent(t):""));</script><a href="/app/">Open Glidepath</a>`;
}

export function statusPage(p: { local: boolean; status: BridgeStatus; token: string | null; addresses: string[]; port: number; logs: string[] }): string {
  const s = p.status;
  const stateDot = s.simState === "connected" ? "live" : s.simState === "error" ? "err" : "warn";
  const links = p.token
    ? p.addresses.map((ip) => {
        const u = `http://${ip}:${p.port}/app/#token=${encodeURIComponent(p.token!)}`;
        return `<div class="pairrow"><div class="qr">${qrSvg(u)}</div><div><div class="label">Scan with your iPad or phone camera, or open:</div><a class="mono" href="${esc(u)}">${esc(u)}</a></div></div>`;
      }).join("")
    : "";
  const here = p.token ? `http://localhost:${p.port}/app/#token=${encodeURIComponent(p.token)}` : null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glidepath Bridge</title><meta http-equiv="refresh" content="5"><style>${BASE_CSS}
main{max-width:860px;margin:0 auto;padding:32px 20px}h1{font-size:20px;font-weight:600;margin:0 0 4px;display:flex;gap:10px;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0}.panel{padding:16px}.v{font-size:17px;margin-top:4px}
a.btnp{display:inline-block;padding:10px 16px;border-radius:12px;background:var(--accent);color:#05080F;font-weight:600;text-decoration:none}.pairrow{display:flex;gap:16px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.pairrow:first-of-type{border-top:0}.qr{width:132px;height:132px;flex:none;background:#fff;border-radius:12px;padding:6px}.qr svg{width:100%;height:100%;display:block}.pairrow a{word-break:break-all}
pre{white-space:pre-wrap;font-size:12px;color:var(--quiet);max-height:320px;overflow:auto;padding:16px;margin:0}ul{padding-left:18px}</style></head><body><main>
<h1>${LOGO} Glidepath Bridge <span class="badge mono">v${esc(s.bridgeVersion)}</span></h1>
<div class="label">${esc(s.hostname)} · Bridge ${esc(s.bridgeId.slice(0, 8))}</div>
<div class="grid">
  <div class="panel"><div class="label">Simulator</div><div class="v"><span class="dot ${stateDot}"></span>${esc(s.simulator?.name ?? "Not connected")}</div><div class="label" style="margin-top:6px">${esc(s.message ?? s.simState)}</div></div>
  <div class="panel"><div class="label">Aircraft</div><div class="v">${esc(s.aircraft?.title ?? "—")}</div><div class="label" style="margin-top:6px">Profile: ${esc(s.aircraft?.profileId ?? "—")}</div></div>
  <div class="panel"><div class="label">Telemetry</div><div class="v mono">${s.framesPerSecond.toFixed(1)} fps</div><div class="label" style="margin-top:6px">${s.lastFrameAt ? "last frame " + new Date(s.lastFrameAt).toLocaleTimeString() : "no frames yet"}</div></div>
  <div class="panel"><div class="label">Connected devices</div><div class="v mono">${s.clients}</div><div class="label" style="margin-top:6px">${s.activeFlightId ? "Recording flight " + esc(s.activeFlightId.slice(0, 8)) : "No active flight"}</div></div>
</div>
${p.local ? `${here ? `<div class="panel" style="padding:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><div class="label">On this PC</div><div class="v">Open the Glidepath app here</div></div><a class="btnp" href="${esc(here)}" target="_blank" rel="noreferrer">Open Glidepath</a></div>` : ""}
<div class="panel" style="padding:16px;margin-top:12px"><div class="label" style="margin-bottom:10px">Open on your iPad or phone (same Wi-Fi)</div>
${links || "<p>No network address found. Is this PC connected to Wi-Fi or Ethernet?</p>"}
<div class="label" style="margin-top:10px">This link contains your pairing key. Only open it on your own devices. If Windows asks, allow Glidepath Bridge on <b>private</b> networks. On iPad, tap Share then Add to Home Screen to keep it as an app.</div></div>
<h2 class="label" style="margin:24px 0 8px">Recent log</h2><div class="panel"><pre class="mono">${esc(p.logs.join("\n")) || "—"}</pre></div>` : `<p class="label">Pairing details are only shown on the simulator PC itself.</p>`}
</main></body></html>`;
}

export function livePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="theme-color" content="#05080F">
<title>Glidepath · Live</title><style>${BASE_CSS}
main{max-width:1100px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) 20px 40px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.brand{display:flex;gap:10px;align-items:center;font-weight:600;letter-spacing:.02em}
.card{padding:20px 22px}
.route{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center}
.apt{font-size:34px;font-weight:700;letter-spacing:.01em}.apt small{display:block;font-size:12px;font-weight:500;color:var(--quiet);letter-spacing:.06em}
.profile{display:flex;align-items:flex-end;gap:3px;height:64px}
.profile i{flex:1;border-radius:3px;background:rgba(138,151,174,.22);min-height:4px;transition:height .4s ease,background .4s}
.profile i.on{background:var(--accent)}
.mid{text-align:center}.mid .big{font-size:22px;font-weight:600;margin-top:6px}
.strip{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);margin-top:16px;padding-top:12px;color:var(--quiet);font-size:14px}
.phase{color:var(--accent);font-weight:600;letter-spacing:.08em;font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}
.tile{padding:14px 16px}.tile .v{font-size:24px;font-weight:600;margin-top:6px;transition:color .3s}.tile .u{font-size:13px;color:var(--quiet);margin-left:4px;font-weight:500}
.two{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:14px}@media(max-width:760px){.two{grid-template-columns:1fr}.apt{font-size:26px}}
.list{padding:14px 16px}.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px}.row:last-child{border:0}
.grade{font-size:40px;font-weight:700}.na{color:var(--quiet)}
#pair{max-width:420px;margin:12vh auto;padding:24px;display:none}#pair input{width:100%;margin:12px 0;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0B1220;color:var(--ink);font:inherit}
#pair button{padding:10px 16px;border-radius:10px;border:0;background:var(--accent);color:#05080F;font-weight:600;font:inherit}
.note{font-size:12px;color:var(--quiet);margin-top:16px}
</style></head><body>
<div id="pair" class="panel"><div class="brand">${LOGO} Pair with your Bridge</div>
<p class="note">Open the Bridge status page on your simulator PC and tap the link shown there, or paste the pairing key here.</p>
<input id="tok" placeholder="Pairing key" autocomplete="off"><button id="go">Connect</button></div>
<main id="app" style="display:none">
<header><div class="brand">${LOGO} Glidepath <span id="src" class="badge" style="display:none">REPLAY</span></div>
<div class="label"><span id="dot" class="dot"></span><span id="conn">Connecting…</span></div></header>
<section class="panel card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div class="mono" id="acft" style="font-weight:600">—</div><div class="phase" id="phase">—</div></div>
  <div class="route">
    <div class="apt mono" id="dep">——<small>DEPARTURE</small></div>
    <div><div class="profile" id="prof"></div><div class="mid"><div class="big mono" id="mid">—</div><div class="label" id="midl">FLIGHT TIME</div></div></div>
    <div class="apt mono" id="arr" style="text-align:right">——<small>ARRIVAL</small></div>
  </div>
  <div class="strip"><span class="mono" id="altgs">—</span><span class="label" id="dist">—</span></div>
</section>
<div class="tiles">
  <div class="panel tile"><div class="label">Altitude</div><div class="v mono" id="alt">—</div></div>
  <div class="panel tile"><div class="label">Ground speed</div><div class="v mono" id="gs">—</div></div>
  <div class="panel tile"><div class="label">Vertical speed</div><div class="v mono" id="vs">—</div></div>
  <div class="panel tile"><div class="label">Heading</div><div class="v mono" id="hdg">—</div></div>
  <div class="panel tile"><div class="label">Indicated airspeed</div><div class="v mono" id="ias">—</div></div>
  <div class="panel tile"><div class="label">Fuel on board</div><div class="v mono" id="fuel">—</div></div>
</div>
<div class="two">
  <div class="panel list"><div class="label" style="margin-bottom:6px">Flight events</div><div id="events"><div class="row na">No events yet</div></div></div>
  <div class="panel list"><div class="label" style="margin-bottom:6px">Last landing</div><div id="landing"><div class="row na">No landing recorded yet</div></div></div>
</div>
<p class="note">Live from the Glidepath Bridge on your simulator PC. Departure and arrival appear once a SimBrief plan is linked (coming in the Glidepath app). Values your aircraft does not expose show as —.</p>
</main>
<script>
(function(){
  var q = new URLSearchParams(location.search);
  var token = q.get('token') || localStorage.getItem('gp.token');
  if (q.get('token')) { localStorage.setItem('gp.token', q.get('token')); history.replaceState(null, '', location.pathname); }
  var $ = function(id){ return document.getElementById(id); };
  if (!token) { $('pair').style.display='block'; $('go').onclick=function(){ localStorage.setItem('gp.token', $('tok').value.trim()); location.reload(); }; return; }
  $('app').style.display='block';

  var BARS = 32, lastSeq = null, ws = null, retry = 1000, flight = null, altHistory = [], events = [];
  for (var i=0;i<BARS;i++){ $('prof').appendChild(document.createElement('i')); }
  var PHASE = {PREFLIGHT:'PREFLIGHT',PUSHBACK:'PUSHBACK',TAXI_OUT:'TAXI',TAKEOFF:'TAKEOFF',CLIMB:'CLIMB',CRUISE:'CRUISE',DESCENT:'DESCENT',APPROACH:'APPROACH',LANDING:'LANDING',TAXI_IN:'TAXI TO GATE',COMPLETED:'ON BLOCKS'};
  var EVT = {OFF_BLOCK:'Off block',PUSHBACK_START:'Pushback',TAXI_START:'Taxi',TAKEOFF_ROLL:'Takeoff roll',WHEELS_UP:'Wheels up',TOP_OF_CLIMB:'Top of climb',TOP_OF_DESCENT:'Top of descent',APPROACH_START:'Approach',GO_AROUND:'Go-around',TOUCHDOWN:'Touchdown',TOUCH_AND_GO:'Touch-and-go',RUNWAY_EXIT:'Taxi speed',ON_BLOCK:'On block',ENGINES_OFF:'Engines off',SIM_PAUSED:'Sim paused',SIM_RESUMED:'Sim resumed',POSITION_DISCONTINUITY:'Position jump'};
  function fmt(v, dp){ return v===null||v===undefined ? '—' : Number(v).toLocaleString(undefined,{maximumFractionDigits:dp||0, minimumFractionDigits:dp||0}); }
  function hhmm(t){ return new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
  function dur(ms){ var m=Math.max(0,Math.round(ms/60000)); return Math.floor(m/60)+'h '+(m%60<10?'0':'')+(m%60)+'m'; }
  function setConn(state, text){ $('dot').className = 'dot ' + state; $('conn').textContent = text; }

  function renderProfile(){
    // Bars show the ALTITUDE ACTUALLY FLOWN so far (recorded history), not a forecast.
    var bars = $('prof').children, n = altHistory.length, max = 1;
    for (var i=0;i<n;i++) max = Math.max(max, altHistory[i]);
    for (var b=0;b<BARS;b++){
      var idx = Math.floor((b/BARS)*n), v = n ? altHistory[Math.min(n-1, idx)] : 0;
      bars[b].style.height = (8 + 56 * (v/max)) + 'px';
      bars[b].className = n ? 'on' : '';
    }
  }
  function onFrame(f, phase){
    lastSeq = f.seq;
    var alt = f.position.altMslFt, gs = f.speed.gsKt;
    $('alt').innerHTML = fmt(alt) + '<span class="u">ft</span>';
    $('gs').innerHTML = fmt(gs) + '<span class="u">kt</span>';
    $('vs').innerHTML = (f.speed.vsFpm>0?'+':'') + fmt(f.speed.vsFpm) + '<span class="u">fpm</span>';
    $('hdg').innerHTML = (f.attitude.headingMagDeg===null?'—':String(Math.round(f.attitude.headingMagDeg)%360).padStart(3,'0')) + '<span class="u">°M</span>';
    $('ias').innerHTML = fmt(f.speed.iasKt) + '<span class="u">kt</span>';
    $('fuel').innerHTML = fmt(f.fuel.totalKg) + '<span class="u">kg</span>';
    $('altgs').textContent = fmt(alt) + ' ft · ' + fmt(gs) + ' kt';
    var shownPhase = (flight && flight.status === 'completed' && phase === 'PREFLIGHT') ? 'COMPLETED' : phase;
    $('phase').textContent = PHASE[shownPhase] || shownPhase;
    if (!f.position.onGround && alt !== null) { altHistory.push(alt); if (altHistory.length > 2000) history = altHistory.filter(function(_,i){return i%2===0;}); }
    if (flight && flight.status === 'completed') {
      $('mid').textContent = flight.wheelsUpAt && flight.wheelsDownAt ? dur(flight.wheelsDownAt - flight.wheelsUpAt) : '—';
      $('midl').textContent = 'AIRBORNE TIME';
      $('dist').textContent = fmt(flight.distanceNm) + ' NM FLOWN';
    } else if (flight) {
      var start = flight.wheelsUpAt || flight.offBlockAt;
      $('mid').textContent = start ? dur(f.t - start) : '—';
      $('midl').textContent = flight.wheelsUpAt ? 'AIRBORNE' : flight.offBlockAt ? 'SINCE OFF BLOCK' : 'AT GATE';
      $('dist').textContent = fmt(flight.distanceNm) + ' NM FLOWN';
    }
    renderProfile();
  }
  function renderFlight(fl){
    if (!fl) return;
    // Keep showing a completed flight until the next one actually leaves the gate.
    if (flight && flight.status === 'completed' && fl.id !== flight.id && !fl.offBlockAt) return;
    flight = fl;
    $('acft').textContent = [fl.callsign, fl.aircraft && (fl.aircraft.icaoType || fl.aircraft.title)].filter(Boolean).join(' · ') || '—';
    $('dep').innerHTML = (fl.departureIcao || '——') + '<small>' + (fl.offBlockAt ? 'OFF BLOCK ' + hhmm(fl.offBlockAt) : 'DEPARTURE') + '</small>';
    $('arr').innerHTML = (fl.arrivalIcao || '——') + '<small>' + (fl.onBlockAt ? 'ON BLOCK ' + hhmm(fl.onBlockAt) : 'ARRIVAL') + '</small>';
    $('src').style.display = fl.simulator && fl.simulator.source === 'replay' ? 'inline-block' : 'none';
  }
  function renderEvents(){
    var el = $('events'); if (!events.length) return; el.innerHTML = '';
    events.slice(-8).reverse().forEach(function(e){ var r=document.createElement('div'); r.className='row'; r.innerHTML='<span>'+(EVT[e.type]||e.type)+'</span><span class="mono na">'+hhmm(e.t)+'</span>'; el.appendChild(r); });
  }
  function renderLanding(l){
    var rows = [['Touchdown', fmt(l.touchdownVsFpm)+' fpm'+(l.touchdownVsSource==='derived'?' (derived)':'')],['Peak load', fmt(l.peakG,2)+' g'],['Bounces', String(l.bounces)],['Speed', fmt(l.iasKt)+' kt IAS'],['Pitch', fmt(l.pitchDeg,1)+'°'],['Runway', l.runway ? l.runway.ident + ' · ' + fmt(l.runway.distanceFromThresholdFt) + ' ft past threshold' : 'not identified']];
    $('landing').innerHTML = '<div style="display:flex;gap:16px;align-items:center;margin:6px 0 10px"><div class="grade">'+l.grade+'</div><div><div class="mono">'+fmt(l.score,1)+' / 100</div><div class="na" style="font-size:13px">'+l.verdict+'</div></div></div>' +
      rows.map(function(r){ return '<div class="row"><span class="na">'+r[0]+'</span><span class="mono">'+r[1]+'</span></div>'; }).join('');
  }
  function connect(){
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '/ws?client=live-page&token=' + encodeURIComponent(token));
    ws.onopen = function(){ retry = 1000; setConn('live','Connected'); ws.send(JSON.stringify({type:'hello', protocolVersion:1, client:'live-page', lastSeq:lastSeq})); };
    ws.onmessage = function(m){
      var msg = JSON.parse(m.data);
      if (msg.type==='welcome'){ renderFlight(msg.flight); var s=msg.status; setConn(s.simState==='connected'?'live':'warn', s.simState==='connected' ? (s.simulator?s.simulator.name:'Connected') : (s.message||'Waiting for simulator')); }
      else if (msg.type==='status'){ var st=msg.status; setConn(st.simState==='connected'?'live':'warn', st.simState==='connected' ? (st.simulator?st.simulator.name:'Connected') : (st.message||'Waiting for simulator')); }
      else if (msg.type==='frame') onFrame(msg.frame, msg.phase);
      else if (msg.type==='backfill') msg.frames.forEach(function(f){ if(!f.position.onGround && f.position.altMslFt!==null) altHistory.push(f.position.altMslFt); lastSeq=f.seq; });
      else if (msg.type==='flight'){ renderFlight(msg.flight); if (msg.flight.landings.length) renderLanding(msg.flight.landings[msg.flight.landings.length-1]); }
      else if (msg.type==='event'){ events.push(msg.event); renderEvents(); }
      else if (msg.type==='landing') renderLanding(msg.landing);
      else if (msg.type==='error' && msg.code==='protocol_mismatch') setConn('err', msg.message);
    };
    ws.onclose = function(ev){
      if (ev.code === 1006 && retry > 8000) setConn('err','Bridge unreachable — retrying');
      else setConn('warn','Reconnecting…');
      setTimeout(connect, retry); retry = Math.min(retry*2, 15000);
    };
  }
  document.addEventListener('visibilitychange', function(){ if (document.visibilityState==='visible' && ws && ws.readyState>1) connect(); });
  connect();
})();
</script></body></html>`;
}
