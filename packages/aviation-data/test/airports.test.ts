import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AirportDb } from "../src/index.js";
import { matchRunway } from "@glidepath/flight-engine";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const db = new AirportDb(load("airports.json"), load("runways.json"), load("frequencies.json"));

describe("airport database (OurAirports)", () => {
  it("has the world's airports", () => expect(db.size).toBeGreaterThan(40000));
  it("looks up by ICAO and IATA search", () => {
    expect(db.get("egll")?.name).toMatch(/Heathrow/);
    expect(db.search("DXB")[0]?.code).toBe("OMDB");
    expect(db.search("manchester")[0]?.code).toBe("EGCC");
  });
  it("finds the airport an aircraft is parked at", () => {
    // A stand at Heathrow Terminal 5 is ~1.5 nm from the airport reference point.
    expect(db.nearest({ lat: 51.4723, lon: -0.4887 })?.code).toBe("EGLL");
    expect(db.nearest({ lat: 25.2528, lon: 55.3644 })?.code).toBe("OMDB");
    expect(db.nearest({ lat: 30, lon: -40 })).toBeNull(); // mid-Atlantic
  });
  it("returns both directions of each runway", () => {
    const ends = db.runwayEnds("EGCC").map((e) => e.ident).sort();
    expect(ends).toEqual(["05L", "05R", "23L", "23R"]);
  });
  it("matches a touchdown to the runway it happened on", () => {
    const r = matchRunway(db.runwayEnds("EGLL"), { lat: 51.4776, lon: -0.44 }, 270);
    expect(r?.ident).toBe("27R");
  });
  it("has frequencies for major airports", () => {
    expect(db.frequencies("EGLL").some((f) => f.type === "TWR")).toBe(true);
  });
});
