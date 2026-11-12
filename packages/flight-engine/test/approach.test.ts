import { describe, expect, it } from "vitest";
import { emptyFrame, type LandingReport, type TelemetryFrame } from "@glidepath/protocol";
import { gateCrossed, reviewApproach, stableCheck } from "../src/approach.js";

/** A straight-in approach to a runway at 51.0N 0E heading north, from 10 nm out. */
function approach(opts: { highBy?: number; sink?: number; gearAtFt?: number } = {}): { frames: TelemetryFrame[]; landing: LandingReport } {
  const frames: TelemetryFrame[] = [];
  const T0 = 1_000_000;
  const steps = 300; // 1 frame per second, ~ 140 kt
  for (let i = 0; i <= steps; i++) {
    const dist = 10 * (1 - i / steps);
    const lat = 51 - dist / 60;
    const f = emptyFrame(i, T0 + i * 1000 * (10 / 140 * 3600 / steps), lat, 0);
    const extra = opts.highBy ? opts.highBy * Math.max(0, Math.min(1, (dist - 1) / 3)) : 0;
    f.position.altAglFt = Math.max(0, dist * 318 + extra);
    f.position.altMslFt = f.position.altAglFt;
    f.position.onGround = i === steps;
    f.speed.iasKt = 140; f.speed.vsFpm = -(opts.sink ?? 740); f.attitude.bankDeg = 0;
    f.controls.gearDown = f.position.altAglFt <= (opts.gearAtFt ?? 3000);
    frames.push(f);
  }
  const last = frames.at(-1)!;
  const landing = { t: last.t, lat: last.position.lat, lon: 0, touchdownVsFpm: -150, runway: { ident: "36", distanceFromThresholdFt: 1400, centrelineOffsetFt: 3 } } as unknown as LandingReport;
  return { frames, landing };
}

describe("approach coach", () => {
  it("praises a stable 3° approach", () => {
    const { frames, landing } = approach();
    const r = reviewApproach(frames, landing)!;
    expect(r.gates.map((g) => g.stable)).toEqual([true, true]);
    expect(r.refSpeedKt).toBe(140);
    expect(r.notes.every((n) => n.good)).toBe(true);
    expect(r.notes.map((n) => n.text)).toContain("Stayed close to a 3° path all the way down.");
  });
  it("flags high, fast sink and late gear", () => {
    const { frames, landing } = approach({ highBy: 600, sink: 1400, gearAtFt: 900 });
    const r = reviewApproach(frames, landing)!;
    expect(r.gates[0]!.stable).toBe(false);
    expect(r.gates[0]!.reasons.join()).toMatch(/gear up|sinking 1,400 fpm/);
    const text = r.notes.map((n) => n.text).join("\n");
    expect(text).toMatch(/High on the approach/);
    expect(text).toMatch(/Gear came down late, at \d{3} ft/);
    expect(text).toMatch(/Sink rate peaked at 1,400 fpm/);
  });
  it("checks stability and gates live", () => {
    expect(stableCheck({ aglFt: 900, iasKt: 165, vsFpm: -800, bankDeg: 2, gearDown: true }, 140)).toEqual(["25 kt fast"]);
    expect(gateCrossed(1020, 990)).toBe(1000);
    expect(gateCrossed(990, 980)).toBe(null);
    expect(gateCrossed(510, 495)).toBe(500);
  });
  it("needs a landing and frames", () => {
    expect(reviewApproach([], null)).toBe(null);
  });
});
