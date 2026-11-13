// Production check for Connect anywhere, run by the deploy workflow.
// Makes a throwaway account, connects a stand-in PC and a stand-in iPad through
// the real relay, checks a message goes across both ways, then deletes the account.
// Usage: node relay-check.mjs <service base url>   (Node 22+, no packages needed)
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) { console.error("usage: relay-check.mjs <base>"); process.exit(2); }
const ws = (u) => u.replace(/^http/, "ws");
const call = async (path, init = {}) => {
  const r = await fetch(base + path, { method: init.method ?? "GET", headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const open = (url) => new Promise((resolve, reject) => {
  const s = new WebSocket(url); const msgs = []; s.msgs = msgs;
  s.addEventListener("message", (e) => msgs.push(String(e.data)));
  s.addEventListener("open", () => resolve(s));
  s.addEventListener("error", () => reject(new Error(`couldn't open ${url.split("?")[0]}`)));
  setTimeout(() => reject(new Error(`timed out opening ${url.split("?")[0]}`)), 15000);
});
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

const email = `ci-relay-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
let token = null, ok = false;
try {
  const su = await call("/auth/signup", { method: "POST", body: { email, password: "ci-relay-password-1", name: "CI" } });
  token = su.data.token; if (!token) throw new Error(`sign-up failed (${su.status}) ${JSON.stringify(su.data)}`);
  const link = await call("/relay/link", { method: "POST", token, body: { bridge_id: "ci", name: "CI PC" } });
  if (!link.data.key) throw new Error(`link failed (${link.status}) ${JSON.stringify(link.data)}`);
  const pc = await open(`${ws(base)}/relay/bridge?key=${link.data.key}`);
  pc.addEventListener("message", (e) => { const s = String(e.data); const i = s.indexOf("\n"); const cid = s.slice(0, i), body = s.slice(i + 1); if (!body.startsWith('{"$"')) pc.send(`${cid}\n${JSON.stringify({ echo: body })}`); });
  const st = await call("/relay/status", { token });
  if (!st.data.online) throw new Error(`status doesn't show the PC online: ${JSON.stringify(st.data)}`);
  const app = await open(`${ws(base)}/relay/app?token=${token}`);
  if (!(await until(() => app.msgs.find((m) => m.includes('"online":true'))))) throw new Error(`app never heard the PC is online: ${JSON.stringify(app.msgs)}`);
  if (!(await until(() => pc.msgs.find((m) => m.endsWith('{"$":"open"}'))))) throw new Error("PC never heard the app connect");
  app.send("hello-from-ipad");
  if (!(await until(() => app.msgs.find((m) => m.includes('"echo":"hello-from-ipad"'))))) throw new Error(`no answer came back: ${JSON.stringify(app.msgs)}`);
  app.send("ping");
  if (!(await until(() => app.msgs.includes("pong")))) throw new Error("ping wasn't answered");
  pc.close();
  if (!(await until(() => app.msgs.find((m) => m.includes('"online":false'))))) throw new Error("app wasn't told the PC went offline");
  app.close();
  const refused = await open(`${ws(base)}/relay/app?token=${"0".repeat(64)}`).then((s) => { s.close(); return false; }, () => true);
  if (!refused) throw new Error("a wrong token was let in");
  ok = true;
  console.log(`Connect anywhere works through ${base}: PC and iPad connected, messages both ways, offline notice, wrong token refused.`);
} catch (e) {
  console.error(`::error::Connect anywhere check failed through ${base}: ${e.message}`);
} finally {
  if (token) await call("/me", { method: "DELETE", token }).catch(() => undefined);
}
process.exit(ok ? 0 : 1);
