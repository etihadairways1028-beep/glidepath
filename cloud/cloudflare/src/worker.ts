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

interface Env {
  DB: D1Database;
  PEPPER: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
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

async function userFrom(req: Request, env: Env): Promise<User | null> {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.get("Authorization") ?? "");
  if (!m) return null;
  const th = await sha256(m[1]!);
  const row = await env.DB.prepare("SELECT u.id, u.email, u.display_name, u.monthly_email, s.last_used FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(th).first<User & { last_used: number }>();
  if (!row) return null;
  if (Date.now() - row.last_used > 3600_000) await env.DB.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").bind(Date.now(), th).run();
  return row;
}

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

/** A short welcome email after sign-up (only when email is switched on). */
function welcomeEmail(name: string | null) {
  const hi = name ? `Hi ${name.replace(/[<>&]/g, "")},` : "Hi,";
  const app = "https://glidepath-ad9.pages.dev/app/";
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0b1527">
<h1 style="font-size:24px;margin:0 0 12px">Welcome to Glidepath</h1>
<p>${hi}</p><p>Your account is ready. Your logbook now follows you to every device you sign in on.</p>
<ol><li>Install the Bridge on your sim PC from <a href="https://glidepath-ad9.pages.dev/#download">the website</a>.</li>
<li>Open Glidepath on your iPad or phone and type the 6-digit code from your PC.</li><li>Fly. Your debrief is waiting when you park.</li></ol>
<p><a href="${app}" style="display:inline-block;background:#0A84FF;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open Glidepath</a></p>
<p style="color:#667;font-size:13px">You'll get one short email on the 1st of each month about your flying. Turn it off any time in the app under Account.</p></div>`;
  const text = `${hi}\n\nYour Glidepath account is ready.\n1. Install the Bridge on your sim PC: https://glidepath-ad9.pages.dev/#download\n2. Open Glidepath on your iPad and type the 6-digit code from your PC.\n3. Fly.\n\nOpen Glidepath: ${app}`;
  return { html, text };
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
    return json(200, { token: await newSession(env, u!.id), user: publicUser(u!) });
  }

  const user = await userFrom(req, env);
  if (!user) return fail(401, "Sign in first.");

  if (p === "/auth/logout" && req.method === "POST") {
    const t = (req.headers.get("Authorization") ?? "").split(/\s+/)[1] ?? "";
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return json(200, { ok: true });
  }
  if (p === "/me" && req.method === "GET") return json(200, publicUser(user));
  if (p === "/me" && req.method === "PATCH") {
    const b = await body<{ monthly_email?: boolean; display_name?: string }>(req);
    if (typeof b?.monthly_email === "boolean") await env.DB.prepare("UPDATE users SET monthly_email = ? WHERE id = ?").bind(b.monthly_email ? 1 : 0, user.id).run();
    if (typeof b?.display_name === "string") await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(b.display_name.trim().slice(0, 60) || null, user.id).run();
    const u = await env.DB.prepare("SELECT id, email, display_name, monthly_email FROM users WHERE id = ?").bind(user.id).first<User>();
    return json(200, publicUser(u!));
  }
  if (p === "/me" && req.method === "DELETE") {
    await env.DB.batch(["sessions", "flights", "bridges"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)).concat(env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)));
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
    for (const f of list) {
      const s = JSON.stringify(f.summary ?? null);
      if (!f.id || typeof f.id !== "string" || f.id.length > 64 || s.length > 200_000) return fail(400, "A flight wasn't in the expected format.");
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO flights (user_id, id, status, off_block_at, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(user.id, f.id, String(f.status ?? "completed"), Number(f.off_block_at) || Date.now(), s, Date.now()));
    }
    if (stmts.length) await env.DB.batch(stmts);
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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try { return await route(req, env, ctx); } catch (e) { console.error(e); return fail(500, "Something went wrong on our side. Try again in a minute."); }
  },
  async scheduled(_c: ScheduledController, env: Env): Promise<void> { await monthly(env); },
};
