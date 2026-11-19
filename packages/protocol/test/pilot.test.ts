import { describe, expect, it } from "vitest";
import { pilotDetails, readLevel, readSpeed } from "../src/pilot";

describe("readLevel / readSpeed", () => {
  it("reads every way a level is filed", () => {
    expect(readLevel("34000")).toBe("FL340");
    expect(readLevel("FL340")).toBe("FL340");
    expect(readLevel("F350")).toBe("FL350");
    expect(readLevel("A085")).toBe("8,500 ft");
    expect(readLevel("5500")).toBe("5,500 ft");
    expect(readLevel("S1130")).toBe("11,300 m");
    expect(readLevel("VFR")).toBe("VFR");
    expect(readLevel("")).toBeNull();
  });
  it("reads filed speeds in knots", () => {
    expect(readSpeed("N0480")).toBe(480);
    expect(readSpeed("K0890")).toBe(481);
    expect(readSpeed(455)).toBe(455);
    expect(readSpeed("M082")).toBeNull();
  });
});

describe("pilotDetails", () => {
  const vatsim = {
    pilot_ratings: [{ id: 3, short_name: "IR", long_name: "Instrument Rating" }],
    pilots: [{
      cid: 1234567, callsign: "SIA005", server: "GERMANY", pilot_rating: 3, transponder: "2200", qnh_mb: 1012, logon_time: "2026-11-19T02:00:00Z",
      flight_plan: { flight_rules: "I", aircraft: "A359/H-SDE3FGHIJ1J4J5M1RWXY/LB1D1", aircraft_faa: "H/A359/L", aircraft_short: "A359", departure: "WSSS", arrival: "FZAA", alternate: "FZIC",
        cruise_tas: "488", altitude: "34000", deptime: "0215", enroute_time: "1245", fuel_time: "1430", remarks: "PBN/A1B1 REG/9VSMA OPR/SIA /V/", route: "DCT PASPU A576 KADAX", assigned_transponder: "4521" },
    }],
  };
  it("reads a VATSIM flight plan", () => {
    const d = pilotDetails("vatsim", vatsim, "sia005")!;
    expect(d).toMatchObject({ pilotId: "1234567", rating: "Instrument Rating", server: "GERMANY", squawk: "2200", assignedSquawk: "4521", rules: "IFR", type: "A359", wake: "H",
      registration: "9VSMA", operator: "SIA", voice: "Voice", dep: "WSSS", arr: "FZAA", alternate: "FZIC", cruiseLevel: "FL340", cruiseTasKt: 488,
      depTimeZ: "0215", eteMin: 765, enduranceMin: 870, qnhHpa: 1012, route: "DCT PASPU A576 KADAX" });
  });
  it("reads an IVAO flight plan", () => {
    const ivao = { clients: { pilots: [{ callsign: "SIA005", userId: 654321, rating: 7, serverId: "WS", createdAt: "2026-11-19T02:00:00Z",
      lastTrack: { transponder: 2200, state: "En Route", onGround: false },
      flightPlan: { flightRules: "I", aircraftId: "A359", aircraft: { icaoCode: "A359", model: "A350-900", wakeTurbulence: "H" }, departureId: "WSSS", arrivalId: "FZAA", alternativeId: "FZIC",
        level: "F340", speed: "N0488", route: "DCT PASPU", remarks: "REG/9VSMA", eet: 45900, endurance: 52200, peopleOnBoard: 285, departureTime: 8100 } }] } };
    const d = pilotDetails("ivao", ivao, "SIA005")!;
    expect(d).toMatchObject({ pilotId: "654321", rating: "CP Commercial pilot", squawk: "2200", state: "En Route", onGround: false, model: "A350-900", wake: "H",
      cruiseLevel: "FL340", cruiseTasKt: 488, eteMin: 765, enduranceMin: 870, pob: 285, depTimeZ: "0215", registration: "9VSMA" });
  });
  it("returns null when the pilot has gone", () => {
    expect(pilotDetails("vatsim", vatsim, "BAW1")).toBeNull();
    expect(pilotDetails("ivao", {}, "BAW1")).toBeNull();
    expect(pilotDetails("sayintentions", [], "BAW1")).toBeNull();
  });
});
