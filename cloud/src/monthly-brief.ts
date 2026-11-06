// monthly-brief: emails each pilot a summary of last month's flying (Brevo).
//  - Called by the schedule (header x-cron-secret) on the 1st of each month: everyone with briefs on.
//  - Called by a signed-in user ({ preview: true }): sends that person this month's brief so far, at most once an hour.
// deno-lint-ignore-file no-explicit-any
import { composeMonthlyBrief } from "../../packages/flight-engine/src/brief.ts";
import { admin, CORS, env, reply, userFrom } from "./shared.ts";

declare const Deno: { serve(h: (req: Request) => Response | Promise<Response>): void };

async function sendEmail(to: string, name: string | null, subject: string, html: string, text: string): Promise<string | null> {
  const r = await fetch(env("BREVO_API_URL") || "https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Glidepath", email: env("BREVO_SENDER_EMAIL") }, to: [{ email: to, ...(name ? { name } : {}) }], subject, htmlContent: html, textContent: text }),
  });
  return r.ok ? null : `Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`;
}

async function flightsFor(db: any, userId: string, from: Date, to: Date): Promise<any[]> {
  const { data, error } = await db.from("flights").select("summary").eq("user_id", userId).gte("off_block_at", from.toISOString()).lt("off_block_at", to.toISOString()).limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.summary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!env("BREVO_API_KEY") || !env("BREVO_SENDER_EMAIL")) return reply(500, { error: "Email isn't set up: add the BREVO_API_KEY and BREVO_SENDER_EMAIL secrets." });
  const db = admin();
  const appUrl = env("APP_URL") || "https://etihadairways1028-beep.github.io/glidepath/app/";
  const cron = env("CRON_SECRET");
  const isCron = !!cron && req.headers.get("x-cron-secret") === cron;
  const now = new Date();

  let year: number, month: number, people: any[];
  if (isCron) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); // last month
    year = d.getUTCFullYear(); month = d.getUTCMonth() + 1;
    const { data, error } = await db.from("profiles").select("id, email, display_name").eq("monthly_email", true).limit(10000);
    if (error) return reply(500, { error: error.message });
    people = data ?? [];
  } else {
    const me = await userFrom(req, db);
    if (!me) return reply(401, { error: "Sign in first." });
    year = now.getUTCFullYear(); month = now.getUTCMonth() + 1; // this month so far
    const hour = now.toISOString().slice(0, 13);
    const { error: dup } = await db.from("email_log").insert({ user_id: me.id, kind: "preview", period: hour });
    if (dup) return reply(429, { error: "You've had a preview in the last hour. Try again later." });
    const { data } = await db.from("profiles").select("id, email, display_name").eq("id", me.id).maybeSingle();
    people = [data ?? { id: me.id, email: me.email, display_name: null }];
  }

  const period = `${year}-${String(month).padStart(2, "0")}`;
  const from = new Date(Date.UTC(year, month - 2, 1)); // include the month before, for the comparison
  const to = new Date(Date.UTC(year, month, 1));
  const result = { period, sent: 0, skipped: 0, failed: [] as string[] };

  for (const p of people) {
    try {
      if (isCron) {
        const { data: done } = await db.from("email_log").select("user_id").eq("user_id", p.id).eq("kind", "monthly").eq("period", period).maybeSingle();
        if (done) { result.skipped++; continue; }
      }
      const brief = composeMonthlyBrief(await flightsFor(db, p.id, from, to), year, month, { name: p.display_name, appUrl });
      if (!brief) {
        result.skipped++;
        if (!isCron) return reply(200, { sent: false, reason: "No completed flights this month yet, so there's nothing to send." });
        continue;
      }
      const err = await sendEmail(p.email, p.display_name, isCron ? brief.subject : `Preview: ${brief.subject}`, brief.html, brief.text);
      if (err) { result.failed.push(err); continue; }
      if (isCron) await db.from("email_log").insert({ user_id: p.id, kind: "monthly", period });
      result.sent++;
    } catch (e) {
      result.failed.push(String((e as Error).message ?? e));
    }
  }
  return reply(result.failed.length && !result.sent ? 502 : 200, isCron ? result : { sent: result.sent > 0, error: result.failed[0] ?? null });
});
