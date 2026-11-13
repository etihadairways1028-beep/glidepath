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
:root{color-scheme:dark;--bg:#060818;--panel:rgba(30,34,52,.34);--line:rgba(255,255,255,.12);--ink:#fff;--quiet:rgba(235,235,245,.62);--faint:rgba(235,235,245,.38);--accent:#0A84FF;--live:#30D158;--caution:#FF9F0A;--warn:#FF453A;--route:#BF5AF2}
*{box-sizing:border-box}html{background:var(--bg)}html,body{margin:0;color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh;background:transparent;overflow-x:hidden}
body::before{content:"";position:fixed;inset:-25%;z-index:-2;pointer-events:none;background:radial-gradient(38% 34% at 18% 22%,#2F5BFF 0%,transparent 70%),radial-gradient(34% 32% at 82% 18%,#8A3FFC 0%,transparent 70%),radial-gradient(40% 36% at 70% 82%,#00BFA6 0%,transparent 70%),radial-gradient(30% 28% at 22% 85%,#FF5E8A 0%,transparent 72%);opacity:.85;filter:blur(30px) saturate(1.2);animation:drift 40s ease-in-out infinite alternate}
body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(60% 50% at 50% 50%,transparent 40%,rgba(0,0,10,.45) 100%)}
@keyframes drift{to{transform:translate3d(4vmax,3vmax,0) scale(1.08)}}
@media (prefers-reduced-motion:reduce){body::before{animation:none}}
.mono{font-family:"SF Mono",ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace;font-variant-numeric:tabular-nums}
.panel{position:relative;background:linear-gradient(140deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,0) 28%,rgba(255,255,255,0) 72%,rgba(255,255,255,.13) 100%),var(--panel);border:0;border-radius:24px;-webkit-backdrop-filter:blur(15px) saturate(185%) brightness(1.06);backdrop-filter:blur(15px) saturate(185%) brightness(1.06);box-shadow:inset 1.5px 1.5px 1px -.5px rgba(255,255,255,.9),inset -1.5px -1.5px 1px -.5px rgba(255,255,255,.5),inset 0 0 0 .5px rgba(255,255,255,.3),inset 6px 8px 14px -10px rgba(255,255,255,.42),0 18px 40px -18px rgba(0,0,0,.55)}
.label{font-size:13px;color:var(--quiet)}
.cap{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--quiet)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--faint);margin-right:8px;vertical-align:middle}
.dot.live{background:var(--live);animation:pulse 2s infinite}.dot.warn{background:var(--caution)}.dot.err{background:var(--warn)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(48,209,88,.55)}70%{box-shadow:0 0 0 8px rgba(48,209,88,0)}100%{box-shadow:0 0 0 0 rgba(48,209,88,0)}}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(255,255,255,.12);box-shadow:inset 0 .5px 0 rgba(255,255,255,.4);color:var(--quiet)}
.badge.replay{color:var(--caution)}
a{color:#64B5FF}
.btnp{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:999px;background:linear-gradient(180deg,#3A9BFF,#0A6CFF);color:#fff!important;font-weight:600;text-decoration:none;border:0;font-size:16px;box-shadow:inset 0 1px .5px rgba(255,255,255,.6),0 10px 24px -10px rgba(10,132,255,.8);cursor:pointer}
.btnp:active{opacity:.6}
.ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;color:#fff;background:linear-gradient(140deg,var(--c1),var(--c2));box-shadow:inset 1px 1px .5px rgba(255,255,255,.7),0 6px 14px -6px rgba(0,0,0,.5)}
.ic svg{width:19px;height:19px}
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

/** What an iPad sees at http://glidepath.local:4810 : type the code from the PC, get paired. */
export function pairPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Connect to Glidepath</title><style>${BASE_CSS}
main{max-width:440px;margin:0 auto;padding:64px 20px;text-align:center}.card{padding:34px 24px 26px}h1{font-size:28px;font-weight:700;letter-spacing:-.02em;margin:18px 0 6px}p{color:var(--quiet);line-height:1.5;margin:0}
.code{display:flex;gap:8px;justify-content:center;margin:26px 0 16px}
#c{width:100%;max-width:300px;font-size:36px;letter-spacing:.35em;text-align:center;padding:14px 10px 14px 24px;border-radius:18px;border:0;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.25),inset 0 2px 6px rgba(0,0,0,.25);color:inherit;font-family:"SF Mono",ui-monospace,Consolas,monospace;outline:none}
#c:focus{box-shadow:inset 0 0 0 2px #0A84FF}
button.btnp{width:100%;max-width:300px;padding:15px;font-size:17px}
#m{min-height:22px;margin-top:14px;color:#FF9F0A}.logo svg{width:64px;height:64px;border-radius:15px;box-shadow:0 14px 30px -12px rgba(47,107,255,.8)}</style></head><body><main>
<div class="panel card"><div class="logo" style="display:flex;justify-content:center">${LOGO}</div>
<h1>Connect this iPad</h1>
<p>Type the 6-digit code shown on your PC, in the Glidepath Bridge window.</p>
<form id="f"><div class="code"><input id="c" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" autofocus></div>
<button class="btnp" type="submit">Connect</button></form><div id="m"></div></div>
<script>
var f=document.getElementById("f");f.onsubmit=async function(e){if(e)e.preventDefault();var m=document.getElementById("m");m.textContent="Connecting…";
try{var r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:document.getElementById("c").value})});var j=await r.json();
if(r.ok&&j.token){location.replace("/app/#token="+encodeURIComponent(j.token));}else{m.textContent=j.error||"That didn't work. Try again.";}}catch(_){m.textContent="Can't reach your PC. Is the Bridge still open?";}};
var q=new URLSearchParams(location.search).get("code");if(q&&/^\\d{6}$/.test(q)){document.getElementById("c").value=q;f.onsubmit();}
</script></main></body></html>`;
}

const SVG = {
  sim: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  plane: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg>`,
  dev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M11 18h2"/></svg>`,
};

export interface CloudCard { signedIn: boolean; email: string | null; online: boolean; error: string | null; devices: number }

const GLOBE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z"/></svg>`;

function cloudCard(c: CloudCard | null): string {
  if (!c) return "";
  const head = (title: string, sub: string, dot = "") => `<div class="any-h"><span class="ic big" style="--c1:#64D2FF;--c2:#5E5CE6">${GLOBE}</span><div><div class="any-t">${dot}${title}</div><div class="label">${sub}</div></div></div>`;
  if (!c.signedIn) {
    return `<div class="panel sec anywhere">${head("Connect anywhere", "Sign in with your Glidepath account. Your iPad or phone then connects on any Wi-Fi, or even mobile data. No codes.")}
<form id="cl" class="cl-form" autocomplete="on"><input id="ce" type="email" placeholder="Email" autocomplete="username" required><input id="cp" type="password" placeholder="Password" autocomplete="current-password" required><button class="btnp" type="submit">Sign in</button></form>
<div id="cm" class="cl-msg">${c.error ? esc(c.error) : ""}</div>
<div class="label">No account yet? It's free: open <a href="https://glidepath-ad9.pages.dev/app/#/account" target="_blank" rel="noreferrer">Glidepath</a> and tap Create account, then sign in here.</div></div>`;
  }
  const state = c.online
    ? `<span class="dot live"></span>Connect anywhere is on`
    : `<span class="dot warn"></span>Connect anywhere is connecting…`;
  const sub = c.online
    ? `On your iPad or phone, open Glidepath and sign in as <b>${esc(c.email ?? "")}</b>. It connects by itself, on any Wi-Fi or mobile data.${c.devices ? ` ${c.devices === 1 ? "1 device is" : `${c.devices} devices are`} connected this way now.` : ""}`
    : esc(c.error ?? "Waiting for the internet…") + ` Signed in as <b>${esc(c.email ?? "")}</b>.`;
  return `<div class="panel sec anywhere on">${head(state, sub)}<div class="any-foot"><button id="co" class="btng" type="button">Sign this PC out</button></div></div>`;
}

export function statusPage(p: { cloud?: CloudCard | null; local: boolean; pairCode: string; status: BridgeStatus; token: string | null; addresses: string[]; port: number; logs: string[] }): string {
  const s = p.status;
  const stateDot = s.simState === "connected" ? "live" : s.simState === "error" ? "err" : "warn";
  const code = `${esc(p.pairCode.slice(0, 3))} ${esc(p.pairCode.slice(3))}`;
  const links = p.token
    ? p.addresses.map((ip) => {
        const u = `http://${ip}:${p.port}/app/#token=${encodeURIComponent(p.token!)}`;
        return `<div class="pairrow"><div class="qr">${qrSvg(u)}</div><div><div class="label">Scan with your iPad or phone camera, or open:</div><a class="mono" href="${esc(u)}">${esc(u)}</a></div></div>`;
      }).join("")
    : "";
  const here = p.token ? `http://localhost:${p.port}/app/#token=${encodeURIComponent(p.token)}` : null;
  const tile = (c1: string, c2: string, icon: string, k: string, v: string, sub: string) =>
    `<div class="panel tile"><div class="tile-h"><span class="ic" style="--c1:${c1};--c2:${c2}">${icon}</span><span class="cap">${k}</span></div><div class="v">${v}</div><div class="label">${sub}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glidepath Bridge</title><style>${BASE_CSS}
main{max-width:900px;margin:0 auto;padding:36px 22px 60px}
.head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.head .logo svg{width:52px;height:52px;border-radius:13px;box-shadow:0 12px 26px -12px rgba(47,107,255,.85)}
h1{font-size:30px;font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.1}.head .label{margin-top:3px}.head .btnp{margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin:26px 0 14px}
.tile{padding:16px 16px 15px}.tile-h{display:flex;align-items:center;gap:10px;margin-bottom:12px}.tile .v{font-size:19px;font-weight:600;letter-spacing:-.01em;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:14px}@media(max-width:720px){.two{grid-template-columns:minmax(0,1fr)}.head .btnp{margin-left:0;width:100%}}
.codecard{padding:26px 22px;text-align:center;display:flex;flex-direction:column;justify-content:center}.bigcode{font-size:clamp(40px,11vw,58px);font-weight:700;letter-spacing:6px;margin:8px 0 6px;background:linear-gradient(180deg,#fff,#B9D6FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.easy{padding:22px}.steps{list-style:none;margin:14px 0 14px;padding:0;counter-reset:n}.steps li{counter-increment:n;display:flex;gap:14px;align-items:flex-start;margin:0 0 16px;font-size:16px}
.steps li::before{content:counter(n);flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;background:linear-gradient(180deg,#3A9BFF,#0A6CFF);box-shadow:inset 0 1px .5px rgba(255,255,255,.6)}
.big{display:inline-block;margin-top:4px;font-size:clamp(19px,5.4vw,24px);overflow-wrap:anywhere;font-weight:700;color:#fff}.big.code{color:#64B5FF;letter-spacing:.12em}
.sec{padding:18px 20px;margin-top:14px}.pairrow{display:flex;gap:16px;align-items:center;padding:12px 0;border-top:.5px solid var(--line)}.pairrow:first-of-type{border-top:0}
.qr{width:128px;height:128px;flex:none;background:#fff;border-radius:16px;padding:7px}.qr svg{width:100%;height:100%;display:block}.pairrow a{word-break:break-all;font-size:13px}
details.sec summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}details.sec summary::-webkit-details-marker{display:none}details.sec summary::after{content:"›";font-size:22px;color:var(--faint);transition:transform .2s}details[open].sec summary::after{transform:rotate(90deg)}
pre{white-space:pre-wrap;font-size:12px;color:var(--quiet);max-height:320px;overflow:auto;margin:12px 0 0;padding:14px;border-radius:14px;background:rgba(0,0,0,.28)}
.foot{margin-top:18px;text-align:center}
.anywhere{margin:0 0 14px;padding:20px}.any-h{display:flex;gap:14px;align-items:flex-start}.ic.big{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;flex:none}.ic.big svg{width:24px;height:24px}
.any-t{font-size:19px;font-weight:700;letter-spacing:-.01em;margin:1px 0 3px}.anywhere .label{line-height:1.45}
.cl-form{display:flex;gap:10px;margin:16px 0 8px;flex-wrap:wrap}.cl-form input{flex:1 1 200px;min-width:0;padding:13px 16px;border-radius:14px;border:0;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.25);color:#fff;font:inherit;font-size:16px;outline:none}
.cl-form input:focus{box-shadow:inset 0 0 0 2px #0A84FF}.cl-form .btnp{flex:0 0 auto;padding:12px 26px}.cl-msg{min-height:20px;margin-bottom:6px;color:#FF9F0A;font-size:14px}.cl-msg.ok{color:#30D158}
.any-foot{margin-top:14px;display:flex;justify-content:flex-end}.btng{border:0;border-radius:999px;padding:9px 16px;font:inherit;font-size:14px;font-weight:600;color:#fff;background:rgba(255,255,255,.12);box-shadow:inset 0 .5px 0 rgba(255,255,255,.4);cursor:pointer}.btng:active{opacity:.6}
@media(max-width:720px){.cl-form .btnp{width:100%}}</style></head><body><main id="root">
<div class="head"><span class="logo">${LOGO}</span><div><h1>Glidepath Bridge</h1><div class="label">${esc(s.hostname)} · <span class="badge mono">v${esc(s.bridgeVersion)}</span></div></div>${p.local && here ? `<a class="btnp" href="${esc(here)}" target="_blank" rel="noreferrer">Open Glidepath</a>` : ""}</div>
<div class="grid">
${tile("#64D2FF", "#0A84FF", SVG.sim, "Simulator", `<span class="dot ${stateDot}"></span>${esc(s.simulator?.name ?? "Not connected")}`, esc(s.message ?? s.simState))}
${tile("#FFB340", "#FF7A00", SVG.plane, "Aircraft", esc(s.aircraft?.title ?? "—"), `Profile: ${esc(s.aircraft?.profileId ?? "—")}`)}
${tile("#5EE07F", "#1FA84A", SVG.wave, "Telemetry", `<span class="mono">${s.framesPerSecond.toFixed(1)} fps</span>`, s.lastFrameAt ? "Last frame " + new Date(s.lastFrameAt).toLocaleTimeString() : "No frames yet")}
${tile("#D18CFF", "#8A3FFC", SVG.dev, "Devices", `<span class="mono">${s.clients}</span> connected`, s.activeFlightId ? "Recording flight " + esc(s.activeFlightId.slice(0, 8)) : "No active flight")}
</div>
${p.local ? `${cloudCard(p.cloud ?? null)}<div class="two">
<div class="panel codecard"><div class="cap">Your pairing code</div><div class="bigcode mono">${code}</div><div class="label">Also saved on your Desktop as <b>Glidepath code.txt</b>.</div></div>
<div class="panel easy"><div class="cap">Connect your iPad in 2 steps</div>
  <ol class="steps"><li><div>On the iPad, open <b>Safari</b> and go to<br><span class="big mono">glidepath.local:${p.port}</span></div></li>
  <li><div>Type this code:<br><span class="big mono code">${code}</span></div></li></ol>
  <div class="label">Or open the Glidepath website on the iPad, tap Connect and type the same code. Tap Share, then Add to Home Screen, to keep it as an app.</div>
</div></div>
<details class="panel sec" open><summary><span class="cap">Or scan this with your iPad camera (same Wi-Fi)</span></summary><div style="margin-top:10px">
${links || "<p class='label'>No network address found. Is this PC connected to Wi-Fi or Ethernet?</p>"}
<div class="label" style="margin-top:10px">This link contains your pairing key. Only open it on your own devices. If Windows asks, allow Glidepath Bridge on <b>private</b> networks.</div></div></details>
<details class="panel sec"><summary><span class="cap">Recent log</span></summary><pre class="mono">${esc(p.logs.join("\n")) || "—"}</pre></details>
<div class="label foot">Keep the Bridge window open while you fly. This page updates by itself.</div>` : `<div class="panel sec"><p class="label" style="margin:0">Pairing details are only shown on the simulator PC itself.</p></div>`}
</main>
<script>
var open=function(){return [].map.call(document.querySelectorAll("details"),function(d){return d.open;});};
var busy=false;
function typing(){var a=document.activeElement;if(a&&a.tagName==="INPUT")return true;var ins=document.querySelectorAll(".cl-form input");for(var i=0;i<ins.length;i++)if(ins[i].value)return true;return false;}
document.addEventListener("submit",function(e){if(e.target.id!=="cl")return;e.preventDefault();var m=document.getElementById("cm");m.className="cl-msg";m.textContent="Signing in…";busy=true;
fetch("/api/cloud/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:document.getElementById("ce").value,password:document.getElementById("cp").value})}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(x){busy=false;if(x.ok){m.className="cl-msg ok";m.textContent="Signed in.";document.getElementById("cp").value="";document.getElementById("ce").value="";setTimeout(function(){location.reload();},900);}else{m.textContent=x.j.error||"That didn't work. Try again.";}}).catch(function(){busy=false;m.textContent="Couldn't reach the Bridge.";});});
document.addEventListener("click",function(e){if(!e.target||e.target.id!=="co")return;e.target.textContent="Signing out…";fetch("/api/cloud/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(){location.reload();});});
setInterval(function(){if(busy||typing()||document.hidden||(window.getSelection&&String(window.getSelection())))return;
fetch(location.href,{cache:"no-store"}).then(function(r){return r.ok?r.text():null;}).then(function(t){if(!t)return;var m=t.match(/<main id="root">([\\s\\S]*)<\\/main>/);if(!m)return;
var o=open(),pre=document.querySelector("pre"),sc=pre?pre.scrollTop:0;document.getElementById("root").innerHTML=m[1];
[].forEach.call(document.querySelectorAll("details"),function(d,i){d.open=!!o[i];});var p2=document.querySelector("pre");if(p2)p2.scrollTop=sc;}).catch(function(){});},5000);
</script></body></html>`;
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
