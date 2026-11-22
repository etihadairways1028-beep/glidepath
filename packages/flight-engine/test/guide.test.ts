import { describe, expect, it } from "vitest";
import { approachGuide, likelyRunway } from "../src/guide";
import { destinationPoint } from "../src/geo";

// EGCC 23R-ish: threshold, true heading 232.
const thr = { lat: 53.3712, lon: -2.2490 };
const rw = { threshold: thr, headingTrueDeg: 232, lengthFt: 10007, elevationFt: 257 };
const at = (nm: number, rightFt = 0) => {
  const p = destinationPoint(thr, (232 + 180) % 360, nm);
  return rightFt ? destinationPoint(p, (232 + 90) % 360, rightFt / 6076.12) : p;
};

describe("approach guidance", () => {
  it("is on glidepath and centreline at 3° from 5 nm", () => {
    const alt = 257 + 50 + 5 * 6076.12 * Math.tan((3 * Math.PI) / 180);
    const g = approachGuide({ pos: at(5), altMslFt: alt, gsKt: 140, vsFpm: -740, trackDeg: 232, runway: rw });
    expect(g.state).toBe("established");
    expect(Math.abs(g.vertFt)).toBeLessThan(5);
    expect(Math.abs(g.latFt)).toBeLessThan(40); expect(Math.abs(g.hDots)).toBeLessThan(0.05);
    expect(g.vText).toBe("On glidepath"); expect(g.hText).toBe("On centreline");
    expect(Math.round(g.requiredVsFpm!)).toBeGreaterThan(-760); expect(Math.round(g.requiredVsFpm!)).toBeLessThan(-720);
    expect(g.distNm).toBeCloseTo(5, 1);
  });
  it("reports high and right, with the right correction", () => {
    const alt = 257 + 50 + 4 * 6076.12 * Math.tan((3 * Math.PI) / 180) + 300;
    const g = approachGuide({ pos: at(4, 400), altMslFt: alt, gsKt: 140, vsFpm: -700, trackDeg: 232, runway: rw });
    expect(g.vertFt).toBeGreaterThan(290); expect(g.vDots).toBeGreaterThan(0);
    expect(g.latFt).toBeGreaterThan(350); expect(g.hDots).toBeGreaterThan(0);
    expect(g.vText).toMatch(/^High 300 ft: increase descent/);
    expect(g.hText).toMatch(/^Right of centreline \d+ ft: correct left/);
    expect(g.correctTrackDeg).toBeLessThan(232);
  });
  it("warns when low close in and flags an unstable approach", () => {
    const g = approachGuide({ pos: at(2), altMslFt: 257 + 350, gsKt: 135, vsFpm: -1300, trackDeg: 232, runway: rw });
    expect(g.vDots).toBeLessThan(-1);
    expect(g.vTone).toBe("warning");
    expect(g.vText).toMatch(/level off now/);
    expect(g.unstable).toMatch(/glidepath/);
  });
  it("picks the runway you're lined up with", () => {
    const opposite = { threshold: destinationPoint(thr, 232, 10007 / 6076.12), headingTrueDeg: 52, id: "05L" };
    const r = likelyRunway([{ ...rw, id: "23R" }, opposite], at(6), 232);
    expect(r?.id).toBe("23R");
  });
});
