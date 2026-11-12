import { describe, expect, it } from "vitest";
import type { FlightSummary } from "@glidepath/protocol";
import { aircraftClass, pilotCareer, simbriefLink, suggestFlights, type Place } from "../src/pilotCareer.js";

const H = 3_600_000;
const fl = (dep: string, arr: string, hours: number, type = "A20N", t = 0, extra: Partial<FlightSummary> = {}) =>
  ({ id: `${dep}${arr}${t}`, status: "completed", simulator: { source: "msfs" }, departureIcao: dep, arrivalIcao: arr, aircraft: { icaoType: type }, offBlockAt: t, startedAt: t, onBlockAt: t + hours * H, landings: [], ...extra }) as unknown as FlightSummary;

describe("career mode", () => {
  it("ranks by hours and tracks progress", () => {
    const c = pilotCareer([fl("EGLL", "EGCC", 3, "A20N", 1), fl("EGCC", "EIDW", 3, "A20N", 2 * H * 10)]);
    expect(c.hours).toBe(6);
    expect(c.rank.title).toBe("Cadet");
    expect(c.next?.title).toBe("Second Officer");
    expect(c.progress).toBeCloseTo(1 / 15, 2);
    expect(c.location).toBe("EIDW");
  });
  it("counts a streak only when you start where you finished", () => {
    const c = pilotCareer([fl("EGLL", "EGCC", 1, "A20N", 1), fl("EGCC", "EIDW", 1, "A20N", 10 * H), fl("LFPG", "EDDF", 1, "A20N", 20 * H), fl("EDDF", "LOWW", 1, "A20N", 30 * H)]);
    expect(c.bestStreak).toBe(2);
    expect(c.streak).toBe(2);
  });
  it("earns a type rating after 3 flights or 5 hours, ignoring demo flights", () => {
    const c = pilotCareer([fl("A", "B", 1, "B738", 1), fl("B", "C", 1, "B738", 5 * H), fl("C", "D", 6, "C172", 10 * H), fl("D", "E", 9, "C172", 30 * H, { simulator: { source: "replay" } } as never)]);
    const b738 = c.ratings.find((r) => r.type === "B738")!, c172 = c.ratings.find((r) => r.type === "C172")!;
    expect(b738.rated).toBe(false); expect(b738.progress).toBeCloseTo(2 / 3, 2);
    expect(c172.rated).toBe(true); expect(c172.hours).toBe(6);
    expect(c.flights).toBe(3);
  });
  it("classifies aircraft", () => {
    expect(aircraftClass("B789")).toBe("heavy"); expect(aircraftClass("A20N")).toBe("jet"); expect(aircraftClass("E175")).toBe("regional");
    expect(aircraftClass("AT76")).toBe("turboprop"); expect(aircraftClass("C172")).toBe("ga"); expect(aircraftClass(null)).toBe("ga");
  });
  it("suggests flights in sensible distance bands from where you are", () => {
    const P = (code: string, lat: number, lon: number, country = code.slice(0, 2), size: Place["size"] = "large"): Place => ({ code, name: code, city: code, country, lat, lon, size });
    const from = P("EGLL", 51.47, -0.45, "GB");
    const list = [from, P("EGCC", 53.35, -2.27, "GB"), P("LFPG", 49.01, 2.55, "FR"), P("LEMD", 40.47, -3.56, "ES"), P("LGAV", 37.94, 23.94, "GR"), P("OMDB", 25.25, 55.36, "AE"), P("EGKK", 51.15, -0.18, "GB"), P("EGBB", 52.45, -1.75, "GB", "medium")];
    const s = suggestFlights(from, list, "jet", { day: 1 });
    expect(s.every((x) => x.to.code !== "EGLL" && x.to.code !== "EGKK" && x.to.code !== "EGBB")).toBe(true); // too close / too small
    expect(s.find((x) => x.to.code === "LGAV")?.band).toBe("Long");
    expect(s.some((x) => x.to.code === "OMDB")).toBe(false); // beyond a narrow-body's long band
    expect(suggestFlights(from, list, "jet", { day: 1 })).toEqual(s); // stable within a day
  });
  it("builds a SimBrief link", () => {
    expect(simbriefLink("EGLL", "LFPG", "A20N")).toBe("https://dispatch.simbrief.com/options/custom?orig=EGLL&dest=LFPG&type=A20N");
  });
});
