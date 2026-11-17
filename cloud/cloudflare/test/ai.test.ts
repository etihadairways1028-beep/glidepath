import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { aiChat, aiChatStream, aiLeft, GLOBAL_DAILY, PER_USER_DAILY, pieceOf, thinkFilter } from "../src/ai";

/** Just enough of D1 on top of a real SQLite database, with the real schema. */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (db.prepare(sql).get(...(args as never[])) ?? null),
    run: async () => { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { raw: db, prepare: (sql: string) => stmt(sql), batch: async (list: Array<{ run: () => Promise<unknown> }>) => { for (const s of list) await s.run(); return []; } };
}
const ask = (q: string) => ({ messages: [{ role: "user", content: q }], facts: { phase: "CRUISE" } });

describe("Glidepath AI", () => {
  it("answers, counts the question, and strips hidden reasoning", async () => {
    const DB = fakeD1();
    let seen: { messages: Array<{ role: string; content: string }> } | null = null;
    const AI = { run: async (_m: string, input: never) => { seen = input; return { response: "<think>hmm</think>Start down in about 12 minutes." }; } };
    const r = await aiChat({ DB: DB as never, AI: AI as never }, "u1", ask("When do I start down?"));
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe("Start down in about 12 minutes.");
    expect(r.body.left).toBe(PER_USER_DAILY - 1);
    expect(seen!.messages[0]!.role).toBe("system");
    expect(seen!.messages[0]!.content).toContain('"phase":"CRUISE"');
    expect(await aiLeft({ DB: DB as never }, "u1")).toBe(PER_USER_DAILY - 1);
  });
  it("falls back to the next model when one fails, and reads the chat-completions shape", async () => {
    const DB = fakeD1(); const tried: string[] = [];
    const AI = { run: async (m: string) => { tried.push(m); if (tried.length === 1) throw new Error("model retired"); return { choices: [{ message: { content: "Runway 23R." } }] }; } };
    const r = await aiChat({ DB: DB as never, AI: AI as never }, "u1", ask("Which runway?"));
    expect(r.status).toBe(200); expect(r.body.answer).toBe("Runway 23R."); expect(tried.length).toBe(2);
  });
  it("stops at the per-pilot cap and the everyone cap, without calling the model", async () => {
    const DB = fakeD1(); let calls = 0;
    const AI = { run: async () => { calls++; return { response: "ok" }; } };
    const day = new Date().toISOString().slice(0, 10);
    DB.raw.prepare("INSERT INTO ai_usage (day, user_id, n) VALUES (?, ?, ?)").run(day, "u1", PER_USER_DAILY);
    expect((await aiChat({ DB: DB as never, AI: AI as never }, "u1", ask("hi"))).status).toBe(429);
    DB.raw.prepare("INSERT INTO ai_usage (day, user_id, n) VALUES (?, '*', ?)").run(day, GLOBAL_DAILY);
    const r = await aiChat({ DB: DB as never, AI: AI as never }, "u2", ask("hi"));
    expect(r.status).toBe(429); expect(String(r.body.error)).toContain("everyone"); expect(calls).toBe(0);
  });
  it("refuses empty questions and reports when AI isn't bound", async () => {
    const DB = fakeD1();
    expect((await aiChat({ DB: DB as never, AI: { run: async () => ({ response: "x" }) } as never }, "u1", { messages: [] })).status).toBe(400);
    expect((await aiChat({ DB: DB as never }, "u1", ask("hi"))).status).toBe(503);
  });
  it("gives a clear error when every model fails, and doesn't count it", async () => {
    const DB = fakeD1();
    const r = await aiChat({ DB: DB as never, AI: { run: async () => { throw new Error("down"); } } as never }, "u1", ask("hi"));
    expect(r.status).toBe(502); expect(await aiLeft({ DB: DB as never }, "u1")).toBe(PER_USER_DAILY);
  });
});

/** A Workers AI-style SSE stream from the given lines, split awkwardly across chunks like a real network. */
function sse(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => `${l}\n\n`).join("");
  const enc = new TextEncoder();
  const parts: string[] = []; for (let i = 0; i < text.length; i += 7) parts.push(text.slice(i, i + 7));
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
}
async function readAll(s: ReadableStream<Uint8Array>) {
  const r = s.getReader(); const dec = new TextDecoder(); let out = "";
  for (;;) { const { done, value } = await r.read(); if (done) break; out += dec.decode(value); }
  const events = out.split("\n\n").filter(Boolean).map((e) => e.replace(/^data: /, ""));
  const text = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e) as { t?: string; left?: number }).map((j) => j.t ?? "").join("");
  return { text, raw: out };
}

describe("Glidepath AI streaming", () => {
  it("reads both the classic and the chat-completions chunk shapes", () => {
    expect(pieceOf('data: {"response":"Hi"}')).toBe("Hi");
    expect(pieceOf('data: {"choices":[{"delta":{"content":" there"}}]}')).toBe(" there");
    expect(pieceOf("data: [DONE]")).toBe("done");
    expect(pieceOf(": keep-alive")).toBeNull();
  });
  it("drops reasoning even when the tags are split across pieces", () => {
    const f = thinkFilter();
    const out = ["Ok", "ay <th", "ink>secret plan</th", "ink> Start down", " now."].map((p) => f(p)).join("") + f("", true);
    expect(out).toBe("Okay  Start down now.");
  });
  it("streams the answer, ends with [DONE], and counts one question", async () => {
    const DB = fakeD1();
    const AI = { run: async () => sse(['data: {"response":"Start "}', 'data: {"response":"down in "}', 'data: {"response":"12 minutes."}', "data: [DONE]"]) };
    const r = await aiChatStream({ DB: DB as never, AI: AI as never }, "u1", ask("When do I start down?"));
    expect("stream" in r).toBe(true);
    const { text, raw } = await readAll((r as { stream: ReadableStream<Uint8Array> }).stream);
    expect(text).toBe("Start down in 12 minutes.");
    expect(raw.trim().endsWith("data: [DONE]")).toBe(true);
    expect(await aiLeft({ DB: DB as never }, "u1")).toBe(PER_USER_DAILY - 1);
  });
  it("falls through to the next model when one streams nothing, without counting it", async () => {
    const DB = fakeD1(); let n = 0;
    const AI = { run: async () => (++n === 1 ? sse(["data: [DONE]"]) : sse(['data: {"choices":[{"delta":{"content":"Runway 23R."}}]}', "data: [DONE]"])) };
    const r = await aiChatStream({ DB: DB as never, AI: AI as never }, "u1", ask("Which runway?"));
    const { text } = await readAll((r as { stream: ReadableStream<Uint8Array> }).stream);
    expect(text).toBe("Runway 23R."); expect(n).toBe(2);
    expect(await aiLeft({ DB: DB as never }, "u1")).toBe(PER_USER_DAILY - 1);
  });
  it("answers with an error, not a stream, when every model fails or the cap is reached", async () => {
    const DB = fakeD1();
    const bad = await aiChatStream({ DB: DB as never, AI: { run: async () => { throw new Error("down"); } } as never }, "u1", ask("hi"));
    expect("status" in bad && bad.status).toBe(502);
    DB.raw.prepare("INSERT INTO ai_usage (day, user_id, n) VALUES (?, ?, ?)").run(new Date().toISOString().slice(0, 10), "u1", PER_USER_DAILY);
    const capped = await aiChatStream({ DB: DB as never, AI: { run: async () => sse(['data: {"response":"x"}']) } as never }, "u1", ask("hi"));
    expect("status" in capped && capped.status).toBe(429);
  });
  it("switches thinking off for the models that think first", async () => {
    const DB = fakeD1(); const seen: Array<{ model: string; input: Record<string, unknown> }> = [];
    const AI = { run: async (model: string, input: Record<string, unknown>) => { seen.push({ model, input }); return sse(['data: {"response":"Hi."}', "data: [DONE]"]); } };
    await aiChatStream({ DB: DB as never, AI: AI as never }, "u1", ask("hi"));
    expect(seen[0]!.model).toContain("gemma");
    expect(seen[0]!.input.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
