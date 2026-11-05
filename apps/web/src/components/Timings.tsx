/**
 * Flight timings: every scheduled, estimated and actual time, the durations
 * and the countdowns. Estimates are always marked "est" and explained.
 */
import type { FlightPlan } from "@glidepath/protocol";
import type { FlightTimings, Milestone, TimingStatus } from "@glidepath/flight-engine";
import { countdown, dur, localAt, zulu } from "../data/derive";

function TimeCell({ ms, plan, side, est }: { ms: number | null; plan: FlightPlan | null; side: Milestone["side"]; est?: boolean }) {
  if (!ms) return <span className="faint">—</span>;
  const local = localAt(ms, plan, side);
  return (
    <span className="tm-cell">
      <span className="data">{zulu(ms)}</span>
      {est ? <span className="est"> est</span> : null}
      {local ? <span className="tm-local data">{local} local</span> : null}
    </span>
  );
}

function Delta({ m }: { m: Milestone }) {
  if (m.deltaMin === null) return <span className="faint">—</span>;
  const d = m.deltaMin;
  const tone = Math.abs(d) <= 2 ? "on-time" : d < 0 ? "early" : "late";
  const text = Math.abs(d) <= 2 ? "On time" : `${d > 0 ? "+" : "−"}${Math.abs(d)} min`;
  return <span className={`tm-delta ${tone}`}>{text}{m.actual === null ? <span className="est"> est</span> : null}</span>;
}

export function StatusPill({ label, status }: { label: string; status: TimingStatus | null }) {
  if (!status) return null;
  return <span className={`tm-pill ${status.tone}`}><span className="faint">{label}</span> {status.label}</span>;
}

/** Full timings: milestone track, durations and countdowns. */
export function TimingsTable({ t, plan, live }: { t: FlightTimings; plan: FlightPlan | null; live: boolean }) {
  const hasSchedule = t.milestones.some((m) => m.scheduled !== null);
  const countdowns: Array<[string, number | null]> = [
    ["Take-off in", t.toTakeoffMs],
    ["Top of climb in", t.toTopOfClimbMs],
    ["Top of descent in", t.toTopOfDescentMs],
    ["Landing in", t.toLandingMs],
    ["At the gate in", t.toGateMs],
  ];
  const shownCountdowns = live ? countdowns.filter(([, v]) => v !== null) : [];
  const durations: Array<[string, number | null, number | null]> = [
    ["Block time", t.blockMs, t.planned.blockMs],
    ["Air time", t.airMs, t.planned.airMs],
    ["Taxi out", t.taxiOutMs, t.planned.taxiOutMs],
    ["Taxi in", t.taxiInMs, t.planned.taxiInMs],
  ];

  return (
    <div className="timings">
      <div className="tm-head">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <StatusPill label="Departure" status={t.departure} />
          <StatusPill label="Arrival" status={t.arrival} />
          {!hasSchedule ? <span className="faint" style={{ fontSize: 12.5 }}>Link a SimBrief plan in Settings to see scheduled times and delays.</span> : null}
        </div>
        <span className="faint" style={{ fontSize: 12 }}>UTC{plan && (plan.originUtcOffsetH !== null || plan.destinationUtcOffsetH !== null) ? ", with airport local time" : ""}</span>
      </div>

      <div className="tm-table" role="table" aria-label="Flight milestones">
        <div className="tm-row tm-hdr" role="row">
          <span role="columnheader">Milestone</span>
          <span role="columnheader">Scheduled</span>
          <span role="columnheader">Estimated</span>
          <span role="columnheader">Actual</span>
          <span role="columnheader">vs plan</span>
        </div>
        {t.milestones.map((m) => (
          <div className={`tm-row ${m.state}`} role="row" key={m.id}>
            <span className="tm-name" role="cell"><i className="tm-dot" aria-hidden="true" />{m.label}<span className="tm-short faint">{m.short}</span></span>
            <span role="cell"><TimeCell ms={m.scheduled} plan={plan} side={m.side} /></span>
            <span role="cell">{m.actual === null ? <TimeCell ms={m.estimated} plan={plan} side={m.side} est /> : <span className="faint">—</span>}</span>
            <span role="cell"><TimeCell ms={m.actual} plan={plan} side={m.side} /></span>
            <span role="cell"><Delta m={m} /></span>
          </div>
        ))}
      </div>

      <div className="tm-grid">
        {durations.map(([k, actual, planned]) => (
          <div className="tm-dur" key={k}>
            <div className="k">{k}</div>
            <div className="v data">{actual === null ? "—" : dur(actual)}</div>
            <div className="p faint">{planned === null ? " " : `planned ${dur(planned)}`}</div>
          </div>
        ))}
      </div>

      {shownCountdowns.length > 0 && (
        <div className="tm-count">
          {shownCountdowns.map(([k, v]) => (
            <div key={k}><span className="faint">{k}</span> <b className="data">{countdown(v)}</b></div>
          ))}
        </div>
      )}
      {live && t.basis ? <p className="faint tm-basis">Arrival estimate: {t.basis}. Estimates assume real-time sim rate; pausing or time acceleration shifts them.</p> : null}
    </div>
  );
}

/** Compact OUT · OFF · TOC · TOD · ON · IN strip for the dashboard and Glance mode. */
export function TimingsStrip({ t, big }: { t: FlightTimings; big?: boolean }) {
  return (
    <div className={`tm-strip${big ? " big" : ""}`} role="list" aria-label="Flight milestones">
      {t.milestones.map((m) => {
        const time = m.actual ?? m.estimated ?? m.scheduled;
        const kind = m.actual ? "actual" : m.estimated ? "est" : m.scheduled ? "sched" : "none";
        return (
          <div className={`tm-s ${m.state}`} role="listitem" key={m.id} title={m.label}>
            <div className="k">{m.short}</div>
            <div className="v data">{time ? zulu(time) : "—"}</div>
            <div className="n">{kind === "est" ? <span className="est">est</span> : kind === "sched" ? <span className="faint">sched</span> : kind === "actual" ? <span className="faint">{m.label.toLowerCase()}</span> : <span className="faint">&nbsp;</span>}</div>
          </div>
        );
      })}
    </div>
  );
}
