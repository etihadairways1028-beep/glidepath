/**
 * Local flight recorder (SQLite via node:sqlite — built into Node 22, no
 * native module to compile). WAL mode keeps writes crash-safe: after a power
 * cut the database holds everything up to the last committed write.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { join } from "node:path";
import type { FlightEvent, FlightSummary, LandingReport, TelemetryFrame } from "@glidepath/protocol";

export class Recorder {
  private db: DatabaseSync;
  private st: Record<string, StatementSync>;
  private pendingFrames: Array<[string, TelemetryFrame]> = [];
  private flushTimer: NodeJS.Timeout;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, "flights.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS flights (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        summary TEXT NOT NULL,
        uploaded INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS frames (
        flight_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        t INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (flight_id, seq)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS events (
        flight_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        t INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_flight ON events(flight_id, t);
      CREATE TABLE IF NOT EXISTS landings (
        flight_id TEXT NOT NULL,
        t INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    this.st = {
      upsertFlight: this.db.prepare(`INSERT INTO flights (id, status, started_at, updated_at, summary) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, summary = excluded.summary`),
      insertFrame: this.db.prepare(`INSERT OR IGNORE INTO frames (flight_id, seq, t, data) VALUES (?, ?, ?, ?)`),
      insertEvent: this.db.prepare(`INSERT INTO events (flight_id, seq, t, type, data) VALUES (?, ?, ?, ?, ?)`),
      insertLanding: this.db.prepare(`INSERT INTO landings (flight_id, t, data) VALUES (?, ?, ?)`),
      listFlights: this.db.prepare(`SELECT summary FROM flights ORDER BY started_at DESC LIMIT ?`),
      getFlight: this.db.prepare(`SELECT summary FROM flights WHERE id = ?`),
      lastActive: this.db.prepare(`SELECT summary FROM flights WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`),
      framesSince: this.db.prepare(`SELECT data FROM frames WHERE flight_id = ? AND seq > ? ORDER BY seq LIMIT ?`),
      eventsFor: this.db.prepare(`SELECT data FROM events WHERE flight_id = ? ORDER BY t`),
      deleteFlight: this.db.prepare(`DELETE FROM flights WHERE id = ?`),
      deleteFrames: this.db.prepare(`DELETE FROM frames WHERE flight_id = ?`),
      deleteEvents: this.db.prepare(`DELETE FROM events WHERE flight_id = ?`),
      frameCount: this.db.prepare(`SELECT COUNT(*) AS n FROM frames WHERE flight_id = ?`),
      maxSeq: this.db.prepare(`SELECT MAX(seq) AS s FROM frames`),
      lastFrame: this.db.prepare(`SELECT data FROM frames WHERE flight_id = ? ORDER BY seq DESC LIMIT 1`),
    };
    // Frames are batched into one transaction every second: far fewer disk syncs.
    this.flushTimer = setInterval(() => this.flush(), 1000);
  }

  saveFlight(s: FlightSummary): void {
    this.st.upsertFlight!.run(s.id, s.status, s.startedAt, Date.now(), JSON.stringify(s));
  }

  saveFrame(flightId: string, f: TelemetryFrame): void {
    this.pendingFrames.push([flightId, f]);
  }

  saveEvent(flightId: string, e: FlightEvent): void {
    this.st.insertEvent!.run(flightId, e.seq, e.t, e.type, JSON.stringify(e));
  }

  saveLanding(flightId: string, l: LandingReport): void {
    this.st.insertLanding!.run(flightId, l.t, JSON.stringify(l));
  }

  flush(): void {
    if (!this.pendingFrames.length) return;
    const batch = this.pendingFrames;
    this.pendingFrames = [];
    this.db.exec("BEGIN");
    try {
      for (const [id, f] of batch) this.st.insertFrame!.run(id, f.seq, f.t, JSON.stringify(f));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  listFlights(limit = 50): FlightSummary[] {
    return (this.st.listFlights!.all(limit) as Array<{ summary: string }>).map((r) => JSON.parse(r.summary));
  }

  getFlight(id: string): FlightSummary | null {
    const r = this.st.getFlight!.get(id) as { summary: string } | undefined;
    return r ? JSON.parse(r.summary) : null;
  }

  lastActiveFlight(): FlightSummary | null {
    const r = this.st.lastActive!.get() as { summary: string } | undefined;
    return r ? JSON.parse(r.summary) : null;
  }

  framesSince(flightId: string, seq: number, limit = 2000): TelemetryFrame[] {
    this.flush();
    return (this.st.framesSince!.all(flightId, seq, limit) as Array<{ data: string }>).map((r) => JSON.parse(r.data));
  }

  events(flightId: string): FlightEvent[] {
    return (this.st.eventsFor!.all(flightId) as Array<{ data: string }>).map((r) => JSON.parse(r.data));
  }

  frameCount(flightId: string): number {
    this.flush();
    return (this.st.frameCount!.get(flightId) as { n: number }).n;
  }

  /** Highest sequence number ever stored, so numbering continues across restarts. */
  maxSeq(): number {
    this.flush();
    const r = this.st.maxSeq!.get() as { s: number | null };
    return r.s ?? 0;
  }

  lastFrame(flightId: string): TelemetryFrame | null {
    this.flush();
    const r = this.st.lastFrame!.get(flightId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : null;
  }

  deleteFlight(id: string): void {
    this.flush();
    this.st.deleteFrames!.run(id);
    this.st.deleteEvents!.run(id);
    this.st.deleteFlight!.run(id);
  }

  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
    this.db.close();
  }
}
