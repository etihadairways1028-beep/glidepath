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
body::before{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(70% 55% at 50% -10%,rgba(56,110,230,.30),rgba(56,110,230,0) 70%),linear-gradient(180deg,transparent 90%,rgba(255,150,95,.11) 96%,rgba(255,150,95,0) 100%),linear-gradient(180deg,#03050c 0%,#050918 45%,#08112a 80%,#0f1630 100%)}
body::after{content:none}

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
/* Every button: lift and glow on hover, sink with a glowing ring on press, spring back on release */
button,.btnp,.btng,a.btn,a.lnk,summary,input[type=submit]{transition:transform .55s cubic-bezier(.18,1.9,.32,1),box-shadow .3s ease,filter .25s ease,background-color .2s ease;-webkit-tap-highlight-color:transparent;cursor:pointer}
@media (hover:hover) and (pointer:fine){button:not(:disabled):hover,.btnp:hover,.btng:hover,a.btn:hover{filter:brightness(1.12);box-shadow:0 10px 24px -12px rgba(10,132,255,.8),0 0 0 1px rgba(143,200,255,.35)}}
button:not(:disabled):active,button:not(:disabled):hover:active,.btnp:active,.btng:active,a.btn:active,input[type=submit]:active{transform:scale(.92);filter:brightness(1.15);box-shadow:0 0 0 5px rgba(100,181,255,.3),0 6px 18px -8px rgba(10,132,255,.8);opacity:1!important;transition:transform .09s cubic-bezier(.3,0,.2,1),box-shadow .09s ease,filter .09s ease}
summary:active{transform:scale(.98);transition:transform .07s ease}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #64B5FF;outline-offset:3px}
@media (prefers-reduced-motion:reduce){button,.btnp,.btng,a.btn{transition:filter .2s ease}button:active,.btnp:active,.btng:active{transform:none}}
/* Release: overshoot, plus a ring drawn as its own element so nothing clips it (POP_JS) */
@media (prefers-reduced-motion:no-preference){[data-pop]{animation:gpPop .6s cubic-bezier(.2,1.6,.35,1)!important}
.gp-ring{position:fixed;z-index:999;pointer-events:none;outline:3px solid rgba(120,190,255,0);animation:gpRing .62s cubic-bezier(.15,.7,.3,1) forwards}
.busy::before{content:"";width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:gpSpin .7s linear infinite;flex:none}
.shake{animation:gpShake .42s cubic-bezier(.36,.07,.19,.97)}
.rd-steps li.ok.now .rd-ic{animation:gpTick .55s cubic-bezier(.2,1.6,.35,1) both}}
.gp-ring{display:none}@media (prefers-reduced-motion:no-preference){.gp-ring{display:block}}
.busy{cursor:progress}
@keyframes gpPop{0%{scale:.9}38%{scale:1.07}70%{scale:.985}100%{scale:1}}
@keyframes gpRing{0%{outline-color:rgba(120,190,255,.95);outline-offset:0}100%{outline-color:rgba(120,190,255,0);outline-offset:20px}}
@keyframes gpSpin{to{transform:rotate(360deg)}}
@keyframes gpShake{10%,90%{translate:-1px 0}20%,80%{translate:3px 0}30%,50%,70%{translate:-6px 0}40%,60%{translate:6px 0}}
@keyframes gpTick{0%{scale:.4;opacity:0}60%{scale:1.15;opacity:1}100%{scale:1}}
`;

/** Every button: on release it springs past its size and a ring bursts outward. */
const POP_JS = `<script>(function(){if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
document.addEventListener("pointerup",function(e){var b=e.target&&e.target.closest&&e.target.closest("button,.btnp,.btng,a.btn,summary");if(!b||b.disabled)return;
b.removeAttribute("data-pop");void b.offsetWidth;b.setAttribute("data-pop","");setTimeout(function(){b.removeAttribute("data-pop");},700);
var r=b.getBoundingClientRect(),w=b.offsetWidth,h=b.offsetHeight,g=document.createElement("span");g.className="gp-ring";
g.style.cssText="left:"+(r.left+r.width/2-w/2)+"px;top:"+(r.top+r.height/2-h/2)+"px;width:"+w+"px;height:"+h+"px;border-radius:"+getComputedStyle(b).borderRadius;
document.body.appendChild(g);g.addEventListener("animationend",function(){g.remove();});setTimeout(function(){g.remove();},2000);},{passive:true});})();</script>`;

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
<button class="btnp" type="submit" id="go">Connect</button></form><div id="m"></div></div>
${POP_JS}<script>
var f=document.getElementById("f");f.onsubmit=async function(e){if(e)e.preventDefault();var m=document.getElementById("m"),g=document.getElementById("go");m.textContent="";g.classList.add("busy");g.textContent="Connecting…";
try{var r=await fetch("/api/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:document.getElementById("c").value})});var j=await r.json();
if(r.ok&&j.token){location.replace(j.app||("/app/#token="+encodeURIComponent(j.token)));return;}else{m.textContent=j.error||"That code was not accepted. Check it and try again.";f.classList.remove("shake");void f.offsetWidth;f.classList.add("shake");}}catch(_){m.textContent="Your PC cannot be reached. Check that Glidepath Bridge is open.";}g.classList.remove("busy");g.textContent="Connect";};
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
<div class="label">No account? Create a free one in <a href="https://glidepath-ad9.pages.dev/app/#/account" target="_blank" rel="noreferrer">the Glidepath app</a> (Account, then Create account), then sign in here.</div></div>`;
  }
  const state = c.online
    ? `<span class="dot live"></span>Connect anywhere is on`
    : `<span class="dot warn"></span>Connect anywhere is connecting…`;
  const sub = c.online
    ? `On your iPad or phone, open Glidepath and sign in as <b>${esc(c.email ?? "")}</b>. It connects by itself, on any Wi-Fi or mobile data.${c.devices ? ` ${c.devices === 1 ? "1 device is" : `${c.devices} devices are`} connected this way now.` : ""}`
    : esc(c.error ?? "Waiting for the internet…") + ` Signed in as <b>${esc(c.email ?? "")}</b>.`;
  return `<div class="panel sec anywhere on">${head(state, sub)}<div class="any-foot"><button id="co" class="btng" type="button">Sign this PC out</button></div></div>`;
}

export interface UpdateCard { current: string; latest: string | null; state: string; progress: number; notes: string | null; message: string | null; canInstall: boolean }

/** Top view of an airliner pointing right, drawn for the update flight. */
export const PLANE_PATH = "M15 0C15-1.3 13.4-2.2 11.5-2.2H3L-5.5-14h-3l4 11.8H-11L-14.5-7h-2l1.6 4.8V2.2L-16.5 7h2L-11 2.2h6.5l-4 11.8h3L3 2.2h8.5C13.4 2.2 15 1.3 15 0z";

function updateCard(u: UpdateCard | null): string {
  if (!u || u.state !== "available" && !(u.state === "error" && u.latest && u.latest !== u.current)) return "";
  return `<div class="panel sec upd-avail"><div class="any-h"><span class="ic big" style="--c1:#5EE07F;--c2:#1FA84A"><svg viewBox="-17 -15 34 30" fill="currentColor" style="transform:rotate(-30deg)"><path d="${PLANE_PATH}"/></svg></span>
<div style="flex:1;min-width:0"><div class="any-t">Bridge ${esc(u.latest ?? "")} is ready</div><div class="label">${u.notes ? esc(u.notes) : `You have ${esc(u.current)}. The update takes about a minute, and Windows asks once to allow it.`}</div>${u.message ? `<div class="cl-msg">${esc(u.message)}</div>` : ""}</div>
${u.canInstall ? `<button class="btnp" id="upgo" type="button">Update</button>` : `<a class="btnp" href="https://glidepath-ad9.pages.dev/#download" target="_blank" rel="noreferrer">Download</a>`}</div></div>`;
}

/** The update flight: shared by the Bridge page (here) and the app (its own copy in React). */
function updateOverlay(): string {
  return `<div id="upd" class="upd" hidden><div class="upd-card panel">
<div class="cap" id="upd-cap">Updating Glidepath Bridge</div>
<svg class="upd-map" viewBox="0 0 640 210" aria-hidden="true">
<defs><linearGradient id="updg" x1="0" x2="1"><stop offset="0" stop-color="#5E5CE6"/><stop offset="1" stop-color="#64D2FF"/></linearGradient>
<pattern id="updd" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(255,255,255,.07)"/></pattern></defs>
<rect width="640" height="210" fill="url(#updd)"/>
<path id="upd-route" d="M70 160C210 20 430 20 570 160" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 9"/>
<path id="upd-flown" d="M70 160C210 20 430 20 570 160" fill="none" stroke="url(#updg)" stroke-width="3.5" stroke-linecap="round" pathLength="1" stroke-dasharray="0 1"/>
<circle cx="70" cy="160" r="7" fill="#fff"/><circle cx="570" cy="160" r="7" fill="none" stroke="#64D2FF" stroke-width="3" id="upd-dest"/>
<text x="70" y="192" text-anchor="middle" class="upd-v" id="upd-from">1.0.0</text><text x="570" y="192" text-anchor="middle" class="upd-v" id="upd-to">1.0.1</text>
<g id="upd-plane"><path d="${PLANE_PATH}" fill="#fff" transform="scale(1.25)"/></g>
</svg>
<div class="upd-row"><span id="upd-title">Downloading</span><span id="upd-pct" class="mono"></span></div>
<div class="upd-steps"><span data-s="0">Download</span><span data-s="1">Check</span><span data-s="2">Install</span><span data-s="3">Restart</span></div>
<p id="upd-msg" class="label"></p>
</div></div>`;
}

/** The first thing on the page: what's ready, what's left, in plain words. */
function readyCard(s: BridgeStatus, c: CloudCard | null): string {
  const sim = s.simState === "connected";
  const devices = s.clients > 0 || !!c?.devices;
  const anywhere = !!c?.signedIn && c.online;
  const steps: Array<[boolean, string, string]> = [
    [true, "Bridge is running", "Keep this window open while you fly."],
    [sim, sim ? `Connected to ${esc(s.simulator?.name ?? "the simulator")}` : "Start Microsoft Flight Simulator", sim ? (s.aircraft?.title ? esc(s.aircraft.title) : "Load into a flight.") : "The Bridge connects by itself once it's running."],
    [devices || anywhere, devices ? `${s.clients} device${s.clients === 1 ? "" : "s"} connected` : anywhere ? "Ready for your iPad or phone" : "Connect your iPad or phone", devices ? "Your flight is live on them." : anywhere ? "Open Glidepath there and sign in with the same account." : "Sign in below (any Wi-Fi), or use the code."],
  ];
  const all = steps.every((x) => x[0]);
  return `<div class="panel ready${all ? " all" : ""}"><div class="rd-title">${all ? "Ready to fly" : sim ? "Almost ready" : "Getting ready"}</div><ol class="rd-steps">${steps.map(([ok, t, sub]) => `<li class="${ok ? "ok" : ""}"><span class="rd-ic">${ok ? "✓" : ""}</span><div><b>${t}</b><span>${sub}</span></div></li>`).join("")}</ol></div>`;
}

export interface LiveNumbers { altFt: number | null; gsKt: number | null; hdg: number | null; vsFpm: number | null; onGround: boolean }

export function statusPage(p: { update?: UpdateCard | null; cloud?: CloudCard | null; local: boolean; pairCode: string; status: BridgeStatus; token: string | null; addresses: string[]; port: number; logs: string[]; live?: LiveNumbers | null; hosted?: string | null }): string {
  const s = p.status;
  const sim = s.simState === "connected";
  const stateDot = sim ? "live" : s.simState === "error" ? "err" : "warn";
  const code = `${esc(p.pairCode.slice(0, 3))} ${esc(p.pairCode.slice(3))}`;
  const here = p.token ? `http://localhost:${p.port}/app/#token=${encodeURIComponent(p.token)}` : null;
  const ip = p.addresses[0];
  const c = p.cloud ?? null;
  const anywhere = !!c?.signedIn && c.online;
  const devices = s.clients;
  const ready = sim && (devices > 0 || anywhere);
  const lv = p.live && sim ? p.live : null;
  const n = (v: number | null | undefined, unit = "") => v == null || !Number.isFinite(v) ? "—" : `${Math.round(v).toLocaleString("en-US")}${unit}`;
  const head = ready ? "Ready to fly" : sim ? "Simulator connected" : s.simState === "error" ? "Can't reach the simulator" : "Waiting for the simulator";
  const sub = sim
    ? (s.aircraft?.title ? esc(s.aircraft.title) : "Load into a flight.") + (s.activeFlightId ? " · Recording this flight" : "")
    : esc(s.message ?? "Start Microsoft Flight Simulator. The Bridge connects by itself.");
  const links = p.token
    ? p.addresses.map((a) => {
        // The newest app through the relay when it's up; this PC's own copy otherwise.
        const u = p.hosted ?? `http://${a}:${p.port}/app/#token=${encodeURIComponent(p.token!)}`;
        return `<div class="qrrow"><div class="qr">${qrSvg(u)}</div><div><b>Scan with the iPad or phone camera</b><div class="label">Or open <a class="mono" href="${esc(u)}">${esc(a)}:${p.port}</a>. The link holds your pairing key, so only use it on your own devices.</div></div></div>`;
      }).join("")
    : "<p class='label'>No network address found. Is this PC on Wi-Fi or Ethernet?</p>";
  const rail = (ok: boolean | null, t: string, v: string) => `<li><span class="dot ${ok === null ? "" : ok ? "live" : "warn"}"></span><div><span>${t}</span><b>${v}</b></div></li>`;
  const cloudBody = c ? cloudCard(c).replace('<div class="panel sec anywhere', '<div class="anywhere-in') : `<p class="label">Connect anywhere isn't available on this Bridge.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glidepath Bridge</title><style>${BASE_CSS}
body::before{background:radial-gradient(60% 50% at 70% -10%,rgba(56,110,230,.28),transparent 70%),linear-gradient(180deg,#04060f,#070c1e 60%,#0a1230)}
.app{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.rail{padding:26px 20px;display:flex;flex-direction:column;gap:22px;background:rgba(10,14,30,.55);border-right:1px solid rgba(255,255,255,.07);position:sticky;top:0;height:100vh}
.brand{display:flex;gap:12px;align-items:center}.brand svg{width:42px;height:42px;border-radius:11px;box-shadow:0 10px 22px -10px rgba(47,107,255,.9)}
.brand b{display:block;font-size:17px;letter-spacing:-.01em}.brand span{font-size:12px;color:var(--faint)}
.rlist{list-style:none;margin:0;padding:0;display:grid;gap:4px}.rlist li{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.03)}
.rlist li .dot{margin:0;flex:none}.rlist li span{display:block;font-size:11.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em}.rlist li b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.rail .btnp{width:100%;margin-top:auto;padding:14px}.rail .host{font-size:12px;color:var(--faint);text-align:center}
.main{padding:28px 32px 40px;display:grid;gap:18px;align-content:start;max-width:1040px;width:100%}
.hero{padding:26px 28px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:22px;align-items:center;overflow:hidden}
.radar{width:86px;height:86px;border-radius:50%;position:relative;display:grid;place-items:center;background:radial-gradient(circle,rgba(10,132,255,.25),rgba(10,132,255,.04) 70%);box-shadow:inset 0 0 0 1px rgba(100,181,255,.35)}
.radar::before,.radar::after{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid rgba(100,181,255,.5);animation:ping 2.6s cubic-bezier(.2,.6,.3,1) infinite}.radar::after{animation-delay:1.3s}
.radar svg{width:34px;height:34px;color:#fff;filter:drop-shadow(0 4px 10px rgba(10,132,255,.8))}
.hero.ok .radar{background:radial-gradient(circle,rgba(48,209,88,.28),rgba(48,209,88,.04) 70%);box-shadow:inset 0 0 0 1px rgba(48,209,88,.45)}.hero.ok .radar::before,.hero.ok .radar::after{border-color:rgba(48,209,88,.55)}
.hero.idle .radar::before,.hero.idle .radar::after{animation-duration:3.6s}
@keyframes ping{0%{transform:scale(.55);opacity:1}100%{transform:scale(1.5);opacity:0}}
@media (prefers-reduced-motion:reduce){.radar::before,.radar::after{animation:none;opacity:.4}}
.hero h1{margin:0;font-size:30px;font-weight:750;letter-spacing:-.025em;line-height:1.1}.hero.ok h1{background:linear-gradient(92deg,#7CF2A8,#64D2FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{margin:6px 0 0;color:var(--quiet);font-size:15px}
.nums{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.num{padding:16px 18px}.num span{display:block;font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}.num b{display:block;margin-top:6px;font-size:26px;font-weight:700;letter-spacing:-.01em}.num.off b{color:var(--faint)}
.card{padding:22px 24px}.card h2{margin:0 0 4px;font-size:19px;letter-spacing:-.01em}.card>.label{margin:0 0 16px}
.tabs{display:inline-flex;gap:4px;padding:4px;border-radius:14px;background:rgba(255,255,255,.06);margin-bottom:18px;flex-wrap:wrap}
.tabs button{border:0;background:transparent;color:var(--quiet);font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:10px}
.tabs button.on{background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 .5px 0 rgba(255,255,255,.35)}
.pane{display:none}.pane.on{display:block;animation:fadeIn .25s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.codewrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:22px;align-items:center}
.bigcode{font-size:clamp(44px,6vw,64px);font-weight:750;letter-spacing:8px;line-height:1;background:linear-gradient(180deg,#fff,#B9D6FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.steps{list-style:none;margin:0;padding:0;counter-reset:n;display:grid;gap:14px}.steps li{counter-increment:n;display:flex;gap:12px;align-items:flex-start;font-size:15px}
.steps li::before{content:counter(n);flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:linear-gradient(180deg,#3A9BFF,#0A6CFF)}
.steps .big{display:block;margin-top:3px;font-size:20px;font-weight:700}
.qrrow{display:flex;gap:18px;align-items:center;padding:10px 0}.qr{width:140px;height:140px;flex:none;background:#fff;border-radius:16px;padding:8px}.qr svg{width:100%;height:100%;display:block}
.cl-form{display:flex;gap:10px;margin:14px 0 8px;flex-wrap:wrap}.cl-form input{flex:1 1 200px;min-width:0;padding:13px 16px;border-radius:12px;border:0;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);color:#fff;font:inherit;font-size:15px;outline:none}
.cl-form input:focus{box-shadow:inset 0 0 0 2px #0A84FF}.cl-msg{min-height:20px;margin-bottom:6px;color:#FF9F0A;font-size:14px}.cl-msg.ok{color:#30D158}
.any-h{display:flex;gap:14px;align-items:flex-start}.ic.big{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none}.ic.big svg{width:22px;height:22px}.any-t{font-size:17px;font-weight:700;margin:1px 0 3px}.any-foot{margin-top:14px}
.btng{border:0;border-radius:999px;padding:9px 16px;font:inherit;font-size:14px;font-weight:600;color:#fff;background:rgba(255,255,255,.12);cursor:pointer}
.upd-avail{padding:18px 22px}.upd-avail .any-h{align-items:center}.upd-avail .btnp{flex:none}
details.log summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between}details.log summary::-webkit-details-marker{display:none}details.log summary::after{content:"›";font-size:20px;color:var(--faint)}details.log[open] summary::after{transform:rotate(90deg)}
pre{white-space:pre-wrap;font-size:12px;color:var(--quiet);max-height:300px;overflow:auto;margin:12px 0 0;padding:14px;border-radius:12px;background:rgba(0,0,0,.3)}
.upd{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:20px;background:rgba(2,4,14,.55);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}.upd[hidden]{display:none}
.upd-card{width:min(720px,100%);padding:30px 32px 26px}.upd-map{width:100%;height:auto;display:block;margin:16px 0 6px;border-radius:16px;background:rgba(0,0,0,.22)}
.upd-v{font:600 13px/1 "SF Mono",ui-monospace,Consolas,monospace;fill:rgba(235,235,245,.7)}
.upd-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:20px;font-size:24px;font-weight:700}.upd-row .mono{font-size:17px;color:var(--quiet)}
.upd-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.upd-steps span{text-align:center;font-size:13px;font-weight:600;padding:9px 6px;border-radius:999px;color:var(--faint);background:rgba(255,255,255,.06)}
.upd-steps span.on{color:#fff;background:linear-gradient(180deg,#3A9BFF,#0A6CFF)}.upd-steps span.done{color:#30D158;background:rgba(48,209,88,.12)}
#upd-msg{min-height:20px;margin:16px 0 0}.upd.ok #upd-dest{fill:#30D158;stroke:#30D158}
@media(max-width:860px){.app{grid-template-columns:1fr}.rail{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center}.rlist{display:none}.rail .btnp{width:auto;margin:0 0 0 auto}.main{padding:20px}.nums{grid-template-columns:repeat(2,minmax(0,1fr))}.codewrap{grid-template-columns:1fr}.hero{grid-template-columns:1fr}}
</style></head><body><main id="root"><div class="app">
<aside class="rail">
  <div class="brand">${LOGO}<div><b>Glidepath Bridge</b><span class="mono">v${esc(s.bridgeVersion)}</span></div></div>
  ${p.local ? `<ul class="rlist">
    ${rail(true, "Bridge", "Running")}
    ${rail(sim, "Simulator", esc(sim ? s.simulator?.name ?? "Connected" : "Not connected"))}
    ${rail(devices > 0 ? true : null, "Devices", `${devices} connected`)}
    ${rail(c?.signedIn ? c.online : null, "Connect anywhere", c?.signedIn ? (c.online ? "On" : "Connecting…") : "Off")}
    ${rail(s.framesPerSecond > 0 ? true : null, "Telemetry", `${s.framesPerSecond.toFixed(0)} updates/s`)}
  </ul>` : ""}
  ${p.local && here ? `<a class="btnp" href="${esc(here)}">Open Glidepath</a>` : ""}
  <div class="host">${esc(s.hostname)}</div>
</aside>
<section class="main">
  <div class="panel hero ${ready ? "ok" : sim ? "" : "idle"}"><div class="radar">${SVG.plane}</div><div><h1>${head}</h1><p>${sub}</p></div></div>
  <div class="nums">
    <div class="panel num${lv ? "" : " off"}"><span>Altitude</span><b class="mono">${lv ? n(lv.altFt, " ft") : "—"}</b></div>
    <div class="panel num${lv ? "" : " off"}"><span>Ground speed</span><b class="mono">${lv ? n(lv.gsKt, " kt") : "—"}</b></div>
    <div class="panel num${lv ? "" : " off"}"><span>Heading</span><b class="mono">${lv && lv.hdg != null ? String(Math.round(lv.hdg) % 360).padStart(3, "0") + "°" : "—"}</b></div>
    <div class="panel num${lv ? "" : " off"}"><span>${lv?.onGround ? "On ground" : "Vertical speed"}</span><b class="mono">${lv ? (lv.onGround ? "Yes" : n(lv.vsFpm, " fpm")) : "—"}</b></div>
  </div>
  ${p.local ? `${updateCard(p.update ?? null)}
  <div class="panel card">
    <h2>Connect your iPad or phone</h2><p class="label">Pair once. It reconnects by itself every time the Bridge opens.</p>
    <div class="tabs" role="tablist"><button data-tab="code" class="on" role="tab">Code</button><button data-tab="any" role="tab">Any Wi-Fi (account)</button><button data-tab="qr" role="tab">QR code</button></div>
    <div class="pane on" data-pane="code"><div class="codewrap">
      <div><div class="cap">Your pairing code</div><div class="bigcode mono" style="margin:10px 0 12px">${code}</div><button class="btng" id="newcode" type="button">New code</button></div>
      <ol class="steps"><li><div>On the same Wi-Fi, open Safari and go to<span class="big mono">${ip ? `${esc(ip)}:${p.port}` : `glidepath.local:${p.port}`}</span></div></li><li><div>Or open <b>glidepath-ad9.pages.dev/app</b> and tap <b>Connect to my PC</b></div></li><li><div>Type the code. Done.</div></li></ol>
    </div></div>
    <div class="pane" data-pane="any">${cloudBody}</div>
    <div class="pane" data-pane="qr">${links}</div>
  </div>
  <details class="panel card log"><summary><span class="cap">Recent log</span></summary><pre class="mono">${esc(p.logs.join("\n")) || "—"}</pre></details>
  <p class="label" style="text-align:center;margin:0">Keep the Bridge running while you fly. This window updates by itself.</p>` : `<div class="panel card"><p class="label" style="margin:0">Pairing details are only shown on the simulator PC itself.</p></div>`}
</section></div></main>${p.local ? updateOverlay() : ""}
${POP_JS}<script>
function tab(t){if(!t)t=${anywhere ? '"any"' : '"code"'};[].forEach.call(document.querySelectorAll(".tabs button"),function(b){b.classList.toggle("on",b.getAttribute("data-tab")===t);});[].forEach.call(document.querySelectorAll(".pane"),function(x){x.classList.toggle("on",x.getAttribute("data-pane")===t);});}
tab(localStorage.getItem("gp-tab"));
document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest(".tabs button");if(!b)return;var t=b.getAttribute("data-tab");try{localStorage.setItem("gp-tab",t);}catch(_){}tab(t);});

var open=function(){return [].map.call(document.querySelectorAll("details"),function(d){return d.open;});};
[].forEach.call(document.querySelectorAll(".rd-steps li.ok"),function(l){l.classList.add("now");});
var busy=false;
(function(){
var L=0,route,flown,plane,shown=0,target=0,bob=0,from="",to="",gone=0,done=false;
function el(i){return document.getElementById(i);}
function put(t){if(!route){route=el("upd-route");flown=el("upd-flown");plane=el("upd-plane");L=route.getTotalLength();}
 var a=route.getPointAtLength(Math.max(0,Math.min(1,t))*L),b=route.getPointAtLength(Math.min(1,t+0.004)*L+0.01),c=route.getPointAtLength(Math.max(0,t-0.004)*L);
 var ang=Math.atan2(b.y-c.y,b.x-c.x)*180/Math.PI;plane.setAttribute("transform","translate("+a.x+","+a.y+") rotate("+ang+")");flown.setAttribute("stroke-dasharray",t+" 1");}
function frame(){bob+=0.03;var goal=target+(target>0.75&&target<0.99?Math.sin(bob)*0.012:0);shown+=(goal-shown)*0.06;put(shown);if(!done||Math.abs(shown-1)>0.002)requestAnimationFrame(frame);}
function stage(i,title,pct,msg){var s=document.querySelectorAll(".upd-steps span");for(var k=0;k<s.length;k++){s[k].className=k<i?"done":k===i?"on":"";}
 el("upd-title").textContent=title;el("upd-pct").textContent=pct||"";if(msg!==undefined)el("upd-msg").textContent=msg;}
function show(u){var o=el("upd");if(o.hidden){o.hidden=false;from=u.current;to=u.latest||"";el("upd-from").textContent=from;el("upd-to").textContent=to;requestAnimationFrame(frame);}}
function poll(){fetch("/api/update",{cache:"no-store"}).then(function(r){return r.json();}).then(function(u){gone=0;
 if(u.current===to&&to){done=true;target=1;el("upd").className="upd ok";stage(4,"Updated to "+to,"","The update is complete. This page will reload.");setTimeout(function(){location.reload();},2500);return;}
 if(u.state==="downloading"){target=0.04+0.56*u.progress;stage(0,"Downloading",Math.round(u.progress*100)+"%","");}
 else if(u.state==="verifying"){target=0.64;stage(1,"Checking the download","","Making sure it's exactly the file we published.");}
 else if(u.state==="installing"){target=0.8;stage(2,"Installing","",u.message||"");}
 else if(u.state==="error"){stage(0,"Update stopped","",u.message||"Something went wrong.");el("upd").onclick=function(){location.reload();};return;}
 setTimeout(poll,700);}).catch(function(){gone++;target=0.93;stage(3,"Restarting the Bridge","","Windows may ask on this PC to allow it. Click Yes.");setTimeout(poll,1200);});}
document.addEventListener("click",function(e){if(!e.target||e.target.id!=="upgo")return;busy=true;e.target.classList.add("busy");e.target.textContent="Starting…";
 fetch("/api/update/install",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(r){return r.json();}).then(function(u){show(u);poll();}).catch(function(){busy=false;});});
})();
function typing(){var a=document.activeElement;if(a&&a.tagName==="INPUT")return true;var ins=document.querySelectorAll(".cl-form input");for(var i=0;i<ins.length;i++)if(ins[i].value)return true;return false;}
document.addEventListener("submit",function(e){if(e.target.id!=="cl")return;e.preventDefault();var m=document.getElementById("cm"),sb=e.target.querySelector("button");m.className="cl-msg";m.textContent="";if(sb){sb.classList.add("busy");sb.textContent="Signing in…";}busy=true;
fetch("/api/cloud/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:document.getElementById("ce").value,password:document.getElementById("cp").value})}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});}).then(function(x){busy=false;if(x.ok){m.className="cl-msg ok";m.textContent="Signed in.";document.getElementById("cp").value="";document.getElementById("ce").value="";setTimeout(function(){location.reload();},900);}else{m.textContent=x.j.error||"Sign-in failed. Check your email and password.";e.target.classList.remove("shake");void e.target.offsetWidth;e.target.classList.add("shake");}if(sb){sb.classList.remove("busy");sb.textContent="Sign in";}}).catch(function(){busy=false;if(sb){sb.classList.remove("busy");sb.textContent="Sign in";}m.textContent="The Bridge could not be reached. Restart Glidepath Bridge and try again.";});});
document.addEventListener("click",function(e){if(!e.target||e.target.id!=="newcode")return;if(!confirm("Make a new pairing code? Devices already paired stay connected."))return;e.target.classList.add("busy");fetch("/api/pair/new",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(){location.reload();});});
document.addEventListener("click",function(e){if(!e.target||e.target.id!=="co")return;e.target.classList.add("busy");e.target.textContent="Signing out…";fetch("/api/cloud/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(){location.reload();});});
setInterval(function(){if(busy||typing()||document.hidden||(window.getSelection&&String(window.getSelection())))return;
fetch(location.href,{cache:"no-store"}).then(function(r){return r.ok?r.text():null;}).then(function(t){if(!t)return;var m=t.match(/<main id="root">([\\s\\S]*)<\\/main>/);if(!m)return;
var o=open(),pre=document.querySelector("pre"),sc=pre?pre.scrollTop:0,was=[].map.call(document.querySelectorAll(".rd-steps li"),function(l){return l.classList.contains("ok");});document.getElementById("root").innerHTML=m[1];tab(localStorage.getItem("gp-tab"));
[].forEach.call(document.querySelectorAll(".rd-steps li"),function(l,i){if(l.classList.contains("ok")&&!was[i])l.classList.add("now");});
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
