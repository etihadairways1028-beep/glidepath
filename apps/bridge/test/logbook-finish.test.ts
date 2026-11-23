import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/recorder";
import { FlightSession } from "../src/session";
import { liteFlight } from "../src/server";
import type { RawFrame } from "../src/adapters/types";

const log: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return log; } };
const frames: RawFrame[] = readFileSync(new URL("../fixtures/SYNTHETIC-EGLL-EGCC.ndjson", import.meta.url), "utf8")
  .split("\n").filter((l) => l.startsWith("{")).map((l) => { const { seq, ...f } = JSON.parse(l); void seq; return f; });

/** Fly the fixture until after landing, while still taxiing (not parked). */
function landedNotParked() {
  const dir = mkdtempSync(join(tmpdir(), "gp-log-"));
  const rec = new Recorder(dir);
  const s = new FlightSession(rec, log);
  let last: RawFrame | null = null;
  for (const f of frames) {
    s.ingest(f); last = f;
    const cur = (s as any).flight;
    if (cur?.wheelsDownAt && f.position.onGround && (f.speed.gsKt ?? 99) < 25) break;
  }
  return { rec, s, last: last!, dir };
}

describe("every flight reaches the logbook", () => {
  it("saves a landed flight that was never parked as completed, with on-block time", () => {
    const { rec, s, last } = landedNotParked();
    expect(s.settleIfStale(last.t + 5 * 60_000)).toBeNull();     // too soon
    const f = s.settleIfStale(last.t + 21 * 60_000);
    expect(f?.status).toBe("completed");
    const saved = rec.listFlights(5)[0]!;
    expect(saved.status).toBe("completed");
    expect(saved.wheelsUpAt).toBeTruthy(); expect(saved.wheelsDownAt).toBeTruthy(); expect(saved.onBlockAt).toBeTruthy();
    rec.close?.();
  });
  it("counts landing then closing the sim as completed, not incomplete", () => {
    const { rec, s, last } = landedNotParked();
    // Next session: two hours later, somewhere else.
    s.ingest({ ...frames[0]!, t: last.t + 2 * 3600_000 });
    const all = rec.listFlights(5);
    const old = all.find((x) => x.wheelsDownAt);
    expect(old?.status).toBe("completed");
    expect(old?.onBlockAt).toBeTruthy();
    rec.close?.();
  });
  it("keeps the logbook list small", () => {
    const { rec, s, last } = landedNotParked();
    s.settleIfStale(last.t + 21 * 60_000);
    const f = rec.listFlights(1)[0]!;
    const withPlan = { ...f, plan: { ...(f.plan ?? {}), fixes: Array.from({ length: 200 }, (_, i) => ({ ident: `FIX${i}`, lat: 1, lon: 1 })) } } as any;
    expect(JSON.stringify(liteFlight(withPlan)).length).toBeLessThan(JSON.stringify(withPlan).length / 3);
    expect((liteFlight(withPlan).plan as any).fixCount).toBe(200);
    rec.close?.();
  });
});
