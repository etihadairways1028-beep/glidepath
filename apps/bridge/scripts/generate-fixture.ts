/**
 * Writes fixtures/SYNTHETIC-EGLL-EGCC.ndjson — a GENERATED test flight for
 * the replay adapter. Not real flight data; the file says so on line 1.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSyntheticFlight, SYNTHETIC_NOTICE } from "@glidepath/testkit";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "fixtures", "SYNTHETIC-EGLL-EGCC.ndjson");
const frames = generateSyntheticFlight({ dtS: 0.5 });
writeFileSync(out, `# ${SYNTHETIC_NOTICE}\n` + frames.map((f) => JSON.stringify(f)).join("\n") + "\n");
const mins = (frames.at(-1)!.t - frames[0]!.t) / 60000;
console.log(`Wrote ${frames.length} frames (${mins.toFixed(0)} min of flight) to ${out}`);
