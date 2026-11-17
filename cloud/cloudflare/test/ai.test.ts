import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { aiChat, aiLeft, GLOBAL_DAILY, PER_USER_DAILY } from "../src/ai";

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
