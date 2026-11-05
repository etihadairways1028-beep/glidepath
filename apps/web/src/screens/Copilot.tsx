/**
 * Copilot: a first officer that watches the flight with you.
 *  - Built-in (no AI needed): alerts, quick answers and spoken callouts,
 *    all computed from live data.
 *  - Optional AI model through the Bridge (Ollama on your PC for free, or your
 *    own key with a hosted provider) for any question, grounded in the same facts.
 */
import { useEffect, useRef, useState } from "react";
import { copilotAnswer, QUICK_QUESTIONS, type QuickQuestion } from "@glidepath/flight-engine";
import { Icon, Notice, Section } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { factsFor, speakTest, useCopilot } from "../data/copilot";
import { settingsStore, useApp, useSettings } from "../data/store";

interface Msg { role: "user" | "assistant"; content: string; by: "copilot" | "ai" | "error" }
interface AiStatus { configured: boolean; provider: "ollama" | "openai" | null; baseUrl: string | null; model: string | null; hasKey: boolean; reachable: boolean | null; models: string[]; message: string | null }

const PRESETS = [
  { id: "ollama", label: "Ollama on this PC", note: "Free and private. Install from ollama.com, then run: ollama pull llama3.2", provider: "ollama" as const, baseUrl: "http://127.0.0.1:11434", needsKey: false },
  { id: "gemini", label: "Google Gemini", note: "Free tier with your own key from Google AI Studio.", provider: "openai" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true },
  { id: "groq", label: "Groq", note: "Free tier with your own key from console.groq.com.", provider: "openai" as const, baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "openrouter", label: "OpenRouter", note: "Many models, some free, with your own key.", provider: "openai" as const, baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "custom", label: "Other", note: "Any OpenAI-compatible endpoint (LM Studio, vLLM…).", provider: "openai" as const, baseUrl: "", needsKey: false },
];

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

  const aiReady = !!(bridge && ai?.configured && ai.reachable);

  const ask = async (text: string, quick?: QuickQuestion) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, content: q, by: "copilot" as const }];
    setMsgs(history);
    if (quick || !aiReady) {
      const answer = copilotAnswer(quick ?? guessQuestion(q), snapshot);
      setMsgs([...history, { role: "assistant", content: answer, by: "copilot" }]);
      return;
    }
    setBusy(true);
    let acc = "";
    setMsgs([...history, { role: "assistant", content: "", by: "ai" }]);
    try {
      await bridge!.stream("/api/ai/chat", {
        messages: history.filter((m) => m.by !== "error").map((m) => ({ role: m.role, content: m.content })),
        facts: factsFor(snapshot, { aircraft: live.flight?.aircraft?.icaoType ?? live.flight?.aircraft?.title, callsign: live.plan?.callsign ?? live.flight?.callsign, route: live.plan?.route }),
      }, (t) => { acc += t; setMsgs([...history, { role: "assistant", content: acc, by: "ai" }]); });
      if (!acc) setMsgs([...history, { role: "assistant", content: "The model returned an empty answer.", by: "error" }]);
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: `${(e as Error).message} Here's what I can tell from the data: ${copilotAnswer(guessQuestion(q), snapshot)}`, by: "error" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="between wrap">
        <div>
          <h1 className="title">Copilot</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Watches your flight, answers from real data, and calls out what matters.</p>
        </div>
        <span className={`pill ${aiReady ? "live" : ""}`}><span className="dot" />{aiReady ? `AI: ${ai!.model}` : "Built-in copilot"}</span>
      </div>

      <div className="copilot-grid">
        <section className="glass strong chat" aria-label="Conversation">
          <div className="chat-log" role="log" aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-empty">
                <div className="chat-orb" aria-hidden="true">{Icon.spark()}</div>
                <div className="h2">{live.flight ? "Ask about your flight" : "No flight yet"}</div>
                <p className="muted">{live.flight ? "Pick a question below or type your own." : "Start your sim with the Bridge running, or watch the demo flight from Home."}</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role} ${m.by}`}>
                {m.role === "assistant" && <span className="who">{m.by === "ai" ? "AI copilot" : m.by === "error" ? "Copilot" : "Copilot"}</span>}
                <p>{m.content || <span className="typing" aria-label="Thinking"><i /><i /><i /></span>}</p>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="chips" role="group" aria-label="Quick questions">
            {QUICK_QUESTIONS.map((q) => (
              <button key={q.id} className="chip-btn" onClick={() => void ask(q.label, q.id)} disabled={!live.flight}>{q.label}</button>
            ))}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={aiReady ? "Ask anything about this flight…" : "Ask about descent, fuel, weather, runway, arrival…"} aria-label="Your question" disabled={!live.flight} />
            <button className="btn primary send" type="submit" disabled={busy || !input.trim()} aria-label="Send">{Icon.send()}</button>
          </form>
          {!aiReady && live.flight ? <p className="faint" style={{ fontSize: 12, margin: "8px 4px 0" }}>The built-in copilot answers the common questions from live data. Connect an AI model on the right for anything else.</p> : null}
        </section>

        <div className="stack">
          <Section title="Right now" right={<span className="faint" style={{ fontSize: 12.5 }}>{alerts.length ? `${alerts.length} to check` : "All clear"}</span>}>
            {alerts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{live.flight ? "Nothing needs your attention. I'll flag sink rate, gear, speed below 10,000 ft, fuel against plan, descent timing, crosswind and low weather." : "Alerts appear once a flight is running."}</p>
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
            <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Phase changes, top of descent in two minutes, and approach heights: 2500, 1000, 500, 100, 50 to 10. Uses your device's own voice; nothing is sent anywhere.</p>
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
      <Section title="AI model (optional)">
        <p className="muted" style={{ margin: 0 }}>Free-form questions use an AI model through your Bridge, so your key never touches a website. Connect the Bridge on your simulator PC to set one up. Options include Ollama on your PC (free, private) or your own Gemini or Groq key (free tiers).</p>
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
    <Section title="AI model (optional)" right={ai?.reachable ? <span className="pill live"><span className="dot" />Connected</span> : ai?.reachable === false ? <span className="pill bad"><span className="dot" />Not reachable</span> : undefined}>
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
