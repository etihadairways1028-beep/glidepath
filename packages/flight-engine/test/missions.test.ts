import { describe, expect, it } from "vitest";
import type { FlightSummary, LandingReport } from "@glidepath/protocol";
import { flyingStreak, weekKey, weekMissions, weekStart } from "../src/index.js";

const H = 3_600_000, DAY = 86_400_000;
function flight(id: string, off: number, blockH: number, fpm: number, extra: Partial<FlightSummary> = {}): FlightSummary {
  const landing = { score: 90, grade: "A", touchdownVsFpm: -fpm, t: off + blockH * H, lat: 51, lon: 0, crosswindKt: 4 } as unknown as LandingReport;
  return {
    id, status: "completed", simulator: { id: "msfs2024", name: "MSFS", version: null, source: "live" }, aircraft: { title: "A320", icaoType: "A320" } as never,
    callsign: null, departureIcao: "EGLL", arrivalIcao: "EGCC", departureName: null, arrivalName: null, departureRunway: null, arrivalRunway: null,
    departureStand: null, arrivalStand: null, plan: null, phase: "COMPLETED", startedAt: off, offBlockAt: off, wheelsUpAt: off + 600_000,
    wheelsDownAt: off + blockH * H - 300_000, onBlockAt: off + blockH * H, endedAt: off + blockH * H, distanceNm: 160, maxAltitudeFt: 25000, maxGsKt: 400,
    fuelStartKg: 6000, fuelEndKg: 3500, landings: [landing], takeoff: null, stats: null, lastSeq: 1, ...extra,
  };
}

describe("weeks", () => {
  it("starts on Monday 00:00 UTC and names ISO weeks", () => {
    const wed = Date.UTC(2026, 10, 25, 10); // Wednesday 25 Nov 2026
    expect(new Date(weekStart(wed)).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(weekKey(wed)).toBe("2026-W48");
    expect(weekKey(Date.UTC(2026, 0, 1))).toBe("2026-W01");
  });
});

describe("weekly missions", () => {
  const now = Date.UTC(2026, 10, 25, 10);
  it("gives three missions, one of each kind, the same every time in a week", () => {
    const a = weekMissions([], now), b = weekMissions([], now + 2 * DAY);
    expect(a.missions.map((m) => m.kind)).toEqual(["fly", "skill", "explore"]);
    expect(a.missions.map((m) => m.title)).toEqual(b.missions.map((m) => m.title));
    expect(a.doneCount).toBe(0);
    expect(a.daysLeft).toBe(4);
  });
  it("measures progress from this week's real flights only", () => {
    const old = flight("old", Date.UTC(2026, 10, 10, 8), 1, 100);
    const replay = { ...flight("r", Date.UTC(2026, 10, 24, 8), 9, 50), simulator: { id: "msfs2024", name: "MSFS", version: null, source: "replay" } } as FlightSummary;
    const w = weekMissions([old, replay], now);
    expect(w.missions.every((m) => m.have === 0)).toBe(true);
    const w2 = weekMissions([old, flight("x", Date.UTC(2026, 10, 24, 8), 1, 100)], now);
    expect(w2.missions.find((m) => m.kind === "fly")!.have).toBeGreaterThan(0);
  });
});

describe("streak", () => {
  const now = Date.UTC(2026, 10, 25, 10);
  it("counts weeks in a row and isn't broken until the week ends", () => {
    const f = [0, 1, 2].map((k) => flight(`w${k}`, now - (k + 1) * 7 * DAY, 1, 200));
    const s = flyingStreak(f, now);
    expect(s.flownThisWeek).toBe(false);
    expect(s.weeks).toBe(3);
    expect(s.history).toHaveLength(12);
    const s2 = flyingStreak([...f, flight("now", now - 3600_000 * 30, 1, 200)], now);
    expect(s2.weeks).toBe(4);
    expect(flyingStreak([flight("gap", now - 21 * DAY, 1, 200)], now).weeks).toBe(0);
  });
});
