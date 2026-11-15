import { describe, expect, it } from "vitest";
import { collectProcedures, FT, runwayName, type Reader } from "../src/procedures.js";

/** A stand-in for SimConnect's buffer: hands back the values in order. */
const R = (...v: Array<number | string>): Reader => ({ readInt32: () => v.shift() as number, readString8: () => v.shift() as string });

describe("procedures from the sim's navdata", () => {
  it("names runways", () => {
    expect(runwayName(9, 1)).toBe("09L");
    expect(runwayName(27, 2)).toBe("27R");
    expect(runwayName(36, 0)).toBe("36");
    expect(runwayName(37, 0)).toBe("N");
    expect(runwayName(0, 0)).toBe("");
  });
  it("rebuilds SIDs, STARs and approaches from parent ids", () => {
    const p = collectProcedures("egll", [
      { type: FT.AIRPORT, id: 1, parent: 0, data: R(2) },
      { type: FT.RUNWAY, id: 2, parent: 1, data: R(9, 1, 27, 2) },
      { type: FT.RUNWAY, id: 3, parent: 1, data: R(9, 2, 27, 1) },
      { type: FT.DEPARTURE, id: 10, parent: 1, data: R("MAXIT1F\0") },
      { type: FT.RUNWAY_TRANSITION, id: 11, parent: 10, data: R(27, 2) },
      { type: FT.RUNWAY_TRANSITION, id: 12, parent: 10, data: R(27, 1) },
      { type: FT.ENROUTE_TRANSITION, id: 13, parent: 10, data: R("MAXIT") },
      { type: FT.ARRIVAL, id: 20, parent: 1, data: R("BNN1Z") },
      { type: FT.ENROUTE_TRANSITION, id: 21, parent: 20, data: R("BNN") },
      { type: FT.APPROACH, id: 30, parent: 1, data: R(4, 0, 27, 2) },
      { type: FT.APPROACH_TRANSITION, id: 31, parent: 30, data: R("BIG") },
      { type: FT.APPROACH, id: 32, parent: 1, data: R(10, 90, 9, 1) },
    ]);
    expect(p.runways).toEqual(["09L", "09R", "27L", "27R"]);
    expect(p.departures).toEqual([{ name: "MAXIT1F", runways: ["27R", "27L"], transitions: ["MAXIT"] }]);
    expect(p.arrivals).toEqual([{ name: "BNN1Z", runways: [], transitions: ["BNN"] }]);
    expect(p.approaches.map((a) => a.name)).toEqual(["RNAV Z 09L", "ILS 27R"]);
    expect(p.approaches[1]!.transitions).toEqual(["BIG"]);
  });
  it("refuses data that doesn't read as procedures", () => {
    expect(() => collectProcedures("x", [{ type: FT.DEPARTURE, id: 1, parent: 0, data: R("\u0001\u0002??") }])).toThrow();
  });
});
