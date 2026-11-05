/**
 * Optional AI copilot connection.
 *
 * One client for any OpenAI-compatible chat endpoint: Ollama running on this
 * PC (free, private), or a hosted provider with the user's own key (Google
 * Gemini, Groq, OpenRouter, LM Studio, …). The key is stored only in
 * <dataDir>/ai.json on this PC, is never sent to the app, and never leaves
 * the PC except to the provider the user chose.
 *
 * The model is given the live flight facts the app computed (telemetry,
 * plan, timings, weather, alerts) and told to answer only from them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Logger } from "./log.js";

export interface AiConfig {
  provider: "ollama" | "openai";
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export interface AiStatus {
  configured: boolean;
  provider: AiConfig["provider"] | null;
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
  reachable: boolean | null;
  models: string[];
  message: string | null;
}

export interface ChatMessage { role: "user" | "assistant"; content: string }

const DEFAULT: AiConfig = { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "", apiKey: null };

export const SYSTEM_PROMPT = `You are Glidepath Copilot, a calm, expert first officer helping a flight simulator pilot.
Rules:
- Answer ONLY from the FLIGHT FACTS provided and general aviation knowledge. Never invent numbers, times, weather, runways, frequencies or ATC instructions.
- If a fact is missing, say it is not available and what would provide it (e.g. "link a SimBrief plan", "weather needs the Bridge online").
- Be brief: 1-4 short sentences unless asked for a briefing or checklist. Use aviation units (ft, kt, nm, fpm, hPa) and UTC times like 1435Z.
- This is for flight simulation only, never for real-world navigation. Do not mention this unless relevant.
- Reply in the pilot's language.`;

export class AiService {
  private cfg: AiConfig;
  private readonly file: string;
  private recent: number[] = [];
  private readonly log: Logger;

  constructor(dataDir: string, log: Logger) {
    this.file = join(dataDir, "ai.json");
    this.log = log.child("ai");
    this.cfg = DEFAULT;
    try {
      if (existsSync(this.file)) this.cfg = { ...DEFAULT, ...JSON.parse(readFileSync(this.file, "utf8")) };
    } catch {
      this.log.warn("ai.json is unreadable; using defaults");
    }
  }

  /** Update settings. An empty apiKey keeps the saved one; null clears it. */
  setConfig(patch: Partial<AiConfig>): void {
    const next: AiConfig = { ...this.cfg };
    if (patch.provider === "ollama" || patch.provider === "openai") next.provider = patch.provider;
    if (typeof patch.baseUrl === "string") {
      const u = patch.baseUrl.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error("The address must start with http:// or https://");
      next.baseUrl = u;
    }
    if (typeof patch.model === "string") next.model = patch.model.trim().slice(0, 120);
    if (patch.apiKey === null) next.apiKey = null;
    else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim().slice(0, 400);
    this.cfg = next;
    writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
    this.log.info(`AI settings saved: ${next.provider} at ${next.baseUrl}, model "${next.model || "(none)"}"${next.apiKey ? ", key set" : ""}`);
  }

  async status(): Promise<AiStatus> {
    const c = this.cfg;
    const s: AiStatus = { configured: !!c.model, provider: c.provider, baseUrl: c.baseUrl, model: c.model || null, hasKey: !!c.apiKey, reachable: null, models: [], message: null };
    try {
      if (c.provider === "ollama") {
        const r = await fetch(`${c.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
        const j = (await r.json()) as { models?: Array<{ name: string }> };
        s.reachable = r.ok;
        s.models = (j.models ?? []).map((m) => m.name).slice(0, 50);
        if (!s.models.length) s.message = "Ollama is running but has no models. In a terminal run: ollama pull llama3.2";
      } else {
        const r = await fetch(`${this.v1()}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
        s.reachable = r.ok;
        if (r.ok) {
          const j = (await r.json()) as { data?: Array<{ id: string }> };
          s.models = (j.data ?? []).map((m) => m.id).slice(0, 80);
        } else s.message = r.status === 401 || r.status === 403 ? "The provider rejected the API key." : `The provider answered ${r.status}.`;
      }
    } catch {
      s.reachable = false;
      s.message = c.provider === "ollama" ? "Ollama isn't running on this PC. Install it free from ollama.com, then run: ollama pull llama3.2" : "Couldn't reach the provider. Check the address and your internet connection.";
    }
    return s;
  }

  /** Streams the answer to `res` as server-sent events: data: {"t":"…"} … data: [DONE] */
  async chat(messages: ChatMessage[], facts: unknown, res: ServerResponse): Promise<void> {
    const now = Date.now();
    this.recent = this.recent.filter((t) => t > now - 60_000);
    if (this.recent.length >= 20) throw new HttpError(429, "Too many questions in a minute. Try again shortly.");
    this.recent.push(now);
    if (!this.cfg.model) throw new HttpError(409, "Choose an AI model in Copilot settings first.");

    const clean = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!clean.length || clean.at(-1)!.role !== "user") throw new HttpError(400, "Send a question.");
    const factsText = JSON.stringify(facts ?? {}).slice(0, 14_000);

    const upstream = await fetch(`${this.v1()}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.model,
        stream: true,
        temperature: 0.3,
        max_tokens: 600,
        messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\nFLIGHT FACTS (live, JSON):\n${factsText}` }, ...clean],
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => {
      throw new HttpError(502, this.cfg.provider === "ollama" ? "Ollama isn't running on this PC." : "Couldn't reach the AI provider.");
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      this.log.warn(`AI provider answered ${upstream.status}`, detail.slice(0, 300));
      throw new HttpError(502, upstream.status === 401 || upstream.status === 403 ? "The AI provider rejected the API key." : upstream.status === 404 ? `Model "${this.cfg.model}" wasn't found.` : `The AI provider answered ${upstream.status}.`);
    }

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const t = j.choices?.[0]?.delta?.content;
          if (t) res.write(`data: ${JSON.stringify({ t })}\n\n`);
        } catch {
          /* keep-alive or partial line */
        }
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  }

  private v1(): string {
    const b = this.cfg.baseUrl;
    return this.cfg.provider === "ollama" ? `${b}/v1` : b;
  }
  private headers(): Record<string, string> {
    return this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {};
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
