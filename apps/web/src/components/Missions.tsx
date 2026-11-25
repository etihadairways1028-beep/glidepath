/**
 * Weekly missions and the flying streak: three new goals every Monday, measured from your logbook.
 * On Home as "This week", in full on the Career screen, and ticked off the moment you land.
 */
import { useMemo } from "react";
import type { FlightSummary } from "@glidepath/protocol";
import { flyingStreak, pilotCareer, weekMissions, type Mission, type MissionIcon } from "@glidepath/flight-engine";
import { useApp } from "../data/store";
import { useFlights } from "../screens/Logbook";

const GLYPH: Record<MissionIcon, string> = {
  plane: "M21 15.5v-1.8l-8-5V4.5a1.5 1.5 0 0 0-3 0v4.2l-8 5v1.8l8-2.4v4.3l-2.2 1.6V21l3.7-1 3.7 1v-2l-2.2-1.6v-4.3z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  feather: "M20 4c-7 0-12 5-13 12l-3 4M7 16h7M9 12h7.5M20 4c0 6-3 11-9 12",
  target: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
};
export const KIND_HUE: Record<Mission["kind"], string> = { fly: "#0A84FF", skill: "#30D158", explore: "#BF5AF2" };
const KIND_WORD: Record<Mission["kind"], string> = { fly: "Fly", skill: "Skill", explore: "Explore" };

/** Your flights, as the missions count them (in the demo, the demo flight stands in as a preview). */
export function useMissions() {
  const { flights } = useFlights();
  const mode = useApp((s) => s.mode);
  const list = useMemo<FlightSummary[]>(() => (mode === "demo" ? (flights ?? []).map((f) => ({ ...f, simulator: { ...f.simulator, source: "live" as const } })) : flights ?? []), [flights, mode]);
  const week = useMemo(() => weekMissions(list), [list]);
  const streak = useMemo(() => flyingStreak(list), [list]);
  const career = useMemo(() => pilotCareer(list), [list]);
  return { ready: flights !== null, demo: mode === "demo", list, week, streak, career };
}

export function MissionIc({ m, size = 44 }: { m: Mission; size?: number }) {
  const r = 19, c = 2 * Math.PI * r, p = Math.min(1, m.have / m.need);
  return (
    <span className={`ms-ic${m.done ? " done" : ""}`} style={{ ["--hue" as string]: KIND_HUE[m.kind], width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 44 44" className="ms-ring"><circle cx="22" cy="22" r={r} className="bg" /><circle cx="22" cy="22" r={r} className="fg" strokeDasharray={`${(c * p).toFixed(1)} ${c.toFixed(1)}`} /></svg>
      <svg viewBox="0 0 24 24" className="ms-glyph" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{m.done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d={GLYPH[m.icon]} />}</svg>
    </span>
  );
}

const Flame = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" className={`ms-flame${on ? " on" : ""}`} aria-hidden="true"><path d="M12 2.5c1 3.2-1.8 4.8-1.8 7.6 0 1.3.8 2.2 1.8 2.2 1.4 0 2-1.2 1.7-3 2.6 1.6 4.3 4.3 4.3 7A6 6 0 0 1 6 16.3c0-4.6 4.2-6.6 6-13.8z" /></svg>
);

const leftText = (ms: number) => { const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000); return d >= 1 ? `${d} day${d > 1 ? "s" : ""} left` : `${h} h left`; };

/** Home: this week's missions, your streak and how close the next rank is. */
export function ThisWeek() {
  const { ready, demo, week, streak, career } = useMissions();
  if (!ready) return null;
  const all = week.doneCount === 3;
  return (
    <a className={`glass ms-card${all ? " all" : ""}`} href="#/career" aria-label="This week's missions">
      <div className="ms-head">
        <div>
          <span className="ms-k">This week{demo ? " · preview" : ""}</span>
          <b className="ms-t">{all ? "All three done. New missions on Monday." : `${week.doneCount} of 3 missions`}</b>
        </div>
        <div className="ms-side">
          <span className={`ms-streak${streak.weeks ? " on" : ""}`} title="Weeks in a row with at least one flight"><Flame on={streak.weeks > 0} /><b className="data">{streak.weeks}</b><small>{streak.weeks === 1 ? "week" : "weeks"}</small></span>
          <span className="ms-left">{leftText(week.msLeft)}</span>
        </div>
      </div>
      <ul className="ms-list">
        {week.missions.map((m) => (
          <li key={m.id} className={m.done ? "done" : ""}>
            <MissionIc m={m} />
            <span className="ms-txt"><b>{m.title}</b><small><em style={{ color: KIND_HUE[m.kind] }}>{KIND_WORD[m.kind]}</em> · {m.progressText}</small></span>
          </li>
        ))}
      </ul>
      <div className="ms-rank">
        <span>{career.rank.title}</span>
        <span className="ms-meter"><i style={{ width: `${Math.max(3, career.progress * 100)}%` }} /></span>
        <span className="faint">{career.next ? `${Math.max(0, career.next.minHours - career.hours).toFixed(1).replace(/\.0$/, "")} h to ${career.next.title}` : "Top rank"}</span>
      </div>
      {!streak.flownThisWeek && streak.weeks > 0 && <p className="ms-nudge">Fly once before Sunday night (UTC) to keep your {streak.weeks}-week streak.</p>}
    </a>
  );
}

/** Career: this week in full, the last 12 weeks, and your records. */
export function MissionsPanel() {
  const { ready, week, streak } = useMissions();
  if (!ready) return null;
  const max = Math.max(1, ...streak.history.map((h) => h.flights));
  return (
    <section className="glass pad ms-panel">
      <div className="between wrap" style={{ gap: 10 }}>
        <div>
          <div className="eyebrow">Weekly missions · {leftText(week.msLeft)}</div>
          <h2 className="h2" style={{ margin: "4px 0 0" }}>{week.doneCount === 3 ? "This week is done" : `${week.doneCount} of 3 done this week`}</h2>
        </div>
        <div className="ms-totals">
          <span><b className="data">{streak.weeks}</b><small>week streak</small></span>
          <span><b className="data">{streak.best}</b><small>best streak</small></span>
          <span><b className="data">{streak.missionsDone}</b><small>missions done</small></span>
        </div>
      </div>
      <div className="ms-grid">
        {week.missions.map((m) => (
          <div key={m.id} className={`ms-big${m.done ? " done" : ""}`} style={{ ["--hue" as string]: KIND_HUE[m.kind] }}>
            <MissionIc m={m} size={56} />
            <span className="ms-kind">{KIND_WORD[m.kind]}</span>
            <b>{m.title}</b>
            <small>{m.how}</small>
            <span className="ms-prog">{m.progressText}</span>
          </div>
        ))}
      </div>
      <div className="ms-weeks" role="img" aria-label="Flights and missions done, each of the last 12 weeks">
        {streak.history.map((h) => (
          <div key={h.key} className="ms-wk" title={`${h.key}: ${h.flights} ${h.flights === 1 ? "flight" : "flights"}, ${h.missions} of 3 missions`}>
            <span className="ms-wbar"><i style={{ height: `${h.flights ? Math.max(12, (h.flights / max) * 100) : 0}%` }} /></span>
            <span className="ms-dots">{[0, 1, 2].map((i) => <i key={i} className={i < h.missions ? "on" : ""} />)}</span>
          </div>
        ))}
      </div>
      <p className="faint" style={{ margin: "10px 0 0", fontSize: 12.5 }}>New missions every Monday at 00:00 UTC. Only finished flights flown in the sim count, measured from your logbook. Your streak counts weeks in a row with at least one flight.</p>
    </section>
  );
}

/** Which missions a landing just completed (for the touchdown card). */
export function missionsJustDone(list: FlightSummary[], current: FlightSummary | null): Mission[] {
  if (!current) return [];
  const before = weekMissions(list.filter((f) => f.id !== current.id));
  const after = weekMissions([...list.filter((f) => f.id !== current.id), { ...current, status: "completed", endedAt: current.endedAt ?? Date.now() }]);
  return after.missions.filter((m, i) => m.done && !before.missions[i]!.done);
}

/** On the touchdown card: missions this landing just completed. */
export function LandedMissions() {
  const { ready, list, demo } = useMissions();
  const cur = useApp((s) => s.flight ?? s.lastFlight);
  const done = useMemo(() => (ready && cur ? missionsJustDone(list, demo ? { ...cur, simulator: { ...cur.simulator, source: "live" } } : cur) : []), [ready, list, cur, demo]);
  if (!done.length) return null;
  return (
    <div className="cel-ms">
      {done.map((m) => <span key={m.id} className="cel-m" style={{ ["--hue" as string]: KIND_HUE[m.kind] }}><MissionIc m={m} size={26} />Mission done: {m.title}</span>)}
    </div>
  );
}
