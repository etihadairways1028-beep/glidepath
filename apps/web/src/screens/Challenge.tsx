/** Monthly landing challenge: the best landing of the month for each pilot who joins. */
import { useEffect, useState } from "react";
import { getChallenge, joinChallenge, leaveChallenge, useCloud, type Challenge } from "../data/cloud";
import { Notice } from "../components/ui";

const GRADE_COLOR: Record<string, string> = { "A+": "#64D2FF", A: "#30D158", B: "#34C7A0", C: "#FFD60A", D: "#FF9F0A", F: "#FF453A" };
const monthKey = (offset: number) => { const d = new Date(); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)); return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const daysLeft = () => { const d = new Date(); const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000)); };

export function ChallengeScreen() {
  const c = useCloud();
  const [month, setMonth] = useState(monthKey(0));
  const [data, setData] = useState<Challenge | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => { setErr(null); getChallenge(month).then((d) => { setData(d); setName((n) => n || d.name || c.profile?.display_name || ""); }, (e) => setErr(e.message)); };
  useEffect(() => { if (c.active) load(); else setData(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [c.active, month]);

  const join = async () => { setBusy(true); try { await joinChallenge(name.trim()); load(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const leave = async () => { setBusy(true); try { await leaveChallenge(); load(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  return (
    <div className="stack">
      <div className="between wrap">
        <h1 className="title">Landing challenge</h1>
        <div className="seg" role="group" aria-label="Month">
          {[0, -1].map((o) => { const k = monthKey(o); return <button key={k} className={month === k ? "on" : ""} onClick={() => setMonth(k)}>{o === 0 ? "This month" : "Last month"}</button>; })}
        </div>
      </div>
      <section className="glass strong pad challenge-hero">
        <div>
          <div className="eyebrow">{monthLabel(month)}</div>
          <h2 className="h2" style={{ margin: "6px 0 4px" }}>Who lands it smoothest?</h2>
          <p className="muted" style={{ margin: 0 }}>Your best landing score of the month counts. Fly in MSFS with the Bridge while signed in; landings are scored automatically and synced to your account. Demo flights don't count.{month === monthKey(0) ? ` ${daysLeft()} days left.` : ""}</p>
        </div>
        {data?.you && <div className="your-rank"><span>Your rank</span><b className="data">#{data.you.rank}</b><small>of {data.pilots}</small></div>}
      </section>

      {!c.active ? (
        <Notice info>Sign in to join the challenge and see the leaderboard. It's free. <a href="#/account">Sign in</a></Notice>
      ) : (
        <>
          {err && <Notice>{err}</Notice>}
          <section className="glass pad">
            {data?.joined ? (
              <div className="between wrap" style={{ gap: 10 }}>
                <p style={{ margin: 0 }}>You're in as <b>{data.name}</b>. Your name and best landing are shown to other pilots in the challenge.</p>
                <button className="btn small" disabled={busy} onClick={leave}>Leave challenge</button>
              </div>
            ) : (
              <form className="row wrap" style={{ gap: 10, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); void join(); }}>
                <label className="field" style={{ flex: "1 1 220px", margin: 0 }}><span>Name on the leaderboard</span><input className="input" maxLength={24} minLength={2} value={name} placeholder="e.g. Anisha or ETD1028" onChange={(e) => setName(e.target.value)} /></label>
                <button className="btn primary" disabled={busy}>{busy ? "Joining…" : "Join the challenge"}</button>
                <p className="faint" style={{ flexBasis: "100%", margin: 0, fontSize: 12.5 }}>Only this name, your best landing (score, rate, airport, aircraft) are shown. Never your email. Leave any time.</p>
              </form>
            )}
          </section>
          <section className="glass pad">
            {!data ? <div className="skeleton" style={{ height: 180 }} /> : data.entries.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No landings yet for {monthLabel(month)}. {data.joined ? "Fly one and you'll be first on the board." : "Join and fly to be first on the board."}</p>
            ) : (
              <ol className="board">
                {data.entries.map((e, i) => (
                  <li key={`${e.name}-${i}`} className={e.you ? "you" : ""}>
                    <span className={`pos data${i < 3 ? ` p${i + 1}` : ""}`}>{i + 1}</span>
                    <span className="who"><b>{e.name}{e.you ? " (you)" : ""}</b><small className="muted">{[e.airport, e.aircraft].filter(Boolean).join(" · ")}</small></span>
                    <span className="fpm data">{e.fpm != null ? `${e.fpm} fpm` : "—"}</span>
                    <span className="grade" style={{ background: GRADE_COLOR[e.grade ?? ""] ?? "#8E9AAF" }}>{e.grade ?? "?"}</span>
                    <span className="score data">{e.score}</span>
                  </li>
                ))}
              </ol>
            )}
            {data?.you && data.you.rank > data.entries.length && <p className="muted" style={{ margin: "12px 0 0" }}>You: #{data.you.rank}, score {data.you.score} ({data.you.fpm ?? "—"} fpm).</p>}
          </section>
        </>
      )}
    </div>
  );
}
