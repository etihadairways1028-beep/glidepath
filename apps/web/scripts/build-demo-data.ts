/**
 * Static data for the web app:
 *  - public/data/demo-flight.json: the SYNTHETIC test flight (not real data), decimated:
 *    every 0.5 s within 60 s of touchdown (for landing analysis), 1 s near the ground, 3 s elsewhere.
 *    The app replays it through the real flight engine in the browser.
 *  - public/data/airports-major.json / runways-major.json: large and medium airports (OurAirports, public domain)
 *    so airport search works even without a Bridge.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSyntheticFlight, SYNTHETIC_NOTICE } from "@glidepath/testkit";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "data");
const frames = generateSyntheticFlight({ dtS: 0.5 });
const td = frames.find((f, i) => i > 0 && f.position.onGround && !frames[i - 1]!.position.onGround && (frames[i - 1]!.position.altMslFt ?? 0) > 200 + 0)!;
let last = -1e12;
const kept = frames.filter((f) => {
  const near = Math.abs(f.t - td.t) < 60_000;
  const low = (f.position.altAglFt ?? 0) < 1500;
  const step = near ? 500 : low ? 1000 : 3000;
  if (f.t - last >= step) { last = f.t; return true; }
  return false;
});
writeFileSync(join(out, "demo-flight.json"), JSON.stringify({ notice: SYNTHETIC_NOTICE, aircraft: { title: "Synthetic test aircraft (A320-class)", icaoType: "A320" }, frames: kept }));
console.log(`demo: ${kept.length} frames`);

const data = join(here, "..", "..", "..", "packages", "aviation-data", "data");
const airports = JSON.parse(readFileSync(join(data, "airports.json"), "utf8")) as any[];
const major = airports.filter((a) => a[8] === "L" || a[8] === "M");
writeFileSync(join(out, "airports-major.json"), JSON.stringify(major));
const runways = JSON.parse(readFileSync(join(data, "runways.json"), "utf8"));
const codes = new Set(major.map((a) => a[0]));
writeFileSync(join(out, "runways-major.json"), JSON.stringify(Object.fromEntries(Object.entries(runways).filter(([k]) => codes.has(k)))));
const freqs = JSON.parse(readFileSync(join(data, "frequencies.json"), "utf8"));
writeFileSync(join(out, "frequencies-major.json"), JSON.stringify(freqs));
console.log(`airports: ${major.length} major`);
