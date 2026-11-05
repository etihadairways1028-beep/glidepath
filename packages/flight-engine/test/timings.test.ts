import { describe, expect, it } from "vitest";
import { clockAt, computeTimings, statusFor, timeToFlyMs, type TimingsInput } from "../src/index.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 5, 9, 0); // 0900Z
const plan = { out: T0 / 1000, off: (T0 + 15 * MIN) / 1000, on: (T0 + 75 * MIN) / 1000, in: (T0 + 82 * MIN) / 1000, airTimeS: 60 * 60 };
const base = (over: Partial<TimingsInput>): TimingsInput => ({
  now: T0, airborne: false, completed: false, groundSpeedKt: 0, altitudeFt: 300, verticalSpeedFpm: 0, toGoNm: 400, minutesToTod: null, cruiseAltitudeFt: 36000,
  actual: { offBlock: null, wheelsUp: null, topOfClimb: null, topOfDescent: null, wheelsDown: null, onBlock: null }, plan, ...over,
});

describe("flight timings", () => {
  it("status labels: on time within 2 min, early, late, hours", () => {
    expect(statusFor(1)?.label).toBe("On time");
    expect(statusFor(-7)?.label).toBe("7 min early");
    expect(statusFor(12)?.tone).toBe("late");
    expect(statusFor(75)?.label).toBe("1h 15m late");
    expect(statusFor(null)).toBeNull();
  });

  it("at the gate: everything estimated from the schedule, OUT is next", () => {
    const t = computeTimings(base({}));
    expect(t.milestones.map((m) => m.state)).toEqual(["next", "later", "later", "later", "later", "later"]);
    expect(t.milestones[1]!.estimated).toBe(T0 + 15 * MIN);
    expect(t.milestones[4]!.estimated).toBe(T0 + 75 * MIN);
    expect(t.milestones[5]!.estimated).toBe(T0 + 82 * MIN);
    expect(t.arrival?.label).toBe("On time");
    expect(t.planned.blockMs).toBe(82 * MIN);
  });

  it("a 20-minute late push makes every later estimate 20 minutes late", () => {
    const now = T0 + 20 * MIN;
    const t = computeTimings(base({ now, actual: { offBlock: now, wheelsUp: null, topOfClimb: null, topOfDescent: null, wheelsDown: null, onBlock: null } }));
    expect(t.departure?.label).toBe("20 min late");
    expect(t.milestones[1]!.estimated).toBe(now + 15 * MIN);
    expect(t.arrival?.deltaMin).toBe(20);
    expect(t.milestones[1]!.state).toBe("next");
  });

  it("airborne: arrival estimate comes from distance to go and groundspeed", () => {
    const now = T0 + 40 * MIN;
    const t = computeTimings(base({
      now, airborne: true, groundSpeedKt: 450, altitudeFt: 36000, toGoNm: 230,
      actual: { offBlock: T0 + 1 * MIN, wheelsUp: T0 + 14 * MIN, topOfClimb: T0 + 35 * MIN, topOfDescent: null, wheelsDown: null, onBlock: null },
      minutesToTod: 12,
    }));
    const fly = timeToFlyMs(230, 450);
    expect(fly).toBeCloseTo((200 / 450 + 30 / 200) * 3_600_000, -3);
    expect(t.milestones[4]!.estimated).toBe(now + fly);
    expect(t.milestones[3]!.estimated).toBe(now + 12 * MIN);
    expect(t.toTopOfDescentMs).toBe(12 * MIN);
    expect(t.airMs).toBe(26 * MIN);
    expect(t.taxiOutMs).toBe(13 * MIN);
    expect(t.milestones[3]!.state).toBe("next");
    expect(t.basis).toMatch(/230 nm to go at 450 kt/);
  });

  it("climbing: top of climb estimated from climb rate", () => {
    const now = T0 + 20 * MIN;
    const t = computeTimings(base({ now, airborne: true, groundSpeedKt: 300, altitudeFt: 16000, verticalSpeedFpm: 2000,
      actual: { offBlock: T0, wheelsUp: T0 + 14 * MIN, topOfClimb: null, topOfDescent: null, wheelsDown: null, onBlock: null } }));
    expect(t.milestones[2]!.estimated).toBe(now + 10 * MIN);
  });

  it("after landing: IN = landing + planned taxi-in", () => {
    const td = T0 + 80 * MIN;
    const t = computeTimings(base({ now: td + MIN, actual: { offBlock: T0, wheelsUp: T0 + 14 * MIN, topOfClimb: T0 + 35 * MIN, topOfDescent: T0 + 50 * MIN, wheelsDown: td, onBlock: null } }));
    expect(t.milestones[5]!.estimated).toBe(td + 7 * MIN);
    expect(t.arrival?.label).toBe("5 min late");
    expect(t.toGateMs).toBe(6 * MIN);
    expect(t.taxiInMs).toBe(MIN);
  });

  it("completed flight: all done, durations final", () => {
    const t = computeTimings(base({ completed: true, now: T0 + 200 * MIN,
      actual: { offBlock: T0, wheelsUp: T0 + 12 * MIN, topOfClimb: T0 + 30 * MIN, topOfDescent: T0 + 55 * MIN, wheelsDown: T0 + 70 * MIN, onBlock: T0 + 76 * MIN } }));
    expect(t.milestones.every((m) => m.state === "done")).toBe(true);
    expect(t.blockMs).toBe(76 * MIN);
    expect(t.airMs).toBe(58 * MIN);
    expect(t.arrival?.label).toBe("6 min early");
    expect(t.toGateMs).toBeNull();
  });

  it("no plan: no schedule and no fake times", () => {
    const t = computeTimings(base({ plan: null, toGoNm: null }));
    expect(t.milestones.every((m) => m.scheduled === null && m.estimated === null)).toBe(true);
    expect(t.departure).toBeNull();
  });

  it("joined mid-flight: earlier milestones count as done", () => {
    const t = computeTimings(base({ airborne: true, groundSpeedKt: 450, actual: { offBlock: null, wheelsUp: null, topOfClimb: null, topOfDescent: T0, wheelsDown: null, onBlock: null } }));
    expect(t.milestones.slice(0, 4).every((m) => m.state === "done")).toBe(true);
    expect(t.milestones[4]!.state).toBe("next");
  });

  it("descent started but not yet confirmed: top of descent is now", () => {
    const now = T0 + 50 * MIN;
    const t = computeTimings(base({ now, airborne: true, groundSpeedKt: 420, altitudeFt: 34000, verticalSpeedFpm: -2000,
      actual: { offBlock: T0, wheelsUp: T0 + 14 * MIN, topOfClimb: T0 + 35 * MIN, topOfDescent: null, wheelsDown: null, onBlock: null } }));
    expect(t.milestones[3]!.estimated).toBe(now);
  });

  it("local clock at a UTC offset", () => {
    expect(clockAt(Date.UTC(2026, 10, 5, 21, 30), 4)).toBe("01:30");
    expect(clockAt(Date.UTC(2026, 10, 5, 2, 0), -5)).toBe("21:00");
    expect(clockAt(0, null)).toBeNull();
  });
});
