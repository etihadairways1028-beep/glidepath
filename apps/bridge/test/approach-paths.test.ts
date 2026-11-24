import { describe, expect, it } from "vitest";
import { collectApproachPaths, FT, FT_LEG, type PathReader } from "../src/procedures.js";

/** A stand-in for SimConnect's buffer: hands back the values in order, whatever their type. */
const R = (...v: Array<number | string>): PathReader => { const n = () => v.shift() as number; return { readInt32: n, readFloat64: n, readFloat32: n, readString8: () => v.shift() as string }; };
// Leg fields in the order of APPROACH_PATH_DEFINITION: TYPE, FIX_ICAO, FIX_LATITUDE, FIX_LONGITUDE, ALTITUDE1 (metres).
const leg = (ident: string, lat: number, lon: number, altM = 0) => R(18, ident, lat, lon, altM, 0, 0, 0, 0, 0, 0, 0);
// A hold leg: HM at DIRAX, inbound 325° magnetic, left turns, 4.2 nm legs (metres in the sim's data), max 220 kt.
const holdLeg = () => R(14, "DIRAX", 44.45, -0.55, 1524, 2743, 325, 1, 4.2 * 1852, 0, 0, 220);

describe("approach paths from the sim's navdata", () => {
  it("rebuilds final legs and transitions with positions and altitudes", () => {
    const p = collectApproachPaths([
      { type: FT.AIRPORT, id: 1, parent: 0, data: R() },
      { type: FT.APPROACH, id: 10, parent: 1, data: R(1, 0, 11, 0) }, // GPS = RNAV, runway 11
      { type: FT.APPROACH_TRANSITION, id: 11, parent: 10, data: R("DIRAX\0") },
      { type: FT_LEG.APPROACH_LEG, id: 12, parent: 11, data: leg("DIRAX", 44.45, -0.55, 1524) },
      { type: FT_LEG.APPROACH_LEG, id: 13, parent: 11, data: leg("BD113", 44.78, -0.55, 1219.2) },
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 20, parent: 10, data: leg("BD113", 44.78, -0.55, 1219.2) },
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 21, parent: 10, data: leg("IBD11", 44.84, -0.83, 609.6) },
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 22, parent: 10, data: R(19, "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }, // a heading leg: nothing to draw
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 23, parent: 10, data: leg("RW11", 44.83, -0.72, 50) },
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.name).toBe("RNAV 11");
    expect(p[0]!.runway).toBe("11");
    expect(p[0]!.final.map((f) => f.ident)).toEqual(["BD113", "IBD11", "RW11"]);
    expect(p[0]!.final[0]!.altFt).toBe(4000);
    expect(p[0]!.transitions[0]!.name).toBe("DIRAX");
    expect(p[0]!.transitions[0]!.legs.map((f) => f.ident)).toEqual(["DIRAX", "BD113"]);
    expect(p[0]!.transitions[0]!.legs[0]!.altFt).toBe(5000);
  });
  it("reads a published hold with its real course, turn, leg and limits", () => {
    const p = collectApproachPaths([
      { type: FT.APPROACH, id: 10, parent: 1, data: R(1, 0, 11, 0) },
      { type: FT.APPROACH_TRANSITION, id: 11, parent: 10, data: R("DIRAX") },
      { type: FT_LEG.APPROACH_LEG, id: 12, parent: 11, data: holdLeg() },
      { type: FT_LEG.APPROACH_LEG, id: 13, parent: 11, data: leg("BD113", 44.78, -0.55) },
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 20, parent: 10, data: leg("BD113", 44.78, -0.55) },
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 21, parent: 10, data: leg("RW11", 44.83, -0.72) },
      { type: FT_LEG.MISSED_APPROACH_LEG, id: 30, parent: 10, data: leg("BD701", 44.9, -0.9, 914) },
    ]);
    const h = p[0]!.holds[0]!;
    expect(h).toMatchObject({ ident: "DIRAX", courseDeg: 325, trueCourse: false, right: false, legNm: 4.2, speedKt: 220, altFt: 5000, from: "approach" });
    expect(p[0]!.missed.map((f) => f.ident)).toEqual(["BD701"]);
  });
  it("leaves out approaches with nothing to draw", () => {
    expect(collectApproachPaths([{ type: FT.APPROACH, id: 10, parent: 1, data: R(4, 0, 23, 0) }])).toEqual([]);
  });
});
