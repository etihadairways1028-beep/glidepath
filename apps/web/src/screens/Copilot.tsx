/**
 * Copilot: a first officer that watches the flight with you.
 *  - Built-in (no AI needed): alerts, quick answers and spoken callouts,
 *    all computed from live data.
 *  - Glidepath AI for any question, free for signed-in pilots (Cloudflare Workers AI
 *    through the account service, capped to the free daily allowance).
 *  - Or your own model through the Bridge (Ollama on your PC, or your own key), which
 *    takes priority when it is set up. All grounded in the same live facts.
 */
import { useEffect, useRef, useState } from "react";
import { copilotAnswer, QUICK_QUESTIONS, type QuickQuestion } from "@glidepath/flight-engine";
import { Icon, Notice, Section } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { factsFor, speakTest, useCopilot } from "../data/copilot";
import { settingsStore, useApp, useSettings } from "../data/store";
import { askGlidepathAi, glidepathAiStatus, useCloud } from "../data/cloud";

interface Msg { role: "user" | "assistant"; content: string; by: "copilot" | "ai" | "error"; /** What the AI gets, when it differs from the shown text. */ send?: string }
interface AiStatus { configured: boolean; provider: "ollama" | "openai" | null; baseUrl: string | null; model: string | null; hasKey: boolean; reachable: boolean | null; models: string[]; message: string | null }

const PRESETS = [
  { id: "ollama", label: "Ollama on this PC", note: "Free and private. Install from ollama.com, then run: ollama pull llama3.2", provider: "ollama" as const, baseUrl: "http://127.0.0.1:11434", needsKey: false },
  { id: "gemini", label: "Google Gemini", note: "Free tier with your own key from Google AI Studio.", provider: "openai" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  { id: "groq", label: "Groq", note: "Free tier with your own key from console.groq.com.", provider: "openai" as const, baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "openrouter", label: "OpenRouter", note: "Many models, some free, with your own key.", provider: "openai" as const, baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "custom", label: "Other", note: "Any OpenAI-compatible endpoint (LM Studio, vLLM…).", provider: "openai" as const, baseUrl: "", needsKey: false },
];

/** One-tap questions for the AI: about the flight in progress, or about Glidepath itself. */
const AI_FLIGHT_PROMPTS = ["Brief my arrival", "What should I do next?", "How do I fly a smooth landing here?"];
const AI_HELP_PROMPTS = ["How do I connect my iPad?", "How is my landing graded?", "What can Remote do?"];

function guessQuestion(q: string): QuickQuestion {
  const t = q.toLowerCase();
  if (/descen|tod|top of|start down/.test(t)) return "descent";
  if (/fuel|burn|reserve/.test(t)) return "fuel";
  if (/runway|rwy|land on/.test(t)) return "runway";
  if (/weather|metar|wind|vis|cloud|qnh|temperature/.test(t)) return "weather";
  if (/landing|touchdown|butter|grade/.test(t)) return "landing";
  if (/eta|arriv|on time|late|early|when.*(land|gate)|how long/.test(t)) return "arrival";
  return "status";
}

export function CopilotScreen() {
  const { snapshot, alerts, live } = useCopilot();
  const mode = useApp((s) => s.mode);
  const s = useSettings();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const bridge = mode === "bridge" ? activeBridge() : null;

  useEffect(() => {
    if (!bridge) { setAi(null); return; }
    bridge.get<AiStatus>("/api/ai/status").then(setAi).catch(() => setAi(null));
  }, [mode]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  useEffect(() => {
    if (msgs.length === 0 && live.flight) setMsgs([{ role: "assistant", content: copilotAnswer("status", snapshot), by: "copilot" }]);
  }, [live.flight?.id]);

  const ownAi = !!(bridge && ai?.configured && ai.reachable);
  // Glidepath AI: free for signed-in pilots.
  const cloud = useCloud();
  const signed = !!(cloud.active && cloud.accounts.some((a) => a.slot === cloud.active));
  const [gpLeft, setGpLeft] = useState<number | null>(null);
  const [gpOff, setGpOff] = useState(false);
  useEffect(() => {
    if (!signed) { setGpLeft(null); return; }
    glidepathAiStatus().then((st) => { setGpOff(!st.available); setGpLeft(st.left); }).catch(() => setGpOff(false));
  }, [signed, cloud.active]);
  const gpReady = signed && !gpOff && !ownAi;
  const aiReady = ownAi || gpReady;
  const facts = () => (live.flight ? factsFor(snapshot, { aircraft: live.flight?.aircraft?.icaoType ?? live.flight?.aircraft?.title, callsign: live.plan?.callsign ?? live.flight?.callsign, route: live.plan?.route }) : {});

  const ask = async (text: string, quick?: QuickQuestion, send?: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const history: Msg[] = [...msgs, { role: "user" as const, content: q, by: "copilot" as const, ...(send ? { send } : {}) }];
    setMsgs(history);
    if (quick || !aiReady) {
      if (!live.flight && !quick) {
        setMsgs([...history, { role: "assistant", content: signed ? "Glidepath AI isn't available right now. Built-in answers need a flight running." : "Sign in (Account, it's free) and Glidepath AI can answer anything: how to use Glidepath, procedures, technique. Built-in answers need a flight running.", by: "copilot" }]);
        return;
      }
      const answer = copilotAnswer(quick ?? guessQuestion(q), snapshot);
      setMsgs([...history, { role: "assistant", content: answer, by: "copilot" }]);
      return;
    }
    setBusy(true);
    let acc = "";
    setMsgs([...history, { role: "assistant", content: "", by: "ai" }]);
    const convo = history.filter((m) => m.by !== "error").map((m) => ({ role: m.role, content: m.send ?? m.content }));
    if (gpReady) {
      try {
        const r = await askGlidepathAi(convo, facts());
        setGpLeft(r.left);
        setMsgs([...history, { role: "assistant", content: r.answer, by: "ai" }]);
      } catch (e) {
        const fallback = live.flight ? ` Here's what I can tell from the data: ${copilotAnswer(guessQuestion(q), snapshot)}` : "";
        setMsgs([...history, { role: "assistant", content: `${(e as Error).message}${fallback}`, by: "error" }]);
      } finally { setBusy(false); }
      return;
    }
    try {
      await bridge!.stream("/api/ai/chat", {
        messages: convo,
        facts: facts(),
      }, (t) => { acc += t; setMsgs([...history, { role: "assistant", content: acc, by: "ai" }]); });
      if (!acc) setMsgs([...history, { role: "assistant", content: "The model returned an empty answer.", by: "error" }]);
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: `${(e as Error).message} Here's what I can tell from the data: ${copilotAnswer(guessQuestion(q), snapshot)}`, by: "error" }]);
    } finally {
      setBusy(false);
    }
  };

  // A question handed over from elsewhere (the flight review's "How do I improve?").
  const handed = useRef(false);
  useEffect(() => {
    if (handed.current || (signed && gpLeft === null && !gpOff)) return; // wait until we know which AI answers
    let q: { show: string; send: string } | null = null;
    try { const v = sessionStorage.getItem("glidepath.ask"); sessionStorage.removeItem("glidepath.ask"); if (v) q = JSON.parse(v); } catch { /* private mode or old value */ }
    if (q?.show) { handed.current = true; void ask(q.show, undefined, q.send); }
  }, [signed, gpLeft, gpOff, ai]);

  return (
    <div className="stack">
      <div className="between wrap">
        <div>
          <h1 className="title">Copilot</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Your right seat. Ask it anything about this flight.</p>
        </div>
        <span className={`pill ${aiReady ? "live" : ""}`}><span className="dot" />{ownAi ? `AI: ${ai!.model}` : gpReady ? `Glidepath AI${gpLeft != null ? ` · ${gpLeft} left today` : ""}` : "Built-in copilot"}</span>
      </div>

      <div className="copilot-grid">
        <section className="glass strong chat" aria-label="Conversation">
          <div className="chat-log" role="log" aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-empty">
                                <div className="h2">{live.flight || aiReady ? "What do you need?" : "Nobody to talk about yet"}</div>
                <p className="muted">{live.flight ? "Tap a question or type one." : aiReady ? "Ask about Glidepath, procedures or technique. Start a flight and I'll answer about it too." : "Start a flight, or run the demo from Home."}</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role} ${m.by}`}>
                {m.role === "assistant" && <span className="who">{m.by === "ai" ? "Copilot (AI)" : "Copilot"}</span>}
                <p>{m.content || <span className="typing" aria-label="Thinking"><i /><i /><i /></span>}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="chips" role="group" aria-label="Quick questions">
            {QUICK_QUESTIONS.map((q) => (
              <button key={q.id} className="chip-btn" onClick={() => void ask(q.label, q.id)} disabled={!live.flight}>{q.label}</button>
            ))}
            {aiReady && (live.flight ? AI_FLIGHT_PROMPTS : AI_HELP_PROMPTS).map((t) => (
              <button key={t} className="chip-btn ai" onClick={() => void ask(t)} disabled={busy}><span aria-hidden="true">✦ </span>{t}</button>
            ))}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={aiReady ? (live.flight ? "When do we start down?" : "How do I connect my iPad?") : "Descent, fuel, weather, runway…"} aria-label="Your question" disabled={!live.flight && !aiReady} />
            <button className="btn primary send" type="submit" disabled={busy || !input.trim()} aria-label="Send">{Icon.send()}</button>
          </form>
          {!aiReady && !signed ? <p className="faint" style={{ fontSize: 12, margin: "8px 4px 0" }}>Answers come straight from the sim. <a href="#/account">Sign in</a> (free) and Glidepath AI answers anything, in plain words.</p> : null}
          {gpReady ? <p className="faint" style={{ fontSize: 12, margin: "8px 4px 0" }}>Glidepath AI sees your question and this flight's numbers, not your account. Glidepath doesn't store them. Free: {gpLeft ?? 40} questions a day.</p> : null}
        </section>

        <div className="stack">
          <Section title="Watching" right={<span className="faint" style={{ fontSize: 12.5 }}>{alerts.length ? `${alerts.length} to check` : "Quiet"}</span>}>
            {alerts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{live.flight ? "Nothing to flag." : "Nothing running yet."}</p>
            ) : (
              <div className="alerts">{alerts.map((a) => (
                <div key={a.id} className={`alert ${a.level}`}><b>{a.title}</b><span>{a.detail}</span></div>
              ))}</div>
            )}
          </Section>

          <Section title="Spoken callouts">
            <label className="between" style={{ padding: "2px 0 8px" }}>
              <span>Speak callouts on this device</span>
              <input className="switch" type="checkbox" checked={s.voiceCallouts} onChange={(e) => { settingsStore.set({ voiceCallouts: e.target.checked }); if (e.target.checked) speakTest(); }} />
            </label>
            <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Phase changes, two minutes to descent, and the radio altimeter calls from 2500 down to 10. Your device's voice, nothing leaves it.</p>
          </Section>

          <AiSetup ai={ai} setAi={setAi} bridge={!!bridge} />
        </div>
      </div>
    </div>
  );
}

function AiSetup({ ai, setAi, bridge }: { ai: AiStatus | null; setAi: (s: AiStatus) => void; bridge: boolean }) {
  const initial = PRESETS.find((p) => p.baseUrl && p.baseUrl === ai?.baseUrl) ?? (ai?.provider === "ollama" ? PRESETS[0]! : ai ? PRESETS[4]! : PRESETS[0]!);
  const [preset, setPreset] = useState(initial.id);
  const p = PRESETS.find((x) => x.id === preset)!;
  const [baseUrl, setBaseUrl] = useState(ai?.baseUrl ?? p.baseUrl);
  const [model, setModel] = useState(ai?.model ?? "");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (ai) { setModel(ai.model ?? ""); setBaseUrl(ai.baseUrl ?? p.baseUrl); } }, [ai?.model, ai?.baseUrl]);

  if (!bridge) {
    return (
      <Section title="Your own AI model (optional)">
        <p className="muted" style={{ margin: 0 }}>Signed in, Copilot already uses Glidepath AI for free. Prefer your own? Plug a model into your Bridge: Ollama on your PC (free, stays on your PC) or your own Gemini or Groq key. Connect the Bridge first.</p>
      </Section>
    );
  }
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const b = activeBridge()!;
      const st = await b.post<AiStatus>("/api/ai/config", { provider: p.provider, baseUrl: p.id === "custom" ? baseUrl : p.baseUrl, model, apiKey: key || undefined });
      setAi(st); setKey("");
      if (st.reachable === false) setErr(st.message ?? "Couldn't reach the model.");
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
  return (
    <Section title="Your own AI model (optional)" right={ai?.reachable ? <span className="pill live"><span className="dot" />Connected</span> : ai?.reachable === false ? <span className="pill bad"><span className="dot" />Not reachable</span> : undefined}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="seg wrap-seg">{PRESETS.map((x) => <button key={x.id} className={preset === x.id ? "on" : ""} onClick={() => { setPreset(x.id); setBaseUrl(x.baseUrl); }}>{x.label}</button>)}</div>
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>{p.note}</p>
        {p.id === "custom" && <div className="field"><label htmlFor="ai-url">Address</label><input id="ai-url" className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:1234/v1" /></div>}
        <div className="field">
          <label htmlFor="ai-model">Model</label>
          {ai?.models.length ? (
            <select id="ai-model" className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Choose a model</option>
              {ai.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : <input id="ai-model" className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.id === "ollama" ? "llama3.2" : "model name from your provider"} />}
        </div>
        {(p.needsKey || p.id === "custom") && (
          <div className="field">
            <label htmlFor="ai-key">API key</label>
            <input id="ai-key" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={ai?.hasKey ? "Saved on your PC. Leave blank to keep it." : "Paste your key"} />
          </div>
        )}
        <div className="row"><button className="btn primary" onClick={() => void save()} disabled={saving || !model}>{saving ? "Checking…" : "Save and test"}</button></div>
        {err ? <Notice>{err}</Notice> : ai?.message ? <Notice info>{ai.message}</Notice> : null}
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>Your key is stored only on your simulator PC and is never sent back to this app. The model sees this flight's data, not your account.</p>
      </div>
    </Section>
  );
}
