import { describe, expect, it } from "vitest";
import type { FlightSummary, LandingReport } from "@glidepath/protocol";
import { careerStats, flightsInMonth, hoursText } from "../src/index.js";

const H = 3_600_000;
function flight(id: string, off: number, blockH: number, fpm: number | null, score: number, extra: Partial<FlightSummary> = {}): FlightSummary {
  const landing = { score, grade: score >= 95 ? "A+" : "B", touchdownVsFpm: fpm } as unknown as LandingReport;
  return {
    id, status: "completed", simulator: { id: "msfs2024", name: "MSFS", version: null, source: "live" }, aircraft: { title: "A320", icaoType: "A320", registration: null, model: null } as never,
    callsign: null, departureIcao: "OMDB", arrivalIcao: "EGLL", departureName: null, arrivalName: null, departureRunway: null, arrivalRunway: null,
    departureStand: null, arrivalStand: null, plan: null, phase: "COMPLETED", startedAt: off - 60_000, offBlockAt: off, wheelsUpAt: off + 600_000,
    wheelsDownAt: off + blockH * H - 300_000, onBlockAt: off + blockH * H, endedAt: off + blockH * H, distanceNm: 3000, maxAltitudeFt: 38000, maxGsKt: 500,
    fuelStartKg: 60000, fuelEndKg: 10000, landings: fpm === null && score < 0 ? [] : [landing], takeoff: null, stats: null, lastSeq: 1, ...extra,
  };
}

describe("career stats", () => {
  const nov = Date.UTC(2026, 10, 6, 8);
  const oct = Date.UTC(2026, 9, 12, 8);
  const flights = [
    flight("a", nov, 7, -140, 98),
    flight("b", oct, 1.5, -310, 80, { departureIcao: "EGLL", arrivalIcao: "EGCC", aircraft: { title: "B738", icaoType: "B738" } as never, distanceNm: 160 }),
    flight("c", oct, 2, -70, 96),
    { ...flight("d", nov, 3, -500, 40), status: "incomplete" as const },
  ];
  const s = careerStats(flights, { now: nov });

  it("counts only completed flights and adds up hours", () => {
    expect(s.flights).toBe(3);
    expect(hoursText(s.blockMs)).toBe("10h 30m");
    expect(s.distanceNm).toBe(6160);
    expect(s.fuelBurnedKg).toBe(150000);
  });
  it("averages landing sink rate and buckets them into words", () => {
    expect(s.landings).toBe(3);
    expect(s.avgFpm).toBe(173);
    expect(s.softestFpm).toBe(70);
    expect(s.firmestFpm).toBe(310);
    expect(s.words).toEqual({ Smooth: 2, Firm: 1 });
    expect(s.bestLanding).toMatchObject({ id: "a", fpm: 140 });
  });
  it("finds records, airports and aircraft", () => {
    expect(s.longest).toMatchObject({ id: "a", from: "OMDB", to: "EGLL" });
    expect(s.airports).toBe(3);
    expect(s.topAirports[0]).toEqual({ icao: "EGLL", visits: 3 });
    expect(s.topAircraft[0]).toMatchObject({ type: "A320", flights: 2 });
  });
  it("groups block hours by month", () => {
    expect(s.byMonth).toHaveLength(12);
    expect(s.byMonth.at(-1)).toMatchObject({ key: "2026-11", flights: 1 });
    expect(s.byMonth.at(-2)).toMatchObject({ key: "2026-10", flights: 2 });
    expect(flightsInMonth(flights, 2026, 10).map((f) => f.id)).toEqual(["b", "c"]);
  });
});

describe("monthly brief", async () => {
  const { composeMonthlyBrief } = await import("../src/index.js");
  const nov = Date.UTC(2026, 10, 6, 8);
  const oct = Date.UTC(2026, 9, 12, 8);
  const all = [flight("a", nov, 7, -140, 98), flight("b", oct, 1.5, -310, 80), flight("c", oct, 2, -70, 96)];
  it("summarises the month in plain words", () => {
    const b = composeMonthlyBrief(all, 2026, 10, { name: "Anisha Varma", appUrl: "https://example.org/app/" })!;
    expect(b.flights).toBe(2);
    expect(b.subject).toBe("Your October in the air: 3h 30m, 2 flights");
    expect(b.text).toContain("Hi Anisha,");
    expect(b.text).toContain("You flew 2 flights in October, 3h 30m block to block over 6,000 nm.");
    expect(b.text).toContain("Your landings averaged 190 fpm, which is normal.");
    expect(b.html).toContain("Open your logbook");
    expect(b.html).not.toContain("<script");
  });
  it("compares with the previous month", () => {
    const b = composeMonthlyBrief(all, 2026, 11)!;
    expect(b.text).toContain("That's 3h 30m more than October.");
  });
  it("sends nothing for an empty month", () => {
    expect(composeMonthlyBrief(all, 2026, 9)).toBeNull();
  });
});
