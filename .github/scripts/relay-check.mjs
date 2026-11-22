// Live check of pairing by code through the relay: a stand-in PC joins, a stand-in iPad finds it
// by code and pairs, exactly as the Bridge and the app do. Uses random ids; leaves nothing behind but a row.
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";
const API = process.env.API ?? "https://glidepath-accounts.webeyepagesdev.workers.dev";
const bid = "check-" + randomBytes(6).toString("hex");
const key = randomBytes(24).toString("base64url");
const code = String(100000 + Math.floor(Math.random() * 899999));
const token = randomBytes(16).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const fail = (m) => { console.log("FAIL:", m); process.exit(1); };
const pc = new WebSocket(`${API.replace(/^http/, "ws")}/relay/pc?bid=${bid}&key=${encodeURIComponent(key)}&code=${sha(code)}`);
pc.on("unexpected-response", (_q, r) => fail(`PC link refused: HTTP ${r.statusCode}`));
// Relay frames to the PC are "<device id>\n<json>", and answers go back the same way.
pc.on("message", (d) => {
  const s = String(d), i = s.indexOf("\n");
  if (i < 0) return;
  const cid = s.slice(0, i); let m; try { m = JSON.parse(s.slice(i + 1)); } catch { return; }
  if (m.$ === "req" && m.path === "/api/pair") pc.send(`${cid}\n${JSON.stringify({ $: "res", id: m.id, status: m.body?.code === code ? 200 : 401, ct: "application/json", text: JSON.stringify(m.body?.code === code ? { token } : { error: "wrong code" }) })}`);
});
await new Promise((r, j) => { pc.on("open", r); setTimeout(() => j(new Error("PC link didn't open")), 15000); }).catch((e) => fail(e.message));
console.log("PC link open");
await new Promise((r) => setTimeout(r, 1500));
const f = await fetch(`${API}/pc/find?code=${code}`); const fj = await f.json();
console.log("find:", f.status, JSON.stringify(fj));
if (fj.bid !== bid) fail("find didn't return the PC");
const app = new WebSocket(`${API.replace(/^http/, "ws")}/relay/pcapp?bid=${bid}`);
const got = await new Promise((res) => {
  app.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.$ === "bridge" && m.online) app.send(JSON.stringify({ $: "req", id: "pair", method: "POST", path: "/api/pair", body: { code } }));
    if (m.$ === "res" && m.id === "pair") res(m);
  });
  setTimeout(() => res(null), 15000);
});
if (!got) fail("no answer through the relay");
console.log("pair:", got.status, got.text);
if (got.status !== 200 || JSON.parse(got.text).token !== token) fail("pairing didn't come back");
console.log("OK: pairing by code through the live relay works");
process.exit(0);
