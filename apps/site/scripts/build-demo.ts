/**
 * Builds demo-flight.json for the website by running the REAL flight engine
 * over the SYNTHETIC test flight. Nothing here is real flight data; the file
 * says so in its `notice` field and the site shows that notice.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTopOfDescent, destinationPoint, distanceNm, routeProgress, LandingAnalyzer, landingProfileFor, PhaseDetector, LANDING_PROFILES } from "@glidepath/flight-engine";
import { EGCC_23R, EGLL_27R, generateSyntheticFlight, SYNTHETIC_NOTICE } from "@glidepath/testkit";
import type { LandingReport } from "@glidepath/protocol";

const frames = generateSyntheticFlight({ dtS: 0.5 });
const pd = new PhaseDetector({ plannedCruiseFt: 24000, destination: EGCC_23R.threshold });
const profile = landingProfileFor("A320");
const la = new LandingAnalyzer({ profile, runways: [EGCC_23R] });
const t0 = frames[0]!.t;
let flown = 0;
let prev = frames[0]!;
const out: unknown[] = [];
const events: unknown[] = [];
let landing: LandingReport | null = null;
let lastOut = -1e9;
const IAF = destinationPoint(EGCC_23R.threshold, (EGCC_23R.headingTrueDeg + 180) % 360, 14);
const ROUTE = [EGLL_27R.threshold, IAF, EGCC_23R.threshold];
const IAF_DIST = 0;
for (const f of frames) {
  const evs = pd.update(f);
  for (const e of evs) {
    if (["SIM_PAUSED", "SIM_RESUMED"].includes(e.type)) continue;
    events.push({ type: e.type, s: Math.round((e.t - t0) / 1000), d: Math.round(flown * 10) / 10, alt: e.altMslFt === null ? null : Math.round(e.altMslFt) });
    if (e.type === "TOUCHDOWN") la.touchdown(f);
  }
  const r = la.push(f);
  if (r) landing = r;
  if (pd.phase !== "PREFLIGHT" && !f.sim.paused) flown += distanceNm(prev.position, f.position);
  prev = f;
  const s = (f.t - t0) / 1000;
  const near = pd.phase === "TAKEOFF" || pd.phase === "LANDING" || (f.position.altAglFt ?? 0) < 1500;
  if (s - lastOut >= (near ? 1 : 4) || evs.length) {
    lastOut = s;
    const remaining = routeProgress(ROUTE, f.position)?.distanceRemainingNm ?? 0;
    const tod = !f.position.onGround && (pd.phase === "CLIMB" || pd.phase === "CRUISE")
      ? computeTopOfDescent({ currentAltitudeFt: f.position.altMslFt ?? 0, groundSpeedKt: f.speed.gsKt ?? 0, target: { distanceNm: remaining, altitudeFt: 257 + 3000 } })
      : null;
    out.push([
      Math.round(s), Math.round(flown * 10) / 10, Math.round(f.position.altMslFt ?? 0), Math.round(f.speed.gsKt ?? 0),
      Math.round(f.speed.vsFpm ?? 0), Math.round(f.attitude.headingMagDeg ?? 0), pd.phase,
      Math.round(f.fuel.totalKg ?? 0), Math.round(f.speed.iasKt ?? 0), tod && tod.minutesToTod !== null ? Math.round(tod.minutesToTod * 10) / 10 : null,
      Math.round(remaining * 10) / 10,
    ]);
  }
}
const fl = la.flush();
if (fl) landing = fl;
const data = {
  notice: SYNTHETIC_NOTICE,
  route: { from: { icao: "EGLL", name: "London Heathrow", rwy: "27R", elevFt: 83 }, to: { icao: "EGCC", name: "Manchester", rwy: "23R", elevFt: 257 } },
  aircraft: "A320-class (synthetic)",
  startUtc: new Date(t0).toISOString(),
  columns: ["s", "flownNm", "altFt", "gsKt", "vsFpm", "hdgMag", "phase", "fuelKg", "iasKt", "todMin", "toGoNm"],
  frames: out,
  events,
  landing,
  landingProfile: profile,
};
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "..", "demo-flight.json"), JSON.stringify(data));
console.log(`frames ${out.length}, events ${events.length}, landing ${landing?.grade} ${landing?.score}, flown ${flown.toFixed(1)} nm`);
