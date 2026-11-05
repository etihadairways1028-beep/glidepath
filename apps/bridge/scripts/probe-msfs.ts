/**
 * MSFS probe — run this ON YOUR SIMULATOR PC with MSFS running and an
 * aircraft loaded (on the runway or in flight):
 *
 *     pnpm bridge:probe
 *
 * It connects through SimConnect, reads every variable the Bridge uses for
 * 15 seconds, and writes msfs-probe-report.json next to where you ran it.
 * Send that file back so the adapter can be verified against your sim.
 *
 * During the 15 s, please: bank the aircraft RIGHT, and pitch the nose UP.
 * The report checks the sign conventions from those movements.
 */
import { writeFileSync } from "node:fs";
import { open, Protocol, SimConnectConstants, SimConnectDataType, SimConnectPeriod, type RecvSimObjectData } from "node-simconnect";
import { TELEMETRY_VARS, detectSimulator } from "../src/adapters/msfs.js";

const DEF = 1;
const IDENT = 2;
const rejected: string[] = [];
const samples: Record<string, number[]> = {};
let ident: Record<string, string> = {};

export async function runProbe(outFile = "msfs-probe-report.json"): Promise<void> {
  console.log("Connecting to MSFS…");
  const { recvOpen, handle } = await open("Glidepath Probe", Protocol.KittyHawk);
  const sim = detectSimulator(recvOpen.applicationName, recvOpen.applicationVersionMajor, recvOpen.applicationVersionMinor);
  console.log(`Connected: ${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor} → detected ${sim.name}`);

  const sendIds = new Map<number, string>();
  for (const [name, unit] of TELEMETRY_VARS) sendIds.set(handle.addToDataDefinition(DEF, name, unit, SimConnectDataType.FLOAT64), name);
  for (const n of ["TITLE", "ATC TYPE", "ATC MODEL", "ATC ID", "ATC AIRLINE"]) handle.addToDataDefinition(IDENT, n, null, SimConnectDataType.STRING256);
  handle.on("exception", (ex) => {
    const v = sendIds.get(ex.sendId);
    rejected.push(v ? `${v}: ${ex.exceptionName}` : `${ex.exceptionName} (sendId ${ex.sendId})`);
  });
  handle.on("simObjectData", (d: RecvSimObjectData) => {
    if (d.requestID === IDENT) {
      ident = Object.fromEntries(["title", "atcType", "atcModel", "atcId", "atcAirline"].map((k) => [k, d.data.readString256()]));
      return;
    }
    for (const [name] of TELEMETRY_VARS) (samples[name] ??= []).push(d.data.readFloat64());
  });
  handle.requestDataOnSimObject(IDENT, IDENT, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.ONCE);
  handle.requestDataOnSimObject(DEF, DEF, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND);

  console.log("Reading for 15 seconds. Bank RIGHT and pitch the nose UP now…");
  await new Promise((r) => setTimeout(r, 15_000));
  handle.close();

  const summary = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { min: Math.min(...v), max: Math.max(...v), last: v.at(-1) }]));
  const bank = samples["PLANE BANK DEGREES"] ?? [];
  const pitch = samples["PLANE PITCH DEGREES"] ?? [];
  const report = {
    generatedAt: new Date().toISOString(),
    simulator: { appName: recvOpen.applicationName, version: `${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`, detected: sim.id },
    aircraft: ident,
    rejectedVariables: rejected,
    signChecks: {
      bankRawWhenBankedRight: bank.length ? (Math.abs(Math.min(...bank)) > Math.abs(Math.max(...bank)) ? "negative" : "positive") : "no data",
      pitchRawWhenNoseUp: pitch.length ? (Math.abs(Math.min(...pitch)) > Math.abs(Math.max(...pitch)) ? "negative" : "positive") : "no data",
      expected: "Bridge assumes BOTH are negative (it inverts them). If either says positive, tell me.",
    },
    samples: summary,
  };
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nDone. ${rejected.length} variable(s) rejected. Report written to ${outFile}`);
}

export function runProbeCli(outFile?: string): void {
  runProbe(outFile).then(() => process.exit(0)).catch((e) => {
    console.error("Could not connect to MSFS. Is the simulator running (past the main menu)?", e?.message ?? e);
    process.exit(1);
  });
}

if (process.argv[1] && /probe-msfs\.ts$/.test(process.argv[1])) runProbeCli();
