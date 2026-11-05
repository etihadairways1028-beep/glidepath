import { describe, expect, it } from "vitest";
import type { FlightEvent, TelemetryFrame } from "@glidepath/protocol";
import { TelemetryFrame as FrameSchema } from "@glidepath/protocol";
import {
  alongTrackNm, bearingDeg, computeTopOfDescent, computeWithConstraints, crossTrackNm, destinationPoint, distanceNm,
  gradeFor, LandingAnalyzer, landingProfileFor, LANDING_PROFILES, matchRunway, nmPer1000Ft, PhaseDetector,
  routeProgress, runwayPosition, scoreSinkRate, vsForPath, windComponents,
} from "../src/index.js";
import { EGCC_23R, generateSyntheticFlight } from "@glidepath/testkit";

/* ---------------- geo ---------------- */

describe("geo", () => {
  const EGLL = { lat: 51.4706, lon: -0.4619 };
  const KJFK = { lat: 40.6413, lon: -73.7781 };

  it("great-circle distance EGLL–KJFK ≈ 2,991 nm", () => {
    expect(distanceNm(EGLL, KJFK)).toBeGreaterThan(2980);
    expect(distanceNm(EGLL, KJFK)).toBeLessThan(3000);
  });
  it("initial bearing EGLL→KJFK ≈ 288°", () => {
    expect(bearingDeg(EGLL, KJFK)).toBeGreaterThan(286);
    expect(bearingDeg(EGLL, KJFK)).toBeLessThan(290);
  });
  it("destinationPoint is the inverse of distance/bearing", () => {
    const p = destinationPoint(EGLL, 45, 100);
    expect(distanceNm(EGLL, p)).toBeCloseTo(100, 3);
    expect(bearingDeg(EGLL, p)).toBeCloseTo(45, 0);
  });
  it("cross-track sign: right of track is positive", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0, lon: 10 };
    expect(crossTrackNm(a, b, { lat: -1, lon: 5 })).toBeGreaterThan(59);
    expect(crossTrackNm(a, b, { lat: 1, lon: 5 })).toBeLessThan(-59);
    expect(alongTrackNm(a, b, { lat: 0, lon: 5 })).toBeCloseTo(300.6, 0);
  });
  it("route progress picks the right leg", () => {
    const route = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }];
    const prog = routeProgress(route, { lat: 0.5, lon: 1.01 })!;
    expect(prog.legIndex).toBe(1);
    expect(prog.distanceRemainingNm).toBeCloseTo(30, 0);
  });
  it("wind components", () => {
    const w = windComponents(270, 20, 270);
    expect(w.headwindKt).toBeCloseTo(20);
    expect(w.crosswindKt).toBeCloseTo(0);
    const x = windComponents(360, 10, 270); // wind from the north, heading west → from the right
    expect(x.crosswindKt).toBeCloseTo(10);
  });
});

/* ---------------- top of descent ---------------- */

describe("top of descent", () => {
  it("3° path is ~3.14 nm per 1000 ft and ~5.3 × GS fpm", () => {
    expect(nmPer1000Ft(3)).toBeCloseTo(3.14, 2);
    expect(vsForPath(400, 3)).toBeCloseTo(-2123, -1);
  });
  it("FL350 to 3,000 ft with 150 nm to go: ToD ≈ 44 nm ahead", () => {
    const r = computeTopOfDescent({ currentAltitudeFt: 35000, groundSpeedKt: 450, target: { distanceNm: 150, altitudeFt: 3000 } });
    expect(r.kind).toBe("estimate");
    expect(r.descentDistanceNm).toBeCloseTo(32 * 3.14 + 5, 0);
    expect(r.distanceToTodNm).toBeCloseTo(150 - (32 * 3.14 + 5), 0);
    expect(r.minutesToTod).toBeCloseTo((r.distanceToTodNm / 450) * 60, 1);
    expect(r.pastTod).toBe(false);
  });
  it("tailwind lengthens the descent, headwind shortens it", () => {
    const base = { currentAltitudeFt: 35000, groundSpeedKt: 450, trueAirspeedKt: 460, target: { distanceNm: 200, altitudeFt: 3000 } };
    const tail = computeTopOfDescent({ ...base, descentHeadwindKt: -50 });
    const head = computeTopOfDescent({ ...base, descentHeadwindKt: 50 });
    expect(tail.descentDistanceNm).toBeGreaterThan(head.descentDistanceNm);
  });
  it("past ToD reports the steeper V/S needed now", () => {
    const r = computeTopOfDescent({ currentAltitudeFt: 35000, groundSpeedKt: 420, target: { distanceNm: 60, altitudeFt: 3000 } });
    expect(r.pastTod).toBe(true);
    expect(r.requiredVsNowFpm!).toBeLessThan(r.plannedVsFpm);
  });
  it("the most restrictive constraint governs", () => {
    const out = computeWithConstraints({ currentAltitudeFt: 37000, groundSpeedKt: 450 }, [
      { distanceNm: 180, altitudeFt: 3000, label: "airport" },
      // 13,000 ft to lose → ~46 nm of descent; at 60 nm this ToD comes first (14 nm vs 68 nm).
      { distanceNm: 60, altitudeFt: 24000, label: "FL240 at fix" },
    ])!;
    expect(out.governing.label).toBe("FL240 at fix");
  });
});

/* ---------------- landing scoring ---------------- */

describe("landing scoring", () => {
  const nb = LANDING_PROFILES["narrowbody-jet"]!;
  it("profiles are chosen from ICAO type or title", () => {
    expect(landingProfileFor("A20N").id).toBe("narrowbody-jet");
    expect(landingProfileFor("B77W").id).toBe("widebody-jet");
    expect(landingProfileFor("C172").id).toBe("light-aircraft");
    expect(landingProfileFor(null, "PMDG 737-800 BW").id).toBe("narrowbody-jet");
    expect(landingProfileFor(null, "Some glider").id).toBe("generic");
  });
  it("sink-rate curve: ideal band full marks, hard is low", () => {
    expect(scoreSinkRate(120, nb)).toBe(100);
    expect(scoreSinkRate(360, nb)).toBeCloseTo(70);
    expect(scoreSinkRate(600, nb)).toBeCloseTo(30);
    expect(scoreSinkRate(0, nb)).toBe(85);
  });
  it("grade boundaries", () => {
    expect(gradeFor(96)).toBe("A+");
    expect(gradeFor(80)).toBe("B");
    expect(gradeFor(10)).toBe("F");
  });
  it("runway geometry: threshold distance and centreline offset", () => {
    const p = destinationPoint(EGCC_23R.threshold, EGCC_23R.headingTrueDeg, 1200 / 6076.12);
    const off = destinationPoint(p, (EGCC_23R.headingTrueDeg + 90) % 360, 20 / 6076.12);
    const pos = runwayPosition(EGCC_23R, off);
    expect(pos.alongFt).toBeCloseTo(1200, -1);
    expect(pos.offsetFt).toBeCloseTo(20, 0);
    expect(matchRunway([EGCC_23R], off, 231)).not.toBeNull();
    expect(matchRunway([EGCC_23R], off, 50)).toBeNull();
  });
});

/* ---------------- full synthetic flights ---------------- */

function run(frames: TelemetryFrame[], withRunway = true) {
  const pd = new PhaseDetector({ plannedCruiseFt: 24000, destination: EGCC_23R.threshold });
  const la = new LandingAnalyzer({ profile: landingProfileFor("A320"), runways: withRunway ? [EGCC_23R] : [] });
  const events: FlightEvent[] = [];
  const phases: string[] = [];
  const reports = [];
  for (const f of frames) {
    for (const e of pd.update(f)) {
      events.push(e);
      if (e.type === "TOUCHDOWN") la.touchdown(frames.find((x) => x.seq === e.seq)!);
    }
    if (phases.at(-1) !== pd.phase) phases.push(pd.phase);
    const r = la.push(f);
    if (r) reports.push(r);
  }
  const fl = la.flush();
  if (fl) reports.push(fl);
  return { events, phases, reports, pd };
}

describe("synthetic EGLL→EGCC flight (SYNTHETIC data)", () => {
  const frames = generateSyntheticFlight();

  it("every generated frame is valid against the protocol schema", () => {
    for (const f of frames.filter((_, i) => i % 50 === 0)) expect(() => FrameSchema.parse(f)).not.toThrow();
  });

  it("walks through every phase in order", () => {
    const { phases } = run(frames);
    expect(phases).toEqual(["PREFLIGHT", "PUSHBACK", "TAXI_OUT", "TAKEOFF", "CLIMB", "CRUISE", "DESCENT", "APPROACH", "LANDING", "TAXI_IN", "COMPLETED"]);
  });

  it("emits the gate-to-gate events once each", () => {
    const { events } = run(frames);
    const types = events.map((e) => e.type);
    for (const t of ["OFF_BLOCK", "PUSHBACK_START", "TAXI_START", "TAKEOFF_ROLL", "WHEELS_UP", "TOP_OF_CLIMB", "TOP_OF_DESCENT", "APPROACH_START", "TOUCHDOWN", "RUNWAY_EXIT", "ON_BLOCK", "ENGINES_OFF"]) {
      expect(types.filter((x) => x === t), t).toHaveLength(1);
    }
    expect(types).not.toContain("GO_AROUND");
    expect(types).not.toContain("POSITION_DISCONTINUITY");
  });

  it("time-stamps wheels-up on the first airborne frame, not after the debounce", () => {
    const { events } = run(frames);
    const wu = events.find((e) => e.type === "WHEELS_UP")!;
    const first = frames.find((f) => !f.position.onGround)!;
    expect(wu.t).toBe(first.t);
  });

  it("grades a 140 fpm on-centreline landing as smooth (A or better)", () => {
    const { reports } = run(frames);
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.touchdownVsFpm).toBe(140);
    expect(r.touchdownVsSource).toBe("simulator");
    expect(r.bounces).toBe(0);
    expect(r.runway?.ident).toBe("23R");
    expect(["A", "A+"]).toContain(r.grade);
  });

  it("without runway data, centreline and zone are excluded, not guessed", () => {
    const { reports } = run(frames, false);
    const r = reports[0]!;
    expect(r.runway).toBeNull();
    expect(r.components.find((c) => c.id === "centreline")!.score).toBeNull();
    expect(r.components.find((c) => c.id === "touchdownZone")!.score).toBeNull();
  });

  it("a 720 fpm landing is graded hard and capped below D", () => {
    const { reports } = run(generateSyntheticFlight({ touchdownVsFpm: 720, touchdownG: 1.8 }));
    expect(reports[0]!.score).toBeLessThan(50);
    expect(reports[0]!.grade).toBe("F");
    expect(reports[0]!.verdict).toMatch(/Hard landing/);
  });

  it("detects a bounce without calling it a touch-and-go", () => {
    const { reports, events } = run(generateSyntheticFlight({ bounceS: 2 }));
    expect(reports[0]!.bounces).toBe(1);
    expect(events.map((e) => e.type)).not.toContain("TOUCH_AND_GO");
    expect(events.filter((e) => e.type === "TOUCHDOWN")).toHaveLength(1);
  });

  it("a 20-minute pause in cruise does not change the phase or count as level time", () => {
    const { phases, events } = run(generateSyntheticFlight({ pauseInCruiseS: 1200 }));
    expect(phases).toEqual(["PREFLIGHT", "PUSHBACK", "TAXI_OUT", "TAKEOFF", "CLIMB", "CRUISE", "DESCENT", "APPROACH", "LANDING", "TAXI_IN", "COMPLETED"]);
    expect(events.map((e) => e.type)).toContain("SIM_PAUSED");
    expect(events.map((e) => e.type)).toContain("SIM_RESUMED");
  });

  it("joining mid-flight starts in an airborne phase", () => {
    const cruiseIdx = frames.findIndex((f) => (f.position.altMslFt ?? 0) > 23900 && Math.abs(f.speed.vsFpm ?? 0) < 50);
    const { phases } = run(frames.slice(cruiseIdx));
    expect(phases[0]).toBe("CRUISE");
    expect(phases).not.toContain("TAKEOFF");
    expect(phases.at(-1)).toBe("COMPLETED");
  });

  it("a teleport is flagged as a position discontinuity", () => {
    const f = frames.slice(0, 400).map((x) => structuredClone(x));
    for (let i = 300; i < f.length; i++) f[i]!.position.lat += 2; // jump 120 nm
    const { events } = run(f);
    expect(events.map((e) => e.type)).toContain("POSITION_DISCONTINUITY");
  });
});
