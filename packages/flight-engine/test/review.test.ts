import { describe, expect, it } from "vitest";
import type { FlightEvent, FlightSummary, LandingReport, TelemetryFrame } from "@glidepath/protocol";
import { buildDebrief, FlightReviewer, LandingAnalyzer, landingProfileFor, PhaseDetector, TAKEOFF_BANDS, takeoffNotes, touchdownWords } from "../src/index.js";
import { EGCC_23R, generateSyntheticFlight } from "@glidepath/testkit";

function fly(frames: TelemetryFrame[]) {
  const pd = new PhaseDetector({ plannedCruiseFt: 24000, destination: EGCC_23R.threshold });
  const la = new LandingAnalyzer({ profile: landingProfileFor("A320"), runways: [EGCC_23R] });
  const rv = new FlightReviewer("narrowbody-jet");
  const reports: LandingReport[] = [];
  for (const f of frames) {
    const ev: FlightEvent[] = pd.update(f);
    for (const e of ev) if (e.type === "TOUCHDOWN") la.touchdown(f);
    rv.push(f, pd.phase, ev);
    const r = la.push(f);
    if (r) reports.push(r);
  }
  const last = la.flush();
  if (last) reports.push(last);
  return { rv, reports };
}

function summary(rv: FlightReviewer, landings: LandingReport[]): FlightSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000", status: "completed",
    simulator: { id: "replay", name: "Replay", version: null, source: "replay" }, aircraft: null, callsign: "TEST1",
    departureIcao: "EGLL", arrivalIcao: "EGCC", departureName: null, arrivalName: null, departureRunway: "27R", arrivalRunway: "23R",
    departureStand: null, arrivalStand: null, plan: null, phase: "COMPLETED", startedAt: 0, offBlockAt: 1, wheelsUpAt: 2, wheelsDownAt: 3_000_000,
    onBlockAt: 3_100_000, endedAt: 3_200_000, distanceNm: 150, maxAltitudeFt: 24000, maxGsKt: 420, fuelStartKg: 6200, fuelEndKg: 5200,
    landings, takeoff: rv.takeoff, stats: rv.stats, lastSeq: 1,
  };
}

describe("takeoff review (SYNTHETIC flights)", () => {
  it("measures a normal 3°/s rotation and 15° climb as smooth", () => {
    const { rv } = fly(generateSyntheticFlight());
    const t = rv.takeoff!;
    expect(t).not.toBeNull();
    expect(t.rotationRateDegS!).toBeGreaterThan(2.4);
    expect(t.rotationRateDegS!).toBeLessThan(3.6);
    expect(t.maxPitchDeg!).toBeCloseTo(15, 0);
    expect(t.notes.some((n) => n.level === "improve")).toBe(false);
    expect(t.verdict).toMatch(/takeoff/i);
    expect(t.groundRollFt!).toBeGreaterThan(3000);
  });

  it("flags an aggressive, over-pitched takeoff", () => {
    const { rv } = fly(generateSyntheticFlight({ rotationDegS: 7, climbPitchDeg: 24 }));
    const t = rv.takeoff!;
    expect(t.rotationRateDegS!).toBeGreaterThan(5);
    expect(t.notes.filter((n) => n.level === "improve").length).toBeGreaterThanOrEqual(2);
    expect(t.notes.map((n) => n.text).join(" ")).toMatch(/snatched|Pitched up too far/);
  });

  it("flags a shallow climb-out", () => {
    const { rv } = fly(generateSyntheticFlight({ climbPitchDeg: 7 }));
    expect(rv.takeoff!.verdict).toBe("Shallow climb-out");
  });

  it("rates rotation bands in words", () => {
    const b = TAKEOFF_BANDS["narrowbody-jet"]!;
    const m = { liftoffPitch: null, maxPitch: null, lowBank: null, gearUpS: null };
    expect(takeoffNotes({ ...m, rate: 1 }, b)[0]!.text).toMatch(/^Slow rotation/);
    expect(takeoffNotes({ ...m, rate: 3 }, b)[0]!.level).toBe("good");
    expect(takeoffNotes({ ...m, rate: 6 }, b)[0]!.level).toBe("improve");
  });
});

describe("touchdown words", () => {
  it.each([
    [-45, "Very soft"], [-70, "Smooth"], [-200, "Normal"], [-300, "Firm"], [-532, "Heavy"], [-720, "Hard"],
  ])("%i fpm is %s", (fpm, word) => {
    expect(touchdownWords(fpm).word).toBe(word);
  });
});

describe("debrief", () => {
  it("writes a debrief for the normal synthetic flight", () => {
    const { rv, reports } = fly(generateSyntheticFlight());
    const d = buildDebrief(summary(rv, reports));
    expect(d.sections.map((s) => s.id)).toEqual(["takeoff", "climb", "approach", "landing", "ground"]);
    expect(rv.stats.gate1000).not.toBeNull();
    expect(d.summary).toMatch(/takeoff and a .* landing at \d+ fpm on 23R\./);
    expect(d.wentWell.length).toBeGreaterThan(0);
  });

  it("puts a hard landing at the top of things to improve", () => {
    const { rv, reports } = fly(generateSyntheticFlight({ touchdownVsFpm: 720, touchdownG: 1.8 }));
    const d = buildDebrief(summary(rv, reports));
    expect(d.rating).toBe("improve");
    expect(d.toImprove.join(" ")).toMatch(/Hard landing at 720 fpm/);
    expect(d.sections.find((s) => s.id === "landing")!.headline).toBe("Hard, 720 fpm");
  });

  it("leaves out sections with no data", () => {
    const d = buildDebrief(summary(new FlightReviewer(), []));
    expect(d.sections.find((s) => s.id === "takeoff")).toBeUndefined();
    expect(d.sections.find((s) => s.id === "landing")).toBeUndefined();
  });
});
