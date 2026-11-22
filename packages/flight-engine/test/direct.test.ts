import { describe, expect, it } from "vitest";
import { DirectTracker, directCandidate } from "../src/direct";
import { bearingDeg, destinationPoint } from "../src/geo";

// A dog-leg route: origin → A (north) → B (east) → C (north-east) → dest.
const O = { lat: 50, lon: 0 };
const A = destinationPoint(O, 0, 40);
const B = destinationPoint(A, 90, 40);
const C = destinationPoint(B, 45, 40);
const D = destinationPoint(C, 0, 40);
const route = [O, A, B, C, D];

describe("direct-to detection", () => {
  it("ignores normal flying along the leg", () => {
    const pos = destinationPoint(O, 0, 20);
    expect(directCandidate({ route, nextIdx: 1, pos, trackDeg: 0 })).toBeNull();
  });
  it("spots a direct to B, skipping A", () => {
    const pos = destinationPoint(O, 0, 20);
    const trk = bearingDeg(pos, B);
    expect(directCandidate({ route, nextIdx: 1, pos, trackDeg: trk })).toBe(2);
  });
  it("doesn't count while still turning", () => {
    const pos = destinationPoint(O, 0, 20);
    expect(directCandidate({ route, nextIdx: 1, pos, trackDeg: bearingDeg(pos, B), bankDeg: 20 })).toBeNull();
  });
  it("confirms only after the track has held", () => {
    const t = new DirectTracker(12_000, 3);
    expect(t.update(2, 0)).toBeNull();
    expect(t.update(2, 5000)).toBeNull();
    expect(t.update(3, 9000)).toBeNull(); // changed: starts again
    expect(t.update(3, 15000)).toBeNull();
    expect(t.update(3, 22000)).toBe(3);
  });
});
