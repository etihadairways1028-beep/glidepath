import { describe, expect, it } from "vitest";
import { callouts, copilotAlerts, copilotAnswer, runwayForWind, type CopilotSnapshot } from "../src/index.js";

const EGCC = [
  { ident: "05L", threshold: { lat: 53.3451, lon: -2.29274 }, headingTrueDeg: 51, lengthFt: 10000, widthFt: 148 },
  { ident: "23R", threshold: { lat: 53.3624, lon: -2.25714 }, headingTrueDeg: 231, lengthFt: 10000, widthFt: 148 },
];
const snap = (o: Partial<CopilotSnapshot> = {}): CopilotSnapshot => ({
  phase: "CRUISE", airborne: true, altFt: 36000, aglFt: 35800, iasKt: 270, gsKt: 450, vsFpm: 0, gearDown: false, flapsIndex: 0,
  fuelKg: 8000, fuelAtDestinationKg: 5200, plannedLandingFuelKg: 5000, toGoNm: 220, departure: "EGLL", arrival: "EGCC",
  timings: null, tod: { minutesToTod: 12, pastTod: false, plannedVsFpm: -2380, requiredVsNowFpm: -900 }, arrivalWeather: null, arrivalRunways: EGCC, lastLanding: null, ...o,
});
const wx = (dir: number, kt: number, gust: number | null = null, category = "VFR") => ({ icao: "EGCC", windDir: dir, windKt: kt, gustKt: gust, visibility: "10km", category, qnhHpa: 1012, tempC: 9, raw: "EGCC ..." });

describe("copilot", () => {
  it("picks the runway most into wind with components", () => {
    const b = runwayForWind(EGCC, 240, 20)!;
    expect(b.ident).toBe("23R");
    expect(b.headwindKt).toBeCloseTo(19.7, 0);
    expect(b.crosswindKt).toBeCloseTo(3.5, 0);
  });
  it("a calm cruise raises no alerts", () => expect(copilotAlerts(snap())).toEqual([]));
  it("warns about sink rate near the ground and gear up on approach", () => {
    const a = copilotAlerts(snap({ phase: "APPROACH", altFt: 1200, aglFt: 900, vsFpm: -1400, gearDown: false, tod: null }));
    expect(a.map((x) => x.id)).toEqual(expect.arrayContaining(["sink-rate", "gear"]));
    expect(a[0]!.level).toBe("warning");
  });
  it("flags 250 kt below 10,000 ft", () => {
    expect(copilotAlerts(snap({ phase: "DESCENT", altFt: 8000, aglFt: 7800, iasKt: 290, tod: null })).some((x) => x.id === "speed-limit")).toBe(true);
  });
  it("fuel below plan becomes a warning past 10%", () => {
    expect(copilotAlerts(snap({ fuelAtDestinationKg: 4300 })).find((x) => x.id === "fuel")?.level).toBe("warning");
    expect(copilotAlerts(snap({ fuelAtDestinationKg: 4900 })).find((x) => x.id === "fuel")?.level).toBe("caution");
  });
  it("crosswind and tailwind at arrival", () => {
    expect(copilotAlerts(snap({ arrivalWeather: wx(140, 30, 40) })).find((x) => x.id === "crosswind")?.level).toBe("warning");
    expect(copilotAlerts(snap({ arrivalWeather: wx(240, 8) })).some((x) => x.id === "crosswind")).toBe(false);
  });
  it("descent planning: soon, and past", () => {
    expect(copilotAlerts(snap({ tod: { minutesToTod: 3, pastTod: false, plannedVsFpm: -2380, requiredVsNowFpm: null } }))[0]?.id).toBe("tod-soon");
    expect(copilotAlerts(snap({ tod: { minutesToTod: null, pastTod: true, plannedVsFpm: -2380, requiredVsNowFpm: -3100 } }))[0]?.detail).toMatch(/3,100 fpm/);
  });
  it("answers from data, and says when data is missing", () => {
    expect(copilotAnswer("runway", snap({ arrivalWeather: wx(240, 20) }))).toMatch(/Expect 23R/);
    expect(copilotAnswer("runway", snap())).toMatch(/can't pick one/);
    expect(copilotAnswer("fuel", snap({ fuelKg: null }))).toMatch(/doesn't report/);
    expect(copilotAnswer("descent", snap())).toMatch(/Top of descent in about 12 minutes/);
    expect(copilotAnswer("landing", snap())).toMatch(/No landing/);
    expect(copilotAnswer("fuel", snap())).toBe("8,000 kg on board. At this burn we land with about 5,200, 200 above plan.");
    expect(copilotAnswer("status", snap())).toBe("Cruising, FL360, 450 knots, 220 miles to run to EGCC. Nothing to flag.");
  });
  it("radio-altitude callouts fire once each on approach", () => {
    const said = new Set<string>();
    const st = (agl: number) => ({ phase: "APPROACH", aglFt: agl, airborne: true, minutesToTod: null });
    const heard: string[] = [];
    let prev = st(1200);
    for (const agl of [1100, 990, 600, 480, 120, 95, 45, 35, 25, 15, 5]) { heard.push(...callouts(prev, st(agl), said)); prev = st(agl); }
    expect(heard).toEqual(["One thousand", "Five hundred", "One hundred", "50", "40", "30", "20", "10"]);
    expect(callouts(prev, st(4), said)).toEqual([]);
  });
  it("phase callouts", () => {
    expect(callouts({ phase: "CRUISE", aglFt: 30000, airborne: true, minutesToTod: null }, { phase: "DESCENT", aglFt: 29000, airborne: true, minutesToTod: null }, new Set())).toEqual(["Descent started"]);
  });
});
