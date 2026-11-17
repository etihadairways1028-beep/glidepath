/**
 * Glidepath AI: Copilot answers for signed-in pilots, run on Cloudflare Workers AI.
 *
 * Free by design: Workers AI gives every account 10,000 Neurons a day at no charge.
 * One answer here costs roughly 10-20 Neurons, so the daily caps below keep the whole
 * service well inside that allowance (no bill, on the Free or the Paid plan).
 * Nothing is stored except a per-day count of questions, used for the caps.
 */

export interface AiEnv {
  DB: D1Database;
  AI?: Ai;
}

/** Tried in order: retired or failing models fall through to the next one. */
const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/meta/llama-3.2-3b-instruct"];
export const PER_USER_DAILY = 40;
export const GLOBAL_DAILY = 450;

const SYSTEM_PROMPT = `You are Glidepath Copilot, a calm, expert first officer helping a flight simulator pilot (Microsoft Flight Simulator 2020 or 2024).
Rules:
- For the current flight, answer ONLY from the FLIGHT FACTS provided and general aviation knowledge. Never invent numbers, times, weather, runways, frequencies or ATC instructions.
- If a fact is missing, say it isn't available and what would provide it (e.g. "add your SimBrief name in Settings", "weather needs the Bridge online").
- Be brief: 1-4 short sentences unless asked for a briefing, a checklist or step-by-step help. Use aviation units (ft, kt, nm, fpm, hPa) and UTC times like 1435Z.
- You can explain aviation procedures and technique (approaches, flare, crosswind, fuel planning, SIDs and STARs) the way a good instructor would, for simulation.
- You can also help the pilot use Glidepath, using the GLIDEPATH GUIDE below. Don't make up features that aren't in it.
- This is for flight simulation only, never for real-world navigation. Only mention this if relevant.
- Plain text only, no markdown headings or tables. Reply in the pilot's language.

GLIDEPATH GUIDE
- Glidepath is free. A small Windows app, Glidepath Bridge, reads the flight from the sim through SimConnect (nothing goes in the Community folder). The Glidepath app shows it on an iPad, phone, Mac or PC browser.
- Connecting: sign in to the same Glidepath account on the Bridge page on the PC and in the app; they connect on any network. Without an account, on the same Wi-Fi, type the 6-digit code from the Bridge page. If the iPad can't connect: check both are signed in to the same account, the Bridge is running, and Windows Firewall allowed it.
- Windows "Windows protected your PC" when installing: choose More info, then Run anyway (the installer isn't code-signed).
- Home: the live card (phases, times against the SimBrief plan, runway, top of descent) and shortcuts. Live map: traffic from VATSIM, IVAO and SayIntentions, weather radar, airport maps. Flight: plan details and SID, STAR and approach picking from the sim's own data.
- Remote: autopilot (speed, heading, altitude, vertical speed and modes), lights, engines, and a live camera of the sim. Every button checks the sim really changed; study-level add-ons (PMDG, Fenix, FSLabs) may ignore some buttons.
- After landing, Glidepath asks "Flight complete?". Yes shows the full review: scores for take-off, handling, approach, landing, on-time and fuel, what went well and one thing to work on. Flights save to the Logbook.
- Landing grades use sink rate, g, bounces, bank, pitch, centreline and touchdown distance. Around 60-180 fpm is ideal for airliners.
- Other screens: Charts, Checklists, Pilot tools (calculators), Weather, Airports, Glance mode (big numbers for a tablet on a stand), Career, Landing challenge (monthly), Account (emails, sync).
- Updates: the app and the Bridge show an Update button when a new version is out.
- Problems: Settings › Report a problem.`;

const today = () => new Date().toISOString().slice(0, 10);

interface Msg { role: "user" | "assistant"; content: string }


type Prepared = { messages: Array<{ role: string; content: string }>; used: number };

/** Checks the question and the daily caps, and builds the messages for the model. */
async function prepare(env: AiEnv, userId: string, body: unknown): Promise<Prepared | { status: number; body: Record<string, unknown> }> {
  const b = (body ?? {}) as { messages?: unknown; facts?: unknown };
  const clean: Msg[] = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m): m is Msg => !!m && typeof m === "object" && ((m as Msg).role === "user" || (m as Msg).role === "assistant") && typeof (m as Msg).content === "string" && (m as Msg).content.trim() !== "")
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (!clean.length || clean.at(-1)!.role !== "user") return { status: 400, body: { error: "Send a question." } };
  // Caps: per pilot, and for everyone together, so the service stays inside the free allowance.
  const day = today();
  const [mine, all] = await Promise.all([
    env.DB.prepare("SELECT n FROM ai_usage WHERE day = ? AND user_id = ?").bind(day, userId).first<{ n: number }>(),
    env.DB.prepare("SELECT n FROM ai_usage WHERE day = ? AND user_id = '*'").bind(day).first<{ n: number }>(),
  ]);
  if ((mine?.n ?? 0) >= PER_USER_DAILY) return { status: 429, body: { error: `That's today's ${PER_USER_DAILY} AI questions. They reset at midnight UTC; built-in answers still work.`, left: 0 } };
  if ((all?.n ?? 0) >= GLOBAL_DAILY) return { status: 429, body: { error: "Glidepath AI has reached today's free limit for everyone. It resets at midnight UTC; built-in answers still work.", left: 0 } };
  const facts = JSON.stringify(b.facts ?? {}).slice(0, 6000);
  return { messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\nFLIGHT FACTS (live, JSON; empty if no flight is running):\n${facts}` }, ...clean], used: mine?.n ?? 0 };
}

/** One more question used today (for this pilot and for everyone); old days are cleared. */
async function count(env: AiEnv, userId: string) {
  const day = today();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ai_usage (day, user_id, n) VALUES (?, ?, 1) ON CONFLICT(day, user_id) DO UPDATE SET n = n + 1").bind(day, userId),
    env.DB.prepare("INSERT INTO ai_usage (day, user_id, n) VALUES (?, '*', 1) ON CONFLICT(day, user_id) DO UPDATE SET n = n + 1").bind(day),
    env.DB.prepare("DELETE FROM ai_usage WHERE day < ?").bind(new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)),
  ]);
}

/** How many questions this pilot has left today. */
export async function aiLeft(env: AiEnv, userId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT n FROM ai_usage WHERE day = ? AND user_id = ?").bind(today(), userId).first<{ n: number }>();
  return Math.max(0, PER_USER_DAILY - (r?.n ?? 0));
}

export async function aiChat(env: AiEnv, userId: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.AI) return { status: 503, body: { error: "Glidepath AI isn't switched on yet." } };
  const pre = await prepare(env, userId, body);
  if ("status" in pre) return pre;
  const messages = pre.messages;
  const mine = { n: pre.used };

  let answer = "";
  let used = "";
  for (const model of MODELS) {
    try {
      const out = (await env.AI.run(model as Parameters<Ai["run"]>[0], { messages, max_tokens: 420, temperature: 0.3 } as never)) as unknown;
      answer = pickText(out);
      if (answer) { used = model; break; }
    } catch (e) {
      console.warn(`AI model ${model} failed: ${(e as Error).message}`);
    }
  }
  if (!answer) return { status: 502, body: { error: "Glidepath AI didn't answer just now. Try again in a moment." } };

  await count(env, userId);
  return { status: 200, body: { answer, model: used, left: Math.max(0, PER_USER_DAILY - (mine?.n ?? 0) - 1) } };
}

/** Workers AI models answer in a few shapes; take the text and drop any hidden reasoning. */
function pickText(out: unknown): string {
  const o = out as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }>; output_text?: unknown };
  let t = typeof o?.response === "string" ? o.response
    : typeof o?.choices?.[0]?.message?.content === "string" ? (o.choices[0]!.message!.content as string)
    : typeof o?.output_text === "string" ? o.output_text
    : "";
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^<think>[\s\S]*$/i, "").trim();
  return t.slice(0, 4000);
}

/** One piece of streamed text from a Workers AI SSE line (both the classic and the chat-completions shape). */
export function pieceOf(line: string): string | null | "done" {
  const l = line.trim();
  if (!l.startsWith("data:")) return null;
  const payload = l.slice(5).trim();
  if (payload === "[DONE]") return "done";
  try {
    const j = JSON.parse(payload) as { response?: unknown; choices?: Array<{ delta?: { content?: unknown }; text?: unknown }> };
    if (typeof j.response === "string") return j.response;
    const d = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text;
    return typeof d === "string" ? d : null;
  } catch { return null; }
}

/** Drops <think>…</think> reasoning from a stream of pieces, even when the tags are split across pieces. */
export function thinkFilter() {
  let buf = "", inside = false;
  return (piece: string, end = false): string => {
    buf += piece;
    let out = "";
    for (;;) {
      if (inside) {
        const c = buf.indexOf("</think>");
        if (c < 0) { buf = buf.slice(-8); if (end) buf = ""; return out; }
        buf = buf.slice(c + 8); inside = false;
      } else {
        const o = buf.indexOf("<think>");
        if (o >= 0) { out += buf.slice(0, o); buf = buf.slice(o + 7); inside = true; continue; }
        // Keep a possible partial "<think" at the end until the next piece.
        const keep = end ? 0 : Math.min(buf.length, (() => { for (let k = 6; k > 0; k--) if ("<think>".startsWith(buf.slice(-k))) return k; return 0; })());
        out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep);
        return out;
      }
    }
  };
}

/**
 * Streamed answer, as server-sent events the app already understands: data: {"t":"…"} … data: [DONE].
 * Waits for the first words before answering, so a model that fails or says nothing falls through to the next one.
 */
export async function aiChatStream(env: AiEnv, userId: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> } | { stream: ReadableStream<Uint8Array>; left: number }> {
  if (!env.AI) return { status: 503, body: { error: "Glidepath AI isn't switched on yet." } };
  const pre = await prepare(env, userId, body);
  if ("status" in pre) return pre;
  const enc = new TextEncoder(), dec = new TextDecoder();
  for (const model of MODELS) {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      const s = (await env.AI.run(model as Parameters<Ai["run"]>[0], { messages: pre.messages, max_tokens: 420, temperature: 0.3, stream: true } as never)) as unknown as ReadableStream<Uint8Array>;
      reader = s.getReader();
    } catch (e) { console.warn(`AI model ${model} failed: ${(e as Error).message}`); continue; }
    const filter = thinkFilter();
    let buf = "", first = "", finished = false;
    // Read until there's real text (or the model gives up).
    const deadline = Date.now() + 25_000;
    try {
      while (!first && !finished && Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) { finished = true; break; }
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const p = pieceOf(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          if (p === "done") { finished = true; break; }
          if (p) first += filter(p);
        }
      }
    } catch (e) { console.warn(`AI model ${model} stream failed: ${(e as Error).message}`); first = ""; }
    if (!first.trim()) { try { await reader.cancel(); } catch { /* already closed */ } continue; }

    await count(env, userId);
    const left = Math.max(0, PER_USER_DAILY - pre.used - 1);
    const send = (c: ReadableStreamDefaultController<Uint8Array>, t: string) => { if (t) c.enqueue(enc.encode(`data: ${JSON.stringify({ t })}\n\n`)); };
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        send(c, first.replace(/^\s+/, ""));
        try {
          while (!finished) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const p = pieceOf(buf.slice(0, nl)); buf = buf.slice(nl + 1);
              if (p === "done") { finished = true; break; }
              if (p) send(c, filter(p));
            }
          }
          send(c, filter("", true));
        } catch (e) { console.warn(`AI stream cut off: ${(e as Error).message}`); }
        c.enqueue(enc.encode(`data: ${JSON.stringify({ left, model })}\n\ndata: [DONE]\n\n`));
        c.close();
      },
      cancel() { void reader.cancel().catch(() => undefined); },
    });
    return { stream, left };
  }
  return { status: 502, body: { error: "Glidepath AI didn't answer just now. Try again in a moment." } };
}

/**
 * Diagnostic for the deploy check only: the raw start of one model's stream for a fixed prompt.
 * Works only while the workflow has set a one-off PROBE_KEY (it deletes it straight after).
 */
export async function aiProbe(env: AiEnv & { PROBE_KEY?: string }, key: string | null, model: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.AI || !env.PROBE_KEY || env.PROBE_KEY.length < 32 || key !== env.PROBE_KEY) return { status: 404, body: { error: "Not found." } };
  if (!MODELS.includes(model)) return { status: 400, body: { error: "Unknown model." } };
  const t0 = Date.now();
  try {
    const s = (await env.AI.run(model as Parameters<Ai["run"]>[0], { messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Say hello in five words." }], max_tokens: 160, stream: true, ...pick(extra) } as never)) as unknown as ReadableStream<Uint8Array>;
    const r = s.getReader(); const dec = new TextDecoder(); let raw = ""; let firstAt: number | null = null; let contentAt: number | null = null; let text = "";
    while (Date.now() - t0 < 40_000) { const { done, value } = await r.read(); if (done) break; firstAt ??= Date.now() - t0; const chunk = dec.decode(value, { stream: true }); if (raw.length < 1200) raw += chunk;
      for (const line of chunk.split("\n")) { const p = pieceOf(line); if (typeof p === "string" && p && p !== "done") { contentAt ??= Date.now() - t0; text += p; } } }
    void r.cancel().catch(() => undefined);
    return { status: 200, body: { model, extra: pick(extra), firstChunkMs: firstAt, firstContentMs: contentAt, totalMs: Date.now() - t0, text: text.slice(0, 300), raw: raw.slice(0, 1200) } };
    while (raw.length < 2500 && Date.now() - t0 < 40_000) { const { done, value } = await r.read(); if (done) break; firstAt ??= Date.now() - t0; raw += dec.decode(value, { stream: true }); }
    void r.cancel().catch(() => undefined);
    return { status: 200, body: { model, firstChunkMs: firstAt, totalMs: Date.now() - t0, raw: raw.slice(0, 2500) } };
  } catch (e) { return { status: 200, body: { model, error: (e as Error).message, totalMs: Date.now() - t0 } }; }
}

/** Only the switches being tried for turning off a model's thinking. */
function pick(x: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const k of ["chat_template_kwargs", "reasoning_effort", "reasoning", "enable_thinking"]) if (k in x) o[k] = x[k];
  return o;
}
