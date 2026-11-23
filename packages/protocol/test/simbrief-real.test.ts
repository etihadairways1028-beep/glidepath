import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSimbrief } from "../src/simbrief";

const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

describe("real SimBrief plans", () => {
  it("reads waypoints when navlog is the list itself (newer plans)", () => {
    const p = parseSimbrief(load("ofp-navlog-list.json"));
    expect(p.origin.icao).toBe("OTHH"); expect(p.destination.icao).toBe("KJFK");
    expect(p.fixes.length).toBeGreaterThan(20);
    expect(p.fixes[0]!.ident).toBe("PATOM");
    expect(p.fixes[0]!.timeS).toBe(619);
  });
  it("reads waypoints, SID and STAR from navlog.fix (older plans)", () => {
    const p = parseSimbrief(load("ofp-navlog-fix.json"));
    expect(p.fixes.length).toBe(82);
    expect(p.sid).toBe("DET1J"); expect(p.star).toBe("KETO2A");
  });
});
