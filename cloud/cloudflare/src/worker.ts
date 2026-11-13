/**
 * Glidepath accounts on Cloudflare (Workers + D1, free plan, no card).
 *
 * Email + password accounts, sessions as random bearer tokens (only their
 * SHA-256 is stored), flight summaries (no telemetry), saved PCs, and the
 * monthly brief (sent through Brevo if its key is set; otherwise skipped).
 *
 * Passwords: PBKDF2-SHA256 with a per-user salt plus a server-side pepper
 * (the PEPPER secret), so a copy of the database alone isn't enough to test
 * guesses. Ten wrong passwords lock that email for 15 minutes.
 */
import { composeMonthlyBrief } from "../../../packages/flight-engine/src/brief";
import { sendGmail } from "./gmail";
import { addTrail, cleanLive, cleanName, leaderboard, monthRange, shareId } from "./social";
import { Relay } from "./relay";
import { welcomeMail, debriefMail, deviceName, inflightMail, resetMail, signinMail } from "./mails";

interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  PEPPER: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  MAILJET_API_KEY?: string;
  MAILJET_SECRET_KEY?: string;
  MAILJET_SENDER_EMAIL?: string;
  APP_URL?: string;
  DOWNLOAD_URL?: string;
}

const ITER = 30_000;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hashPassword(pw: string, salt: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${pw}\u0000${pepper}`), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITER }, key, 256);
  return hex(bits);
}
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

interface User { id: string; email: string; display_name: string | null; monthly_email: number }

async function userFrom(req: Request, env: Env, tokenParam?: string | null): Promise<User | null> {
  const token = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.get("Authorization") ?? "")?.[1] ?? /^[a-f0-9]{64}$/i.exec(tokenParam ?? "")?.[0];
  if (!token) return null;
  const th = await sha256(token);
  const row = await env.DB.prepare("SELECT u.id, u.email, u.display_name, u.monthly_email, s.last_used FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(th).first<User & { last_used: number }>();
  if (!row) return null;
  if (Date.now() - row.last_used > 3600_000) await env.DB.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").bind(Date.now(), th).run();
  return row;
}

interface Prefs { debrief: boolean; inflight: boolean; signin: boolean }
async function prefsOf(env: Env, userId: string): Promise<Prefs> {
  const r = await env.DB.prepare("SELECT debrief, inflight, signin FROM email_prefs WHERE user_id = ?").bind(userId).first<{ debrief: number; inflight: number; signin: number }>();
  return { debrief: r ? !!r.debrief : true, inflight: r ? !!r.inflight : true, signin: r ? !!r.signin : true };
}
/** Send at most once per (kind, period); returns false if it was already sent. */
async function once(env: Env, userId: string, kind: string, period: string): Promise<boolean> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO email_log (user_id, kind, period, sent_at) VALUES (?, ?, ?, ?)").bind(userId, kind, period, Date.now()).run();
  return (r.meta?.changes ?? 0) > 0;
}
async function sentSince(env: Env, userId: string, kindPrefix: string, since: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM email_log WHERE user_id = ? AND kind LIKE ? AND sent_at >= ?").bind(userId, `${kindPrefix}%`, since).first<{ n: number }>();
  return r?.n ?? 0;
}
const whenText = () => new Date().toUTCString().replace(":00 GMT", " UTC").replace(" GMT", " UTC");

async function newSession(env: Env, userId: string): Promise<string> {
  const token = rand(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, Date.now(), Date.now()).run();
  return token;
}

const publicUser = (u: { id: string; email: string; display_name: string | null; monthly_email?: number }) =>
  ({ id: u.id, email: u.email, display_name: u.display_name, monthly_email: u.monthly_email === undefined ? true : !!u.monthly_email });

async function body<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function sendEmail(env: Env, to: string, name: string | null, subject: string, html: string, text: string): Promise<string | null> {
  // Gmail with an app password (no email service needed) comes first, then Mailjet, then Brevo.
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return sendGmail(env.GMAIL_USER, env.GMAIL_APP_PASSWORD, to, name, subject, html, text);
  // Mailjet (free, 200 a day) if its keys are set, otherwise Brevo.
  if (env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY && env.MAILJET_SENDER_EMAIL) {
    const r = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ Messages: [{ From: { Email: env.MAILJET_SENDER_EMAIL, Name: "Glidepath" }, To: [{ Email: to, ...(name ? { Name: name } : {}) }], Subject: subject, TextPart: text, HTMLPart: html }] }),
    });
    return r.ok ? null : `Email service said ${r.status}.`;
  }
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return "Email isn't switched on yet.";
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Glidepath", email: env.BREVO_SENDER_EMAIL }, to: [{ email: to, ...(name ? { name } : {}) }], subject, htmlContent: html, textContent: text }),
  });
  return r.ok ? null : `Email service said ${r.status}.`;
}

async function flightsBetween(env: Env, userId: string, from: number, to: number) {
  const { results } = await env.DB.prepare("SELECT summary FROM flights WHERE user_id = ? AND off_block_at >= ? AND off_block_at < ? LIMIT 2000").bind(userId, from, to).all<{ summary: string }>();
  return results.map((r) => JSON.parse(r.summary));
}

/** A short welcome email after sign-up. */
function welcomeEmail(name: string | null) { const m = welcomeMail(name); return { html: m.html, text: m.text }; }

const relayStub = (env: Env, userId: string) => env.RELAY.get(env.RELAY.idFromName(userId));
/** Pass the WebSocket upgrade on to the relay, saying who is connecting (set here only; never trusted from outside). */
function withRole(req: Request, role: "bridge" | "app", name?: string | null): Request {
  const h = new Headers(req.headers);
  h.delete("x-gp-role"); h.delete("x-gp-name");
  h.set("x-gp-role", role);
  if (name) h.set("x-gp-name", name);
  return new Request(req.url, { method: req.method, headers: h });
}

async function route(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p === "/" || p === "/health") return json(200, { ok: true, service: "glidepath-accounts" });

  if (p === "/auth/signup" && req.method === "POST") {
    const b = await body<{ name?: string; email?: string; password?: string }>(req);
    const email = (b?.email ?? "").trim().toLowerCase(), pw = b?.password ?? "", name = (b?.name ?? "").trim().slice(0, 60) || null;
    if (!validEmail(email)) return fail(400, "That email address doesn't look right.");
    if (pw.length < 8 || pw.length > 200) return fail(400, "Use a password of at least 8 characters.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return fail(409, "There's already an account with that email. Sign in instead.");
    const id = crypto.randomUUID(), salt = rand(16);
    await env.DB.prepare("INSERT INTO users (id, email, display_name, pw_hash, pw_salt, monthly_email, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(id, email, name, await hashPassword(pw, salt, env.PEPPER), salt, Date.now()).run();
    const w = welcomeEmail(name);
    ctx?.waitUntil(sendEmail(env, email, name, "Welcome to Glidepath", w.html, w.text).then((e) => { if (e) console.log("welcome email:", e); }));
    return json(201, { token: await newSession(env, id), user: publicUser({ id, email, display_name: name }) });
  }

  if (p === "/auth/login" && req.method === "POST") {
    const b = await body<{ email?: string; password?: string }>(req);
    const email = (b?.email ?? "").trim().toLowerCase(), pw = b?.password ?? "";
    const lock = await env.DB.prepare("SELECT count, first_at FROM login_fails WHERE email = ?").bind(email).first<{ count: number; first_at: number }>();
    if (lock && lock.count >= 10 && Date.now() - lock.first_at < 15 * 60_000) return fail(429, "Too many wrong passwords. Wait 15 minutes and try again.");
    const u = await env.DB.prepare("SELECT id, email, display_name, monthly_email, pw_hash, pw_salt FROM users WHERE email = ?").bind(email).first<User & { pw_hash: string; pw_salt: string }>();
    const ok = !!u && sameText(await hashPassword(pw, u.pw_salt, env.PEPPER), u.pw_hash);
    if (!ok) {
      if (!lock || Date.now() - lock.first_at >= 15 * 60_000) await env.DB.prepare("INSERT OR REPLACE INTO login_fails (email, count, first_at) VALUES (?, 1, ?)").bind(email, Date.now()).run();
      else await env.DB.prepare("UPDATE login_fails SET count = count + 1 WHERE email = ?").bind(email).run();
      return fail(401, "That email and password don't match an account.");
    }
    await env.DB.prepare("DELETE FROM login_fails WHERE email = ?").bind(email).run();
    if ((await prefsOf(env, u!.id)).signin && (await sentSince(env, u!.id, "signin", Date.now() - 600_000)) === 0) {
      await once(env, u!.id, "signin", String(Date.now()));
      const m = signinMail(deviceName(req.headers.get("User-Agent") ?? ""), whenText());
      ctx?.waitUntil(sendEmail(env, u!.email, u!.display_name, m.subject, m.html, m.text).then((e) => { if (e) console.log("signin email:", e); }));
    }
    return json(200, { token: await newSession(env, u!.id), user: publicUser(u!) });
  }

  // Follow my flight: anyone with the link can watch. No email or account details, ever.
  const lm = /^\/live\/([a-z2-9]{6,16})$/.exec(p);
  if (lm && req.method === "GET") {
    const r = await env.DB.prepare("SELECT data, trail, updated_at, ended_at, created_at FROM live_shares WHERE id = ?").bind(lm[1]).first<{ data: string | null; trail: string | null; updated_at: number; ended_at: number | null; created_at: number }>();
    if (!r) return fail(404, "This flight link doesn't exist or has expired.");
    const live = !r.ended_at && !!r.data && Date.now() - r.updated_at < 10 * 60_000;
    return json(200, { live, ended: !!r.ended_at, updatedAt: r.updated_at, startedAt: r.created_at, ...(r.data ? JSON.parse(r.data) : {}), trail: r.trail ? JSON.parse(r.trail) : [] });
  }

  if (p === "/auth/forgot" && req.method === "POST") {
    const b = await body<{ email?: string }>(req);
    const email = (b?.email ?? "").trim().toLowerCase();
    // Same answer whether or not the account exists, so nobody can test which emails are registered.
    const done = json(200, { ok: true, message: "If there's an account with that email, a reset link is on its way. Check your inbox (and Spam)." });
    if (!validEmail(email)) return done;
    const u = await env.DB.prepare("SELECT id, email, display_name FROM users WHERE email = ?").bind(email).first<{ id: string; email: string; display_name: string | null }>();
    if (!u) return done;
    if ((await sentSince(env, u.id, "reset:", Date.now() - 3600_000)) >= 3) return done;
    const token = rand(32);
    await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").bind(u.id, Date.now()).run();
    await env.DB.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), u.id, Date.now() + 3600_000).run();
    await once(env, u.id, `reset:${token.slice(0, 8)}`, String(Date.now()));
    const m = resetMail(`${env.APP_URL ?? "https://glidepath-ad9.pages.dev/app/"}#/reset/${token}`);
    ctx?.waitUntil(sendEmail(env, u.email, u.display_name, m.subject, m.html, m.text).then((e) => { if (e) console.log("reset email:", e); }));
    return done;
  }
  if (p === "/auth/reset" && req.method === "POST") {
    const b = await body<{ token?: string; password?: string }>(req);
    const token = String(b?.token ?? ""), pw = b?.password ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) return fail(400, "That reset link isn't valid. Ask for a new one.");
    if (pw.length < 8 || pw.length > 200) return fail(400, "Use a password of at least 8 characters.");
    const th = await sha256(token);
    const r = await env.DB.prepare("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?").bind(th).first<{ user_id: string; expires_at: number }>();
    if (!r || r.expires_at < Date.now()) return fail(400, "That reset link has expired or was already used. Ask for a new one.");
    const salt = rand(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").bind(await hashPassword(pw, salt, env.PEPPER), salt, r.user_id),
      env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(r.user_id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(r.user_id), // sign out everywhere
    ]);
    const u = await env.DB.prepare("SELECT id, email, display_name, monthly_email FROM users WHERE id = ?").bind(r.user_id).first<User>();
    await env.DB.prepare("DELETE FROM login_fails WHERE email = ?").bind(u!.email).run();
    return json(200, { token: await newSession(env, r.user_id), user: publicUser(u!) });
  }

  // Connect anywhere: the Bridge and signed-in devices meet in the account's relay.
  if (p === "/relay/bridge") {
    const key = url.searchParams.get("key") ?? "";
    if (!/^[a-f0-9]{64}$/.test(key)) return fail(401, "This PC isn't signed in.");
    const k = await env.DB.prepare("SELECT user_id, name, last_used FROM relay_keys WHERE key_hash = ?").bind(await sha256(key)).first<{ user_id: string; name: string | null; last_used: number }>();
    if (!k) return fail(401, "This PC was signed out. Sign in again on the Bridge page.");
    if (Date.now() - k.last_used > 3600_000) await env.DB.prepare("UPDATE relay_keys SET last_used = ? WHERE key_hash = ?").bind(Date.now(), await sha256(key)).run();
    return relayStub(env, k.user_id).fetch(withRole(req, "bridge", k.name));
  }
  if (p === "/relay/app") {
    const u = await userFrom(req, env, url.searchParams.get("token"));
    if (!u) return fail(401, "Sign in first.");
    return relayStub(env, u.id).fetch(withRole(req, "app"));
  }
  if (p === "/relay/unlink" && req.method === "POST") {
    const b = await body<{ key?: string }>(req);
    if (b?.key) await env.DB.prepare("DELETE FROM relay_keys WHERE key_hash = ?").bind(await sha256(String(b.key))).run();
    return json(200, { ok: true });
  }

  const user = await userFrom(req, env);
  if (!user) return fail(401, "Sign in first.");

  if (p === "/relay/link" && req.method === "POST") {
    const b = await body<{ bridge_id?: string; name?: string }>(req);
    const key = rand(32);
    const bid = String(b?.bridge_id ?? "").slice(0, 64) || rand(8);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM relay_keys WHERE user_id = ? AND bridge_id = ?").bind(user.id, bid),
      env.DB.prepare("INSERT INTO relay_keys (key_hash, user_id, bridge_id, name, created_at, last_used) VALUES (?, ?, ?, ?, ?, ?)").bind(await sha256(key), user.id, bid, String(b?.name ?? "").slice(0, 80) || null, Date.now(), Date.now()),
    ]);
    return json(200, { key, user: publicUser(user) });
  }
  if (p === "/relay/status" && req.method === "GET") {
    const linked = await env.DB.prepare("SELECT name FROM relay_keys WHERE user_id = ? ORDER BY last_used DESC LIMIT 1").bind(user.id).first<{ name: string | null }>();
    if (!linked) return json(200, { linked: false, online: false, name: null });
    const st = await relayStub(env, user.id).fetch(new Request("https://relay/status", { headers: { "x-gp-role": "status" } })).then((r) => r.json<{ online: boolean; name: string | null }>());
    return json(200, { linked: true, online: st.online, name: st.name ?? linked.name });
  }

  if (p === "/auth/logout" && req.method === "POST") {
    const t = (req.headers.get("Authorization") ?? "").split(/\s+/)[1] ?? "";
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return json(200, { ok: true });
  }
  if (p === "/me" && req.method === "GET") return json(200, { ...publicUser(user), email_prefs: await prefsOf(env, user.id) });
  if (p === "/me" && req.method === "PATCH") {
    const b = await body<{ monthly_email?: boolean; display_name?: string; email_prefs?: Partial<Prefs> }>(req);
    if (b?.email_prefs && typeof b.email_prefs === "object") {
      const cur = await prefsOf(env, user.id);
      const n = { ...cur, ...Object.fromEntries(Object.entries(b.email_prefs).filter(([k, v]) => ["debrief", "inflight", "signin"].includes(k) && typeof v === "boolean")) } as Prefs;
      await env.DB.prepare("INSERT OR REPLACE INTO email_prefs (user_id, debrief, inflight, signin) VALUES (?, ?, ?, ?)").bind(user.id, n.debrief ? 1 : 0, n.inflight ? 1 : 0, n.signin ? 1 : 0).run();
    }
    if (typeof b?.monthly_email === "boolean") await env.DB.prepare("UPDATE users SET monthly_email = ? WHERE id = ?").bind(b.monthly_email ? 1 : 0, user.id).run();
    if (typeof b?.display_name === "string") await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(b.display_name.trim().slice(0, 60) || null, user.id).run();
    const u = await env.DB.prepare("SELECT id, email, display_name, monthly_email FROM users WHERE id = ?").bind(user.id).first<User>();
    return json(200, { ...publicUser(u!), email_prefs: await prefsOf(env, user.id) });
  }
  if (p === "/me" && req.method === "DELETE") {
    await env.DB.batch(["sessions", "flights", "bridges", "relay_keys", "email_prefs", "password_resets", "email_log", "live_shares", "challenge"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)).concat(env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)));
    return json(200, { ok: true });
  }

  if (p === "/flights" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT summary FROM flights WHERE user_id = ? ORDER BY off_block_at DESC LIMIT 2000").bind(user.id).all<{ summary: string }>();
    return json(200, results.map((r) => JSON.parse(r.summary)));
  }
  if (p === "/flights" && req.method === "PUT") {
    const list = await body<Array<{ id?: string; status?: string; off_block_at?: number; summary?: unknown }>>(req);
    if (!Array.isArray(list) || list.length > 50) return fail(400, "Send up to 50 flights at a time.");
    const stmts = [];
    const fresh: Array<Record<string, unknown>> = [];
    for (const f of list) {
      // A debrief email for a flight that just finished (not for old flights arriving on a first sync).
      const sm = (f.summary ?? {}) as Record<string, unknown>;
      const endT = Number(sm.onBlockAt ?? sm.endedAt ?? 0);
      if (f.id && String(f.status ?? "completed") === "completed" && endT > Date.now() - 6 * 3600_000) fresh.push({ ...sm, id: f.id });
      const s = JSON.stringify(f.summary ?? null);
      if (!f.id || typeof f.id !== "string" || f.id.length > 64 || s.length > 200_000) return fail(400, "A flight wasn't in the expected format.");
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO flights (user_id, id, status, off_block_at, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(user.id, f.id, String(f.status ?? "completed"), Number(f.off_block_at) || Date.now(), s, Date.now()));
    }
    if (stmts.length) await env.DB.batch(stmts);
    if (fresh.length && (await prefsOf(env, user.id)).debrief) {
      for (const f of fresh.slice(0, 2)) {
        if ((await sentSince(env, user.id, "debrief:", Date.now() - 86_400_000)) >= 6) break;
        if (!(await once(env, user.id, `debrief:${String(f.id).slice(0, 60)}`, "1"))) continue;
        const m = debriefMail(f);
        ctx?.waitUntil(sendEmail(env, user.email, user.display_name, m.subject, m.html, m.text).then((e) => { if (e) console.log("debrief email:", e); }));
      }
    }
    return json(200, { saved: stmts.length });
  }

  if (p === "/bridges" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT bridge_id, name, addresses, port, token, updated_at FROM bridges WHERE user_id = ? ORDER BY updated_at DESC").bind(user.id).all<{ addresses: string; updated_at: number }>();
    return json(200, results.map((r) => ({ ...r, addresses: JSON.parse(r.addresses), updated_at: new Date(r.updated_at).toISOString() })));
  }
  if (p === "/bridges" && req.method === "PUT") {
    const b = await body<{ bridge_id?: string; name?: string; addresses?: string[]; port?: number; token?: string }>(req);
    if (!b?.bridge_id || !b.token) return fail(400, "Missing PC details.");
    await env.DB.prepare("INSERT OR REPLACE INTO bridges (user_id, bridge_id, name, addresses, port, token, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(user.id, String(b.bridge_id).slice(0, 64), (b.name ?? "").slice(0, 80) || null, JSON.stringify((b.addresses ?? []).slice(0, 8)), Number(b.port) || 4810, String(b.token).slice(0, 200), Date.now()).run();
    return json(200, { ok: true });
  }
  const bm = /^\/bridges\/([^/]+)$/.exec(p);
  if (bm && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM bridges WHERE user_id = ? AND bridge_id = ?").bind(user.id, decodeURIComponent(bm[1]!)).run();
    return json(200, { ok: true });
  }

  if (p === "/brief/preview" && req.method === "POST") {
    const period = new Date().toISOString().slice(0, 13);
    if (await env.DB.prepare("SELECT 1 FROM email_log WHERE user_id = ? AND kind = 'preview' AND period = ?").bind(user.id, period).first()) return fail(429, "You've had a preview this hour. Try again later.");
    const now = new Date();
    const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const flights = await flightsBetween(env, user.id, from, Date.now() + 1);
    const brief = composeMonthlyBrief(flights, now.getUTCFullYear(), now.getUTCMonth() + 1, { name: user.display_name, appUrl: env.APP_URL ?? "https://etihadairways1028-beep.github.io/glidepath/app/" });
    if (!brief) return json(200, { sent: false, reason: "No flights this month yet. Fly one and try again." });
    const err = await sendEmail(env, user.email, user.display_name, brief.subject, brief.html, brief.text);
    if (err) return json(200, { sent: false, reason: err });
    await env.DB.prepare("INSERT OR IGNORE INTO email_log (user_id, kind, period, sent_at) VALUES (?, 'preview', ?, ?)").bind(user.id, period, Date.now()).run();
    return json(200, { sent: true });
  }

  if (p === "/notify" && req.method === "POST") {
    const b = await body<{ kind?: string; flight_id?: string; title?: string; body?: string }>(req);
    const kind = ["tod", "arrival", "flight"].includes(String(b?.kind)) ? String(b!.kind) : "flight";
    const title = String(b?.title ?? "").slice(0, 80), text = String(b?.body ?? "").slice(0, 300);
    if (!title) return fail(400, "Missing message.");
    if (!(await prefsOf(env, user.id)).inflight) return json(200, { sent: false, reason: "In-flight emails are off." });
    if ((await sentSince(env, user.id, "inflight:", Date.now() - 3600_000)) >= 6) return json(200, { sent: false, reason: "Enough emails for this hour." });
    if (!(await once(env, user.id, `inflight:${kind}:${String(b?.flight_id ?? "").slice(0, 60)}`, "1"))) return json(200, { sent: false, reason: "Already sent for this flight." });
    const m = inflightMail(kind, title, text);
    const err = await sendEmail(env, user.email, user.display_name, m.subject, m.html, m.text);
    // If it didn't go out, forget it so the next try can send it.
    if (err) await env.DB.prepare("DELETE FROM email_log WHERE user_id = ? AND kind = ? AND period = '1'").bind(user.id, `inflight:${kind}:${String(b?.flight_id ?? "").slice(0, 60)}`).run();
    return json(200, err ? { sent: false, reason: err } : { sent: true });
  }

  if (p === "/live/start" && req.method === "POST") {
    const now = Date.now();
    await env.DB.prepare("UPDATE live_shares SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL").bind(now, user.id).run();
    await env.DB.prepare("DELETE FROM live_shares WHERE updated_at < ?").bind(now - 3 * 86_400_000).run();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM live_shares WHERE user_id = ? AND created_at > ?").bind(user.id, now - 86_400_000).first<{ n: number }>();
    if ((n?.n ?? 0) >= 20) return fail(429, "That's a lot of live links today. Try again tomorrow.");
    const id = shareId();
    await env.DB.prepare("INSERT INTO live_shares (id, user_id, created_at, updated_at, data, trail) VALUES (?, ?, ?, ?, NULL, '[]')").bind(id, user.id, now, now - 60_000).run();
    return json(200, { id });
  }
  if (p === "/live/update" && req.method === "POST") {
    const b = await body<Record<string, unknown>>(req);
    const id = String(b?.id ?? "");
    const clean = cleanLive(b);
    if (!clean) return fail(400, "No position yet.");
    const r = await env.DB.prepare("SELECT trail, updated_at, ended_at FROM live_shares WHERE id = ? AND user_id = ?").bind(id, user.id).first<{ trail: string | null; updated_at: number; ended_at: number | null }>();
    if (!r || r.ended_at) return fail(404, "This live link was stopped. Start a new one.");
    if (Date.now() - r.updated_at < 4000) return json(200, { ok: true, skipped: true });
    await env.DB.prepare("UPDATE live_shares SET data = ?, trail = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(clean), addTrail(r.trail, clean.pos), Date.now(), id).run();
    return json(200, { ok: true });
  }
  if (p === "/live/stop" && req.method === "POST") {
    const b = await body<{ id?: string }>(req);
    await env.DB.prepare("UPDATE live_shares SET ended_at = ? WHERE id = ? AND user_id = ? AND ended_at IS NULL").bind(Date.now(), String(b?.id ?? ""), user.id).run();
    return json(200, { ok: true });
  }

  if (p === "/challenge" && req.method === "GET") {
    const range = monthRange(url.searchParams.get("month"));
    const joined = await env.DB.prepare("SELECT name FROM challenge WHERE user_id = ?").bind(user.id).first<{ name: string }>();
    return json(200, { month: range.key, joined: !!joined, name: joined?.name ?? null, ...(await leaderboard(env.DB, range.from, range.to, user.id)) });
  }
  if (p === "/challenge/join" && req.method === "POST") {
    const b = await body<{ name?: string }>(req);
    const name = cleanName(b?.name) ?? cleanName(user.display_name) ?? `Pilot ${user.id.slice(0, 4).toUpperCase()}`;
    await env.DB.prepare("INSERT OR REPLACE INTO challenge (user_id, name, joined_at) VALUES (?, ?, ?)").bind(user.id, name, Date.now()).run();
    return json(200, { joined: true, name });
  }
  if (p === "/challenge/leave" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM challenge WHERE user_id = ?").bind(user.id).run();
    return json(200, { joined: false });
  }

  if (p === "/download" && req.method === "GET") {
    return json(200, { url: env.DOWNLOAD_URL ?? "https://github.com/etihadairways1028-beep/glidepath/releases/latest/download/GlidepathBridge-Setup.exe" });
  }

  return fail(404, "Not found.");
}

/** 1st of each month: email last month's brief to everyone who wants it (each person at most once). */
async function monthly(env: Env): Promise<void> {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, period = `${y}-${String(m).padStart(2, "0")}`;
  const from = d.getTime(), to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const { results } = await env.DB.prepare("SELECT id, email, display_name FROM users WHERE monthly_email = 1 AND id NOT IN (SELECT user_id FROM email_log WHERE kind = 'monthly' AND period = ?) LIMIT 300").bind(period).all<User>();
  for (const u of results) {
    const brief = composeMonthlyBrief(await flightsBetween(env, u.id, from, to), y, m, { name: u.display_name, appUrl: env.APP_URL ?? "https://etihadairways1028-beep.github.io/glidepath/app/" });
    if (brief && (await sendEmail(env, u.email, u.display_name, brief.subject, brief.html, brief.text))) continue;
    await env.DB.prepare("INSERT OR IGNORE INTO email_log (user_id, kind, period, sent_at) VALUES (?, 'monthly', ?, ?)").bind(u.id, period, Date.now()).run();
  }
}

export { Relay };

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try { return await route(req, env, ctx); } catch (e) { console.error(e); return fail(500, "Something went wrong on our side. Try again in a minute."); }
  },
  async scheduled(_c: ScheduledController, env: Env): Promise<void> { await monthly(env); },
};
