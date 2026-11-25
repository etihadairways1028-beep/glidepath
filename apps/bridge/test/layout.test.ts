import { describe, expect, it } from "vitest";
import { collectLayout, FL, type LayoutReader } from "../src/layout.js";

/** Hands back the values in order, whatever their type, like SimConnect's buffer would. */
const R = (...v: Array<number | string>): LayoutReader => { const n = () => v.shift() as number; return { readInt32: n, readUint32: n, readFloat32: n, readFloat64: n, readString32: () => v.shift() as string }; };

describe("airport layout from the sim", () => {
  const recs = [
    { type: FL.AIRPORT, data: R(53.3537, -2.275, -1.2) },
    { type: FL.RUNWAY, data: R(53.36, -2.27, 231, 3048, 45, 23, 2, 5, 1, 4) }, // 23R / 05L, asphalt
    { type: FL.TAXI_POINT, data: R(1, 0, 0) },        // 0 at the reference point
    { type: FL.TAXI_POINT, data: R(2, 0, 200) },      // 1, 200 m north: hold short
    { type: FL.TAXI_POINT, data: R(4, 100, 0) },      // 2, 100 m east: ILS hold short
    { type: FL.TAXI_PARKING, data: R(9, 12, 0, 12, 180, 30, -50, 0) }, // gate A12
    { type: FL.TAXI_PATH, data: R(1, 23, 0, 0, 0, 1, 0) },  // taxiway "A" from 0 to 1
    { type: FL.TAXI_PATH, data: R(3, 20, 0, 0, 0, 0, 1) },  // parking path: END is parking 0, not point 0
    { type: FL.TAXI_PATH, data: R(6, 8, 0, 0, 0, 2, 0) },   // vehicle road: left out
    { type: FL.TAXI_NAME, data: R("A\0\0\0") },
    { type: FL.TAXI_NAME, data: R("B") },
  ];
  it("turns metre offsets into positions and keeps names, holds and gates", () => {
    const l = collectLayout("egcc", recs)!;
    expect(l.icao).toBe("EGCC");
    expect(l.runways[0]!.ends).toEqual(["23R", "05L"]);
    expect(l.paths).toHaveLength(2);
    expect(l.paths[0]).toMatchObject({ kind: "taxi", name: "A", w: 23 });
    expect(l.paths[0]!.b[0] - l.paths[0]!.a[0]).toBeCloseTo(200 / 111_320, 6);
    // the parking path ends at the gate (50 m west), not at taxi point 0
    expect(l.paths[1]!.kind).toBe("parking");
    expect(l.paths[1]!.b[1]).toBeLessThan(-2.275);
    expect(l.holds.map((h) => h.ils)).toEqual([false, true]);
    expect(l.parking[0]).toMatchObject({ kind: "gate", name: "A12", hdg: 180 });
  });
  it("returns nothing without the airport record", () => { expect(collectLayout("X", [])).toBeNull(); });
});
