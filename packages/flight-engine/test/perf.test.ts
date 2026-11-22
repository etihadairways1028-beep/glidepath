import { describe, expect, it } from "vitest";
import { landing, perfTypeFor, takeoff } from "../src/perf";

const a20n = perfTypeFor("A20N")!;
const b738 = perfTypeFor("b738")!;
const sl = { elevationFt: 83, oatC: 15, qnhHpa: 1013 };

describe("takeoff performance", () => {
  it("gives plausible A320neo speeds and a flex on a long runway", () => {
    const r = takeoff({ type: a20n, towKg: 70000, toraFt: 12000, runwayHdgTrue: 270, atmos: sl, wind: { dirDeg: 270, kt: 10 }, surface: "dry", flap: "1+F", thrust: "flex" });
    expect(r.ok).toBe(true);
    expect(r.v2).toBeGreaterThan(135); expect(r.v2).toBeLessThan(150);
    expect(r.v1).toBeLessThanOrEqual(r.vr); expect(r.vr).toBeLessThan(r.v2);
    expect(r.flexC).not.toBeNull(); expect(r.flexC!).toBeGreaterThan(44); expect(r.flexC!).toBeLessThanOrEqual(70);
    expect(r.headKt).toBe(10);
    expect(r.trim).toMatch(/^(UP|DN)\d\.\d$/);
  });
  it("needs more runway when hot and high, and refuses a runway that's too short", () => {
    const base = { type: b738, towKg: 78000, runwayHdgTrue: 90, wind: { dirDeg: null, kt: 0 }, surface: "dry" as const, flap: "5", thrust: "toga" as const };
    const cool = takeoff({ ...base, toraFt: 20000, atmos: sl });
    const hot = takeoff({ ...base, toraFt: 20000, atmos: { elevationFt: 5400, oatC: 35, qnhHpa: 1013 } });
    expect(hot.todrFt).toBeGreaterThan(cool.todrFt * 1.4);
    const short = takeoff({ ...base, toraFt: 5000, atmos: sl });
    expect(short.ok).toBe(false); expect(short.problem).toMatch(/runway/);
  });
  it("counts tailwind against you more than headwind helps", () => {
    const base = { type: a20n, towKg: 75000, toraFt: 20000, runwayHdgTrue: 0, atmos: sl, surface: "dry" as const, flap: "1+F", thrust: "toga" as const };
    const calm = takeoff({ ...base, wind: { dirDeg: null, kt: 0 } }).todrFt;
    const head = takeoff({ ...base, wind: { dirDeg: 0, kt: 10 } }).todrFt;
    const tail = takeoff({ ...base, wind: { dirDeg: 180, kt: 10 } }).todrFt;
    expect(calm - head).toBeLessThan(tail - calm);
  });
});

describe("landing performance", () => {
  it("gives Vapp a little above VLS and suggests an autobrake", () => {
    const r = landing({ type: a20n, ldwKg: 62000, ldaFt: 9000, runwayHdgTrue: 230, atmos: sl, wind: { dirDeg: 230, kt: 18 }, surface: "dry", flap: "FULL", autobrake: "LO", reversers: true });
    expect(r.vls).toBeGreaterThan(120); expect(r.vls).toBeLessThan(135);
    expect(r.addKt).toBe(6);
    expect(r.vapp - r.vls).toBe(6);
    expect(r.ok).toBe(true); expect(r.suggestedAutobrake).toBe("LO");
  });
  it("stops later when wet and with weaker brakes", () => {
    const base = { type: b738, ldwKg: 62000, ldaFt: 9000, runwayHdgTrue: 0, atmos: sl, wind: { dirDeg: null, kt: 0 }, flap: "30", reversers: true };
    const dry3 = landing({ ...base, surface: "dry", autobrake: "3" }).ldFt;
    const wet3 = landing({ ...base, surface: "wet", autobrake: "3" }).ldFt;
    const dry1 = landing({ ...base, surface: "dry", autobrake: "1" }).ldFt;
    expect(wet3).toBeGreaterThan(dry3); expect(dry1).toBeGreaterThan(dry3);
  });
});
