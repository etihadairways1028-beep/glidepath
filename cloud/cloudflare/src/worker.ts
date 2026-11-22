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
import { esc } from "./mails";
import { parseSimbrief, simbriefUrl } from "../../../packages/protocol/src/simbrief";
import { composeMonthlyBrief } from "../../../packages/flight-engine/src/brief";
import { sendGmail } from "./gmail";
import { addTrail, cleanLive, cleanName, leaderboard, monthRange, shareId } from "./social";
import { Relay } from "./relay";
import { welcomeMail, debriefMail, deviceName, inflightMail, resetMail, signinMail } from "./mails";
import { aiChat, aiChatStream, aiLeft, PER_USER_DAILY } from "./ai";
import { allowedEndpoint, publicKeyOf, pushToUser, sendPush, vapidKey } from "./push";

interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  AI?: Ai;
  VAPID_JWK?: string;
  PEPPER: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  MAILJET_API_KEY?: string;
  MAILJET_SECRET_KEY?: string;
  MAILJET_SENDER_EMAIL?: string;
  APP_URL?: string;
  /** Where support messages go (a worker secret). Defaults to the sending Gmail address. */
  SUPPORT_EMAIL?: string;
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
/** Lock screen notification kinds the Bridge may send; cl-* are checklist reminders. */
const PUSH_KINDS = ["tod", "landed", "review", "test", "cl-taxi", "cl-approach", "cl-parked"];
const PUSH_PREFS = ["tod", "checklist", "landed", "review"];
const pushPref = (kind: string) => (kind.startsWith("cl-") ? "checklist" : kind);
async function pushOff(env: Env, userId: string): Promise<string[]> {
  const r = await env.DB.prepare("SELECT off FROM push_prefs WHERE user_id = ?").bind(userId).first<{ off: string }>();
  return (r?.off ?? "").split(",").filter(Boolean);
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

async function sendEmail(env: Env, to: string, name: string | null, subject: string, html: string, text: string, replyTo?: string): Promise<string | null> {
  // Gmail with an app password (no email service needed) comes first, then Mailjet, then Brevo.
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return sendGmail(env.GMAIL_USER, env.GMAIL_APP_PASSWORD, to, name, subject, html, text, replyTo);
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

const SUPPORT_TOPICS: Record<string, string> = {
  connect: "Connecting my iPad or phone", sim: "The Bridge and the simulator", install: "Installing or updating", notifications: "Notifications",
  account: "Account and sign-in", bug: "Something isn't working", idea: "An idea for Glidepath", other: "Something else",
};
async function support(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const b = await req.json().catch(() => null) as { topic?: string; email?: string; message?: string; meta?: Record<string, unknown>; website?: string } | null;
  if (b?.website) return json(200, { ok: true, ref: "GP-OK" }); // a field only bots fill in
  const topic = SUPPORT_TOPICS[String(b?.topic)] ? String(b!.topic) : "other";
  const email = String(b?.email ?? "").trim().toLowerCase(), message = String(b?.message ?? "").trim();
  if (!validEmail(email)) return fail(400, "Add the email address you'd like the answer sent to.");
  if (message.length < 10) return fail(400, "Tell us a little more (at least a sentence), so we can help.");
  if (message.length > 5000) return fail(400, "That's a long message: keep it under 5,000 characters.");
  const ipHash = await sha256(`${req.headers.get("cf-connecting-ip") ?? "?"}:${env.PEPPER}`);
  const hour = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE ip_hash = ? AND created_at > ?").bind(ipHash, Date.now() - 3600_000).first<{ n: number }>();
  if ((hour?.n ?? 0) >= 5) return fail(429, "You've sent a few messages already. We'll answer those first; try again in an hour if you need to.");
  const day = await env.DB.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE created_at > ?").bind(Date.now() - 86_400_000).first<{ n: number }>();
  if ((day?.n ?? 0) >= 300) return fail(503, "Support is very busy today. Please try again tomorrow.");
  const who = await userFrom(req, env).catch(() => null);
  const ref = "GP-" + rand(4).toUpperCase().replace(/[01]/g, "7").slice(0, 6);
  const meta = Object.fromEntries(Object.entries(b?.meta ?? {}).slice(0, 12).map(([k, v]) => [String(k).slice(0, 30), String(v).slice(0, 200)]));
  await env.DB.prepare("INSERT INTO support_tickets (ref, created_at, email, topic, message, meta, user_id, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(ref, Date.now(), email, topic, message, JSON.stringify(meta), who?.id ?? null, ipHash).run();
  const inbox = env.SUPPORT_EMAIL ?? env.GMAIL_USER ?? env.MAILJET_SENDER_EMAIL ?? env.BREVO_SENDER_EMAIL;
  const title = SUPPORT_TOPICS[topic]!;
  const metaRows = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join("\n");
  const jobs: Promise<unknown>[] = [];
  if (inbox) jobs.push(sendEmail(env, inbox, "Glidepath Support", `[${ref}] ${title}`,
    `<p><b>${esc(title)}</b> from ${esc(email)}${who ? " (signed in)" : ""}</p><pre style="white-space:pre-wrap;font:14px/1.5 sans-serif">${esc(message)}</pre>${metaRows ? `<pre style="color:#666;font-size:12px">${esc(metaRows)}</pre>` : ""}<p>Reply to this email to answer them.</p>`,
    `${title} from ${email}\n\n${message}\n\n${metaRows}\n\nReply to this email to answer them.`, email));
  jobs.push(sendEmail(env, email, null, `We got your message (${ref})`,
    `<p>Thanks for writing to Glidepath. Your reference is <b>${ref}</b>; we'll answer at this address.</p><p style="color:#555">What you sent (${esc(title)}):</p><pre style="white-space:pre-wrap;font:14px/1.5 sans-serif;color:#333">${esc(message)}</pre><p style="color:#777;font-size:13px">Glidepath Support</p>`,
    `Thanks for writing to Glidepath. Your reference is ${ref}; we'll answer at this address.\n\nWhat you sent (${title}):\n${message}\n\nGlidepath Support`));
  const all = Promise.allSettled(jobs).then((r) => { for (const x of r) if (x.status === "fulfilled" && x.value) console.log("support email:", x.value); });
  if (ctx) ctx.waitUntil(all); else await all;
  return json(200, { ok: true, ref });
}

/** The feedback inbox: every message sent from Support, readable only by the account whose email is the support inbox. */
async function supportInbox(req: Request, env: Env): Promise<Response> {
  const who = await userFrom(req, env).catch(() => null);
  if (!who) return fail(401, "Sign in first.");
  const owner = (env.SUPPORT_EMAIL ?? env.GMAIL_USER ?? "").trim().toLowerCase();
  if (!owner || who.email.toLowerCase() !== owner) return fail(403, "Only the Glidepath support inbox can read feedback.");
  const rows = await env.DB.prepare("SELECT ref, created_at, email, topic, message, meta FROM support_tickets ORDER BY created_at DESC LIMIT 300").all<{ ref: string; created_at: number; email: string; topic: string; message: string; meta: string | null }>();
  const items = (rows.results ?? []).map((r) => ({ ref: r.ref, at: r.created_at, email: r.email, topic: r.topic, title: SUPPORT_TOPICS[r.topic] ?? r.topic, message: r.message, meta: (() => { try { return JSON.parse(r.meta ?? "{}") as Record<string, string>; } catch { return {}; } })() }));
  return json(200, { items });
}

async function weather(url: URL, ctx?: ExecutionContext): Promise<Response> {
  const kind = url.pathname.replace(/\/+$/, "").slice(4);
  let upstream: string, ttl: number;
  if (kind === "metar" || kind === "taf") {
    const ids = (url.searchParams.get("ids") ?? "").toUpperCase().split(",").map((x) => x.trim()).filter((x) => /^[A-Z0-9]{3,4}$/.test(x)).slice(0, 30);
    if (!ids.length) return fail(400, "Add one or more ICAO codes, e.g. ?ids=EGLL,OMDB");
    upstream = `https://aviationweather.gov/api/data/${kind}?ids=${ids.sort().join(",")}&format=json`;
    ttl = kind === "metar" ? 300 : 1200;
  } else if (kind === "metarbox") {
    const b = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || Math.abs(b[2]! - b[0]!) > 60 || Math.abs(b[3]! - b[1]!) > 90) return fail(400, "bbox must be south,west,north,east (a region, not the world)");
    upstream = `https://aviationweather.gov/api/data/metar?bbox=${b.map((v) => v.toFixed(1)).join(",")}&format=json`;
    ttl = 300;
  } else return fail(404, "Unknown weather request.");
  const key = new Request(upstream);
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return new Response(hit.body, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${Math.min(ttl, 120)}` } });
  const r = await fetch(upstream, { headers: { "User-Agent": "Glidepath (https://glidepath-ad9.pages.dev)" } });
  if (!r.ok) return fail(502, "The weather service didn't answer. Try again in a minute.");
  let text = await r.text();
  if (!text.trim()) text = "[]";
  if (kind === "metarbox") { try { text = JSON.stringify((JSON.parse(text) as unknown[]).slice(0, 600)); } catch { text = "[]"; } }
  const out = new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${ttl}` } });
  if (cache) { const put = cache.put(key, out.clone()); if (ctx) ctx.waitUntil(put); else await put; }
  return new Response(text, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${Math.min(ttl, 120)}` } });
}

/** The pilot's latest SimBrief plan, read and trimmed here (SimBrief doesn't allow browsers to call it). */
async function simbrief(url: URL, ctx?: ExecutionContext): Promise<Response> {
  const user = (url.searchParams.get("user") ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(user)) return fail(400, "Type your SimBrief username or Pilot ID.");
  const upstream = simbriefUrl(user);
  const key = new Request(upstream);
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return new Response(hit.body, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  const r = await fetch(upstream, { headers: { "User-Agent": "Glidepath (https://glidepath-ad9.pages.dev)" } });
  let j: unknown;
  try { j = await r.json(); } catch { return fail(502, "SimBrief didn't answer. Try again in a minute."); }
  let text: string;
  try { text = JSON.stringify(parseSimbrief(j)); }
  catch (e) { return fail(404, (e as Error).message || "No SimBrief plan found for that name."); }
  const out = new Response(text, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
  if (cache) { const put = cache.put(key, out.clone()); if (ctx) ctx.waitUntil(put); else await put; }
  return new Response(text, { headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function route(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (p === "/" || p === "/health") return json(200, { ok: true, service: "glidepath-accounts" });

  // Support Centre: a message from the website or the app, kept with a reference and emailed to support and to the sender.
  if (p === "/support" && req.method === "POST") return support(req, env, ctx);
  if (p === "/support/inbox" && req.method === "GET") return supportInbox(req, env);

  // Live weather for any device: aviationweather.gov doesn't allow browsers to ask directly, so this passes
  // its METAR/TAF answers through (read-only, inputs checked, cached at the edge for a few minutes).
  if (p.startsWith("/wx/") && req.method === "GET") return weather(url, ctx);
  if (p === "/simbrief" && req.method === "GET") return simbrief(url, ctx);

  // Web Push: the public key devices subscribe with.
  if (p === "/push/key" && req.method === "GET") {
    const k = vapidKey(env);
    return k ? json(200, { key: publicKeyOf(k) }) : fail(503, "Notifications aren't switched on yet.");
  }
  // The Bridge (signed in with its PC key) tells the pilot's devices about the flight.
  if (p === "/relay/notify" && req.method === "POST") {
    const key = req.headers.get("x-relay-key") ?? "";
    if (!/^[a-f0-9]{64}$/.test(key)) return fail(401, "This PC isn't signed in.");
    const k = await env.DB.prepare("SELECT user_id FROM relay_keys WHERE key_hash = ?").bind(await sha256(key)).first<{ user_id: string }>();
    if (!k) return fail(401, "This PC isn't signed in.");
    const b = await req.json().catch(() => null) as { kind?: string; flight_id?: string; title?: string; body?: string; url?: string } | null;
    const kind = PUSH_KINDS.includes(String(b?.kind)) ? String(b!.kind) : null;
    const title = String(b?.title ?? "").slice(0, 80), text = String(b?.body ?? "").slice(0, 240);
    if (!kind || !title) return fail(400, "Missing message.");
    // The pilot can turn each kind off in Settings (checklist reminders are one switch).
    if (kind !== "test" && (await pushOff(env, k.user_id)).includes(pushPref(kind))) return json(200, { sent: 0, reason: "Turned off in Settings." });
    // One of each kind per flight, however often the Bridge asks.
    if (kind !== "test" && !(await once(env, k.user_id, `push:${kind}:${String(b?.flight_id ?? "").slice(0, 60)}`, "1"))) return json(200, { sent: 0, reason: "Already sent for this flight." });
    const url = typeof b?.url === "string" && b.url.startsWith("/") ? b.url.slice(0, 200) : "/app/";
    return json(200, await pushToUser(env, k.user_id, { title, body: text, url, tag: `gp-${kind}` }));
  }

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

  // Pairing by code, no account: the Bridge's always-on link, keyed by its own id and secret.
  if (p === "/relay/pc") {
    const bid = url.searchParams.get("bid") ?? "", key = url.searchParams.get("key") ?? "", code = (url.searchParams.get("code") ?? "").toLowerCase();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(bid) || key.length < 24 || key.length > 200 || !/^[a-f0-9]{64}$/.test(code)) return fail(400, "Bad link.");
    const kh = await sha256(key);
    const row = await env.DB.prepare("SELECT key_hash FROM pc_links WHERE bridge_id = ?").bind(bid).first<{ key_hash: string }>();
    if (row && row.key_hash !== kh) return fail(401, "This PC's link key doesn't match.");
    // Another PC online with the same code right now: ask this one to pick a new code.
    const clash = await env.DB.prepare("SELECT bridge_id FROM pc_links WHERE code_hash = ? AND bridge_id != ? AND updated > ? LIMIT 1").bind(code, bid, Date.now() - 6 * 3600_000).first();
    if (clash) return fail(409, "That code is in use by another PC.");
    await env.DB.prepare("INSERT INTO pc_links (bridge_id, key_hash, code_hash, updated) VALUES (?, ?, ?, ?) ON CONFLICT(bridge_id) DO UPDATE SET code_hash = excluded.code_hash, updated = excluded.updated").bind(bid, kh, code, Date.now()).run();
    return env.RELAY.get(env.RELAY.idFromName(`pc:${bid}`)).fetch(withRole(req, "bridge", null));
  }
  // Typing the code: find which PC has it (rate-limited), then join that PC's relay.
  if (p === "/pc/find" && req.method === "GET") {
    const code = url.searchParams.get("code") ?? "";
    if (!/^\d{6}$/.test(code)) return fail(400, "Type the 6-digit code shown on your PC.");
    const ip = await sha256(`${req.headers.get("cf-connecting-ip") ?? "?"}:${env.PEPPER}`);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM pc_find_log WHERE ip_hash = ? AND at > ?").bind(ip, Date.now() - 600_000).first<{ n: number }>();
    if ((n?.n ?? 0) >= 12) return fail(429, "Too many tries. Wait 10 minutes and try again.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pc_find_log (ip_hash, at) VALUES (?, ?)").bind(ip, Date.now()),
      env.DB.prepare("DELETE FROM pc_find_log WHERE at < ?").bind(Date.now() - 86_400_000),
    ]);
    const row = await env.DB.prepare("SELECT bridge_id FROM pc_links WHERE code_hash = ? AND updated > ? ORDER BY updated DESC LIMIT 1").bind(await sha256(code), Date.now() - 30 * 86_400_000).first<{ bridge_id: string }>();
    if (!row) return fail(404, "No PC with that code is online. Check the code in Glidepath on your PC, and that the Bridge is running.");
    const online = await env.RELAY.get(env.RELAY.idFromName(`pc:${row.bridge_id}`)).fetch(new Request("https://relay/status", { headers: { "x-gp-role": "status" } })).then((r) => r.json<{ online: boolean }>()).catch(() => ({ online: false }));
    if (!online.online) return fail(404, "Your PC isn't online right now. Open Glidepath on the PC and try again.");
    return json(200, { bid: row.bridge_id });
  }
  if (p === "/relay/pcapp") {
    const bid = url.searchParams.get("bid") ?? "";
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(bid)) return fail(400, "Bad link.");
    // Joining needs nothing else: the Bridge itself refuses everything until the device shows its pairing key.
    return env.RELAY.get(env.RELAY.idFromName(`pc:${bid}`)).fetch(withRole(req, "app"));
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

  // Settings sync: the newest copy wins, so a change on any device shows up on the others.
  if (p === "/me/sync" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT data, updated_at FROM user_sync WHERE user_id = ?").bind(user.id).first<{ data: string; updated_at: number }>();
    return json(200, r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : { data: null, updatedAt: 0 });
  }
  if (p === "/me/sync" && req.method === "PUT") {
    const b = await req.json().catch(() => null) as { data?: unknown; updatedAt?: number } | null;
    if (!b || typeof b.data !== "object" || b.data === null || typeof b.updatedAt !== "number") return fail(400, "Send data and updatedAt.");
    const text = JSON.stringify(b.data);
    if (text.length > 32_000) return fail(413, "Too much to sync.");
    const at = Math.min(Date.now() + 60_000, Math.floor(b.updatedAt));
    await env.DB.prepare("INSERT INTO user_sync (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE excluded.updated_at > user_sync.updated_at").bind(user.id, text, at).run();
    const r = await env.DB.prepare("SELECT updated_at FROM user_sync WHERE user_id = ?").bind(user.id).first<{ updated_at: number }>();
    return json(200, { ok: true, updatedAt: r?.updated_at ?? at });
  }

  // This device's notifications: subscribe, unsubscribe, test.
  if (p === "/push/subscribe" && req.method === "POST") {
    const b = await req.json().catch(() => null) as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string } | null;
    const ep = String(b?.endpoint ?? ""), p256dh = String(b?.keys?.p256dh ?? ""), auth = String(b?.keys?.auth ?? "");
    if (!allowedEndpoint(ep) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return fail(400, "That isn't a push subscription this service can use.");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?").bind(user.id).first<{ n: number }>();
    if ((n?.n ?? 0) >= 12) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at ASC LIMIT 1)").bind(user.id).run();
    await env.DB.prepare("INSERT INTO push_subs (endpoint, user_id, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label")
      .bind(ep, user.id, p256dh, auth, String(b?.label ?? "").slice(0, 60) || null, Date.now()).run();
    return json(200, { ok: true });
  }
  if (p === "/push/unsubscribe" && req.method === "POST") {
    const b = await req.json().catch(() => null) as { endpoint?: string } | null;
    await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(b?.endpoint ?? ""), user.id).run();
    return json(200, { ok: true });
  }
  if (p === "/push/test" && req.method === "POST") {
    const b = await req.json().catch(() => null) as { endpoint?: string } | null;
    const sub = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(String(b?.endpoint ?? ""), user.id).first<{ endpoint: string; p256dh: string; auth: string }>();
    if (!sub) return fail(404, "This device isn't set up for notifications yet.");
    const r = await sendPush(env, sub, { title: "Glidepath notifications are on", body: "You'll hear about top of descent, your landing and your review, even with the app closed.", url: "/app/#/settings", tag: "gp-test" });
    return r === "ok" ? json(200, { ok: true }) : fail(502, r === "gone" ? "This device's subscription has expired. Turn notifications off and on again." : "The push service didn't accept the test. Try again in a minute.");
  }

  if (p === "/ai/chat" && req.method === "POST") {
    const body = await req.json().catch(() => null) as { stream?: boolean } | null;
    if (body?.stream) {
      const r = await aiChatStream(env, user.id, body);
      if ("stream" in r) return new Response(r.stream, { headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
      return json(r.status, r.body);
    }
    const r = await aiChat(env, user.id, body);
    return json(r.status, r.body);
  }
  if (p === "/ai/status" && req.method === "GET") return json(200, { available: !!env.AI, left: await aiLeft(env, user.id), perDay: PER_USER_DAILY });

  if (p === "/auth/logout" && req.method === "POST") {
    const t = (req.headers.get("Authorization") ?? "").split(/\s+/)[1] ?? "";
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return json(200, { ok: true });
  }
  if (p === "/push/prefs" && req.method === "GET") {
    const off = await pushOff(env, user.id);
    return json(200, Object.fromEntries(PUSH_PREFS.map((k) => [k, !off.includes(k)])));
  }
  if (p === "/push/prefs" && req.method === "PUT") {
    const b = await body<Record<string, unknown>>(req);
    const cur = await pushOff(env, user.id);
    const on = Object.fromEntries(PUSH_PREFS.map((k) => [k, typeof b?.[k] === "boolean" ? (b[k] as boolean) : !cur.includes(k)]));
    const off = PUSH_PREFS.filter((k) => !on[k]).join(",");
    await env.DB.prepare("INSERT INTO push_prefs (user_id, off, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET off = excluded.off, updated_at = excluded.updated_at").bind(user.id, off, Date.now()).run();
    return json(200, on);
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
    await env.DB.batch(["sessions", "flights", "bridges", "relay_keys", "email_prefs", "password_resets", "email_log", "live_shares", "challenge", "ai_usage", "user_sync", "push_subs", "push_prefs"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id)).concat(env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)));
    return json(200, { ok: true });
  }

  const del = /^\/flights\/([A-Za-z0-9-]{1,64})$/.exec(p);
  if (del && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM flights WHERE user_id = ? AND id = ?").bind(user.id, del[1]).run();
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
