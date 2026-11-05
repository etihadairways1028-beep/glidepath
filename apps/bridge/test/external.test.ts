import { describe, expect, it } from "vitest";
import { parseIvao, parseMetars, parseSimbrief, parseStands, parseVatsim, ExternalData } from "../src/external.js";

const log = { debug() {}, info() {}, warn() {}, error() {}, child() { return log; }, recent: () => [] } as any;

describe("external data parsers (documented response shapes)", () => {
  it("VATSIM v3: pilots and controllers, observers excluded", () => {
    const s = parseVatsim({
      general: { update_timestamp: "2026-11-05T07:00:00Z" },
      pilots: [{ callsign: "BAW123", latitude: 51.5, longitude: -0.4, altitude: 35000, groundspeed: 450, heading: 270, flight_plan: { aircraft_short: "A320", departure: "EGLL", arrival: "KJFK" } }],
      controllers: [{ callsign: "EGLL_TWR", frequency: "118.500", facility: 4, text_atis: ["Heathrow Tower"] }, { callsign: "OBS", frequency: "199.998", facility: 0 }],
      atis: [{ callsign: "EGLL_ATIS", frequency: "128.075", facility: 4, text_atis: ["Information A"] }],
    });
    expect(s.pilots[0]).toMatchObject({ callsign: "BAW123", type: "A320", dep: "EGLL", arr: "KJFK" });
    expect(s.controllers.map((c) => c.callsign)).toEqual(["EGLL_TWR", "EGLL_ATIS"]);
    expect(s.controllers[1]!.facility).toBe("ATIS");
  });
  it("IVAO whazzup v2", () => {
    const s = parseIvao({ clients: { pilots: [{ callsign: "UAE1", lastTrack: { latitude: 25.2, longitude: 55.3, altitude: 0, groundSpeed: 0, heading: 120 }, flightPlan: { departureId: "OMDB", arrivalId: "EGLL", aircraftId: "B77W" } }], atcs: [{ callsign: "OMDB_TWR", atcSession: { frequency: 119.025, position: "TWR" } }] } });
    expect(s.pilots[0]).toMatchObject({ callsign: "UAE1", type: "B77W", network: "ivao" });
    expect(s.controllers[0]!.frequency).toBe("119.025");
  });
  it("aviationweather.gov METAR JSON", () => {
    const [m] = parseMetars([{ icaoId: "EGLL", rawOb: "EGLL 050650Z 25012KT 9999 FEW030 12/08 Q1018", wdir: 250, wspd: 12, visib: "6+", temp: 12, dewp: 8, altim: 1018.2, fltCat: "VFR", clouds: [{ cover: "FEW", base: 3000 }] }]);
    expect(m).toMatchObject({ icao: "EGLL", windDir: 250, windKt: 12, qnhHpa: 1018, category: "VFR" });
  });
  it("SimBrief OFP JSON v2: lbs converted to kg; route fixes kept", () => {
    const p = parseSimbrief({
      fetch: { status: "Success" }, params: { request_id: "123", units: "lbs" },
      general: { icao_airline: "BAW", flight_number: "123", initial_altitude: "35000", route: "DCT", route_distance: "3000" },
      atc: { callsign: "BAW123" }, aircraft: { icaocode: "B77W", reg: "G-STBA" },
      origin: { icao_code: "EGLL", name: "London Heathrow", pos_lat: "51.47", pos_long: "-0.46", elevation: "83", plan_rwy: "27R" },
      destination: { icao_code: "KJFK", name: "New York JFK", pos_lat: "40.64", pos_long: "-73.78", elevation: "13", plan_rwy: "22L" },
      times: { sched_out: "1793520000", sched_in: "1793548800", est_time_enroute: "27000" },
      fuel: { plan_ramp: "200000", enroute_burn: "150000", plan_landing: "50000" },
      navlog: { fix: [{ ident: "CPT", pos_lat: "51.5", pos_long: "-1.2", altitude_feet: "20000" }, { ident: "BAD" }] },
    });
    expect(p.origin.runway).toBe("27R");
    expect(p.fuelRampKg).toBe(90718);
    expect(p.fixes).toHaveLength(1);
    expect(p.callsign).toBe("BAW123");
  });
  it("SimBrief error status is reported, not swallowed", () => {
    expect(() => parseSimbrief({ fetch: { status: "Error: Unknown UserID" } })).toThrow(/Unknown UserID/);
  });
  it("OpenStreetMap stands sorted by distance", () => {
    const s = parseStands({ elements: [
      { type: "node", lat: 51.4720, lon: -0.4890, tags: { aeroway: "parking_position", ref: "512" } },
      { type: "way", center: { lat: 51.47205, lon: -0.48905 }, tags: { aeroway: "gate", ref: "B42" } },
      { type: "node", lat: 51.4721, lon: -0.4891, tags: { aeroway: "parking_position" } },
    ] }, { lat: 51.47205, lon: -0.48905 });
    expect(s[0]).toMatchObject({ ref: "B42", kind: "gate" });
    expect(s).toHaveLength(2);
  });
  it("cache: one upstream request per interval, stale data kept on failure", async () => {
    let calls = 0; let fail = false;
    const fake = (async () => { calls++; if (fail) throw new Error("offline"); return new Response(JSON.stringify({ pilots: [], controllers: [] }), { status: 200 }); }) as typeof fetch;
    const ext = new ExternalData(log, fake);
    await Promise.all([ext.vatsim(), ext.vatsim(), ext.vatsim()]);
    expect(calls).toBe(1);
  });
});
