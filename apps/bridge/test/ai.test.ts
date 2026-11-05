import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { AiService } from "../src/ai.js";

const log = { debug() {}, info() {}, warn() {}, error() {}, child() { return log; }, recent: () => [] } as never;
let provider: Server, bridge: Server, providerUrl = "", bridgeUrl = "";
let lastRequest: { auth?: string; body?: any } = {};
const ai = new AiService(mkdtempSync(join(tmpdir(), "gp-ai-")), log);

beforeAll(async () => {
  provider = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.url === "/v1/models") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "test-model" }] })); return; }
      lastRequest = { auth: req.headers.authorization, body: JSON.parse(b) };
      if (lastRequest.body.model !== "test-model") { res.writeHead(404); res.end("no such model"); return; }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const t of ["Top of descent ", "in 12 min."]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  }).listen(0);
  bridge = createServer(async (req, res) => {
    try { await ai.chat([{ role: "user", content: "When do I descend?" }], { phase: "CRUISE", todMin: 12 }, res); }
    catch (e) { res.writeHead((e as { status?: number }).status ?? 500); res.end((e as Error).message); }
  }).listen(0);
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  bridgeUrl = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
});
afterAll(() => { provider.close(); bridge.close(); });

describe("AI copilot connection", () => {
  it("needs a model before answering", async () => {
    ai.setConfig({ provider: "openai", baseUrl: providerUrl, model: "", apiKey: "sk-test" });
    const r = await fetch(bridgeUrl);
    expect(r.status).toBe(409);
  });
  it("lists models and never exposes the key", async () => {
    ai.setConfig({ model: "test-model" });
    const s = await ai.status();
    expect(s.reachable).toBe(true);
    expect(s.models).toEqual(["test-model"]);
    expect(s.hasKey).toBe(true);
    expect(JSON.stringify(s)).not.toContain("sk-test");
  });
  it("streams the answer and grounds the model in the flight facts", async () => {
    const r = await fetch(bridgeUrl);
    const text = await r.text();
    const out = text.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)).t).join("");
    expect(out).toBe("Top of descent in 12 min.");
    expect(text).toContain("data: [DONE]");
    expect(lastRequest.auth).toBe("Bearer sk-test");
    expect(lastRequest.body.messages[0].role).toBe("system");
    expect(lastRequest.body.messages[0].content).toContain('"todMin":12');
    expect(lastRequest.body.messages[0].content).toMatch(/Never invent numbers/);
  });
  it("explains a wrong model name", async () => {
    ai.setConfig({ model: "nope" });
    const r = await fetch(bridgeUrl);
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/wasn't found/);
  });
  it("rejects a bad address", () => expect(() => ai.setConfig({ baseUrl: "ftp://x" })).toThrow(/http/));
});
