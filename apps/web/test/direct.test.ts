import { describe, expect, it, beforeEach } from "vitest";
import { destinationPoint, bearingDeg } from "@glidepath/flight-engine";
import type { FlightPlan, TelemetryFrame } from "@glidepath/protocol";
import { restoreAll, undoDirect, withDirects } from "../src/data/direct";

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

const O = { lat: 50, lon: 0 };
const A = destinationPoint(O, 0, 40), B = destinationPoint(A, 90, 40), C = destinationPoint(B, 45, 40), D = destinationPoint(C, 0, 40);
const fx = (ident: string, p: { lat: number; lon: number }) => ({ ident, lat: p.lat, lon: p.lon, altitudeFt: 30000, proc: null });
const plan = { origin: { icao: "AAAA", lat: O.lat, lon: O.lon }, destination: { icao: "DDDD", lat: D.lat, lon: D.lon }, fixes: [fx("ALPHA", A), fx("BRAVO", B), fx("CHRLY", C)] } as unknown as FlightPlan;
const frame = (p: { lat: number; lon: number }, t: number): TelemetryFrame => ({ t, seq: t, position: { lat: p.lat, lon: p.lon, altMslFt: 30000, altAglFt: 29000, onGround: false }, attitude: { bankDeg: 0, pitchDeg: 0, headingTrueDeg: 0, headingMagDeg: 0 } } as unknown as TelemetryFrame);

describe("live direct-to", () => {
  beforeEach(() => restoreAll());
  it("keeps the plan while you follow it", () => {
    let t = 0, p = O;
    for (let i = 0; i < 30; i++) { p = destinationPoint(p, 0, 1); t += 5000; expect(withDirects(plan, frame(p, t)).fixes.length).toBe(3); }
  });
  it("drops ALPHA after flying direct to BRAVO, and can put it back", () => {
    let t = 0, p = destinationPoint(O, 0, 15);
    withDirects(plan, frame(p, t));
    let out = plan;
    for (let i = 0; i < 12; i++) { p = destinationPoint(p, bearingDeg(p, B), 1); t += 5000; out = withDirects(plan, frame(p, t)); }
    expect(out.fixes.map((f) => f.ident)).toEqual(["BRAVO", "CHRLY"]);
    undoDirect();
    for (let i = 0; i < 8; i++) { p = destinationPoint(p, bearingDeg(p, B), 1); t += 5000; out = withDirects(plan, frame(p, t)); }
    expect(out.fixes.length).toBe(3);
  });
});
