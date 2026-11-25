import { describe, expect, it } from "vitest";
import { collectApproachPaths, collectSidStarPaths, FT, FT_LEG, FT_SS, type PathReader } from "../src/procedures.js";

/** A stand-in for SimConnect's buffer: hands back the values in order, whatever their type. */
const R = (...v: Array<number | string>): PathReader => { const n = () => v.shift() as number; return { readInt32: n, readFloat64: n, readFloat32: n, readString8: () => v.shift() as string }; };
// Leg fields in the order of APPROACH_PATH_DEFINITION: TYPE, FIX_ICAO, FIX_LATITUDE, FIX_LONGITUDE, ALTITUDE1 (metres).
const leg = (ident: string, lat: number, lon: number, altM = 0) => R(18, ident, lat, lon, altM, 0, 0, 0, 0, 0, 0, 0, altM ? 1 : 0, 0, 0, 0, 0, 0, 0);
// A hold leg: HM at DIRAX, inbound 325° magnetic, left turns, 4.2 nm legs (metres in the sim's data), max 220 kt.
const holdLeg = () => R(14, "DIRAX", 44.45, -0.55, 1524, 2743, 325, 1, 4.2 * 1852, 0, 0, 220, 4, 0, 0, 1, 0, 0, 0);

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
      { type: FT_LEG.FINAL_APPROACH_LEG, id: 22, parent: 10, data: R(19, "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }, // a heading leg: nothing to draw
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

describe("SID and STAR paths", () => {
  it("keeps runway transitions, common legs and enroute transitions with restrictions", () => {
    const L = (ident: string, lat: number, lon: number, altM: number, desc: number, speed = 0, course = 0, distM = 0) => R(18, ident, lat, lon, altM, 0, course, 0, distM, 0, 0, speed, desc, 0, 0, 0, 0, 0, 0);
    const p = collectSidStarPaths([
      { type: FT_SS.DEPARTURE, id: 1, parent: 0, data: R("CPT3G") },
      { type: FT_SS.RUNWAY_TRANSITION, id: 2, parent: 1, data: R(27, 2) },
      { type: FT_SS.APPROACH_LEG, id: 3, parent: 2, data: L("D254F", 51.46, -0.6, 1829, 2) },
      { type: FT_SS.APPROACH_LEG, id: 4, parent: 1, data: L("CPT", 51.49, -1.22, 1829, 2, 250, 257, 30 * 1852) },
      { type: FT_SS.ENROUTE_TRANSITION, id: 5, parent: 1, data: R("UMLAT") },
      { type: FT_SS.APPROACH_LEG, id: 6, parent: 5, data: L("UMLAT", 51.7, -1.45, 0, 0) },
    ]);
    expect(p[0]).toMatchObject({ name: "CPT3G", kind: "sid" });
    expect(p[0]!.runways[0]!.runway).toBe("27R");
    expect(p[0]!.common[0]).toMatchObject({ ident: "CPT", altFt: 6000, altDesc: "above", speedKt: 250, courseDeg: 257, distNm: 30 });
    expect(p[0]!.enroute[0]!.legs[0]!.altDesc).toBeNull();
  });
});
