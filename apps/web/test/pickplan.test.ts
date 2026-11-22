import { describe, expect, it } from "vitest";
import type { FlightPlan, FlightSummary } from "@glidepath/protocol";
import { pickPlan } from "../src/data/derive";

const plan = (o: string, d: string, n: number, at: number, source: "simbrief" | "msfs" = "simbrief") =>
  ({ origin: { icao: o }, destination: { icao: d }, fixes: Array.from({ length: n }, (_, i) => ({ ident: `F${i}` })), fetchedAt: at, source } as unknown as FlightPlan);
const flight = (p: FlightPlan | null, status: string, endedAt: number | null = null, dep = "EGLL", arr = "EGCC") =>
  ({ plan: p, status, endedAt, departureIcao: dep, arrivalIcao: arr } as unknown as FlightSummary);

describe("which plan to show", () => {
  it("shows a plan loaded after the last flight ended", () => {
    const old = plan("OMDB", "OERK", 20, 1000), next = plan("EGLL", "EGCC", 12, 5000);
    expect(pickPlan(flight(old, "completed", 3000), next, true)).toBe(next);
    expect(pickPlan(flight(old, "completed", 3000), plan("X", "Y", 3, 2000), true)).toBe(old);
  });
  it("prefers SimBrief over the sim's thin plan for the same airports", () => {
    const sim = plan("EGLL", "EGCC", 0, 9000, "msfs"), sb = plan("EGLL", "EGCC", 14, 1000);
    expect(pickPlan(flight(sim, "active"), sb, false)).toBe(sb);
  });
  it("uses your saved plan when the flight has none, and keeps the flight's own otherwise", () => {
    const sb = plan("EGLL", "EGCC", 14, 1000), own = plan("EGLL", "EGCC", 20, 2000);
    expect(pickPlan(flight(null, "active"), sb, false)).toBe(sb);
    expect(pickPlan(flight(own, "active"), sb, false)).toBe(own);
  });
});
