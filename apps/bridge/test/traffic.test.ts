import { describe, expect, it } from "vitest";
import { TrafficTracks } from "../src/traffic";
const p = (lon: number, lat: number, alt = 30000) => ({ callsign: "SIA005", lat, lon, altFt: alt, gsKt: 480, hdg: 270, type: "A359", dep: "WSSS", arr: "FZAA", network: "vatsim" as const });
describe("TrafficTracks", () => {
  it("keeps a point when the aircraft moves, thins long tracks and forgets aircraft that left", () => {
    const t = new TrafficTracks();
    t.record("vatsim", [p(100, 1)], 0);
    t.record("vatsim", [p(100.001, 1)], 60_000); // barely moved: skipped
    t.record("vatsim", [p(99.9, 1)], 120_000);
    expect(t.track("vatsim", "sia005")).toHaveLength(2);
    for (let i = 0; i < 900; i++) t.record("vatsim", [p(99 - i * 0.05, 1)], 200_000 + i * 60_000);
    expect(t.track("vatsim", "SIA005").length).toBeLessThanOrEqual(401);
    t.record("vatsim", [], 200_000 + 900 * 60_000 + 21 * 60_000);
    expect(t.track("vatsim", "SIA005")).toHaveLength(0);
  });
  it("starts again when the same callsign appears far away", () => {
    const t = new TrafficTracks();
    t.record("vatsim", [p(100, 1)], 0); t.record("vatsim", [p(99, 1)], 60_000);
    t.record("vatsim", [p(-40, 50)], 120_000);
    expect(t.track("vatsim", "SIA005")).toHaveLength(1);
  });
});
