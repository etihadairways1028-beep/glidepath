/**
 * End-of-flight debrief, plus the live takeoff and handling cards.
 * Everything shown is computed from the recorded flight by the engine.
 */
import { useEffect, useMemo, useState } from "react";
import type { FlightStats, FlightSummary, TakeoffReport } from "@glidepath/protocol";
import { buildDebrief, type Debrief as DebriefT, type Rating } from "@glidepath/flight-engine";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { Grade, Icon, Kv, Section } from "./ui";

const RATING: Record<Rating, string> = { good: "Good", ok: "Fine", improve: "Work on" };

function Mark({ level }: { level: Rating }) {
  return <span className={`dmark ${level}`} aria-label={RATING[level]}>{level === "good" ? "✓" : level === "ok" ? "–" : "!"}</span>;
}

export function DebriefPanel({ flight }: { flight: FlightSummary }) {
  const d = useMemo(() => buildDebrief({ ...flight, takeoff: flight.takeoff ?? null, stats: flight.stats ?? null }), [flight]);
  if (d.sections.length === 0) return null;
  return (
    <section className="glass strong debrief" aria-label="Debrief">
      <div className="debrief-top">
        <div>
          <p className="eyebrow">Debrief</p>
          <h2 className="debrief-h">{d.headline}</h2>
          <p className="debrief-sum">{d.summary}</p>
        </div>
        <div className="row" style={{ gap: 8, alignSelf: "flex-start" }}>
          {flight.takeoff && <span className="dgrade"><span>Takeoff</span><Grade grade={flight.takeoff.grade} /></span>}
          {flight.landings.at(-1) && <span className="dgrade"><span>Landing</span><Grade grade={flight.landings.at(-1)!.grade} /></span>}
        </div>
      </div>

      {(d.wentWell.length > 0 || d.toImprove.length > 0) && (
        <div className="debrief-cols">
          {d.wentWell.length > 0 && (
            <div>
              <h3 className="dcol-h good">Went well</h3>
              <ul className="dlist">{d.wentWell.map((t, i) => <li key={i}><Mark level="good" />{t}</li>)}</ul>
            </div>
          )}
          {d.toImprove.length > 0 && (
            <div>
              <h3 className="dcol-h improve">For next time</h3>
              <ul className="dlist">{d.toImprove.map((t, i) => <li key={i}><Mark level="improve" />{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="debrief-sections">
        {d.sections.map((s) => (
          <details key={s.id} className={`dsec ${s.rating}`}>
            <summary>
              <span className={`dot-r ${s.rating}`} />
              <span className="dsec-t">{s.title}</span>
              <span className="dsec-h">{s.headline}</span>
            </summary>
            <div className="dsec-body">
              {s.notes.length > 0 && <ul className="dlist">{s.notes.map((n, i) => <li key={i}><Mark level={n.level} />{n.text}</li>)}</ul>}
              {s.facts.length > 0 && <div className="dfacts">{s.facts.map((f) => <Kv key={f.k} k={f.k} v={f.v} />)}</div>}
            </div>
          </details>
        ))}
      </div>

      <DebriefActions d={d} flight={flight} />
    </section>
  );
}

interface AiStatus { configured: boolean; reachable: boolean | null; model: string | null }

function DebriefActions({ d, flight }: { d: DebriefT; flight: FlightSummary }) {
  const mode = useApp((s) => s.mode);
  const bridge = mode === "bridge" ? activeBridge() : null;
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!bridge) { setAi(null); return; }
    bridge.get<AiStatus>("/api/ai/status").then(setAi).catch(() => setAi(null));
  }, [mode]);
  const aiReady = !!(bridge && ai?.configured && ai.reachable);

  const speak = () => {
    const words = [d.headline, d.summary, ...(d.toImprove.length ? ["For next time.", ...d.toImprove.slice(0, 3)] : [])].join(" ");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text || words));
  };

  const talk = async () => {
    if (!bridge || busy) return;
    setBusy(true); setErr(null); setText("");
    let acc = "";
    try {
      await bridge.stream("/api/ai/chat", {
        messages: [{ role: "user", content: "Debrief this flight the way a training captain would after shutdown: two short paragraphs, plain spoken English, no lists. Say what went well, then the one or two things that matter most for next time and exactly how to fix them. Use only the facts given." }],
        facts: {
          aircraft: flight.aircraft?.icaoType ?? flight.aircraft?.title ?? null,
          route: `${flight.departureIcao ?? "?"} to ${flight.arrivalIcao ?? "?"}`,
          debrief: { headline: d.headline, summary: d.summary, sections: d.sections.map((s) => ({ title: s.title, headline: s.headline, notes: s.notes, facts: s.facts })) },
        },
      }, (t) => { acc += t; setText(acc); });
      if (!acc) setErr("The model returned an empty answer.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="debrief-actions">
      {text && <div className="ai-brief"><span className="who">Captain's debrief ({ai?.model})</span><p>{text}</p></div>}
      {err && <p className="faint" style={{ fontSize: 12.5 }}>{err}</p>}
      <div className="row wrap" style={{ gap: 8 }}>
        {aiReady && <button className="btn primary" onClick={() => void talk()} disabled={busy}>{busy ? "Thinking…" : text ? "Ask again" : "Talk me through it"}</button>}
        {canSpeak && <button className="btn" onClick={speak}>{Icon.speaker()} Read it out</button>}
        {!aiReady && <span className="faint" style={{ fontSize: 12.5 }}>Connect an AI model in Copilot and it can talk you through this flight in its own words.</span>}
      </div>
    </div>
  );
}

/** Live: shows as soon as the takeoff has been measured (about 1,500 ft up). */
export function TakeoffCard({ t, runway }: { t: TakeoffReport; runway: string | null }) {
  return (
    <Section title="Takeoff" right={<Grade grade={t.grade} />}>
      <p className="h3" style={{ margin: "0 0 10px" }}>{t.verdict}</p>
      <Kv k="Rotation" v={t.rotationRateDegS === null ? "—" : `${t.rotationRateDegS}°/s${t.rotateIasKt !== null ? ` from ${t.rotateIasKt} kt` : ""}`} />
      <Kv k="Lift-off" v={[t.liftoffIasKt !== null ? `${t.liftoffIasKt} kt` : null, t.liftoffPitchDeg !== null ? `${t.liftoffPitchDeg}°` : null].filter(Boolean).join(", ") || "—"} />
      <Kv k="Climb pitch" v={t.maxPitchDeg === null ? "—" : `${t.maxPitchDeg}° max`} />
      <Kv k="Initial climb" v={t.initialClimbFpm === null ? "—" : `${t.initialClimbFpm.toLocaleString("en-US")} fpm`} />
      <Kv k="Ground roll" v={t.groundRollFt === null ? "—" : `${t.groundRollFt.toLocaleString("en-US")} ft${runway ? ` on ${runway}` : ""}`} />
      {t.gearUpS !== null && <Kv k="Gear up" v={`${Math.round(t.gearUpS)} s after lift-off`} />}
      <ul className="dlist" style={{ marginTop: 12 }}>{t.notes.filter((n) => n.level !== "good").map((n, i) => <li key={i}><Mark level={n.level} />{n.text}</li>)}</ul>
    </Section>
  );
}

/** Live handling numbers for the flight so far. */
export function HandlingCard({ s }: { s: FlightStats }) {
  const g = s.gate1000;
  return (
    <Section title="Handling so far">
      <Kv k="Fastest below 10,000 ft" v={s.maxIasBelow10kKt === null ? "—" : <>{s.maxIasBelow10kKt} kt{s.overspeedBelow10kS > 3 ? <span className="est"> over 250</span> : null}</>} />
      <Kv k="Steepest bank" v={s.maxBankDeg === null ? "—" : `${s.maxBankDeg}°`} />
      <Kv k="Load" v={s.maxG === null ? "—" : s.minG !== null && s.maxG - s.minG < 0.15 ? `steady, ${s.maxG.toFixed(1)} g` : `${s.minG} to ${s.maxG} g`} />
      <Kv k="Average climb" v={s.climbAvgFpm === null ? "after top of climb" : `${s.climbAvgFpm.toLocaleString("en-US")} fpm`} />
      <Kv k="Steepest descent" v={s.maxDescentFpm === null ? "—" : `${s.maxDescentFpm.toLocaleString("en-US")} fpm`} />
      <Kv k="At 1,000 ft" v={g ? [g.iasKt !== null ? `${g.iasKt} kt` : null, g.vsFpm !== null ? `${Math.abs(g.vsFpm).toLocaleString("en-US")} fpm ${g.vsFpm < 0 ? "down" : "up"}` : null, g.gearDown === null ? null : g.gearDown ? "gear down" : "gear UP"].filter(Boolean).join(", ") : "on approach"} />
      <Kv k="Fastest taxi" v={s.maxTaxiKt === null ? "—" : `${s.maxTaxiKt} kt`} />
    </Section>
  );
}
