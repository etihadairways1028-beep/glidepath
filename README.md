# Glidepath (working name)

A flight simulator companion platform. This repository is a pnpm monorepo, all TypeScript.

| Path | What it is | Status |
| --- | --- | --- |
| `packages/protocol` | Versioned wire protocol (zod schemas): telemetry frames, events, landing reports, commands | Done (v1) |
| `packages/flight-engine` | Phase detection, landing analysis, top-of-descent maths, navigation maths | Done, 26 unit tests |
| `packages/testkit` | **Synthetic** test-flight generator (not real data) | Done |
| `apps/bridge` | The Bridge: runs on the simulator PC, reads MSFS via SimConnect, records flights, serves the LAN | Built; MSFS adapter not yet run against a live sim |

## Quick start (developers)

```bash
pnpm install
pnpm test            # unit tests
pnpm typecheck
pnpm fixtures        # regenerate the SYNTHETIC demo flight
pnpm bridge:demo     # replay it through the real Bridge at 20x; open http://localhost:4810
pnpm bridge          # live mode: waits for MSFS (Windows)
pnpm bridge:probe    # on the sim PC: verify SimConnect variables, writes msfs-probe-report.json
bash apps/bridge/scripts/build-windows.sh   # builds GlidepathBridge-windows-x64.zip
```

## Data honesty rules

- Every live value is `number | null`; `null` = not exposed by the sim/aircraft, never 0.
- Replayed or synthetic data is always flagged `source: "replay"` and badged in every UI.
- Study-level aircraft (PMDG, Fenix, FBW, iniBuilds, FSLabs) send autopilot/lights/radios as null
  until their profile is verified in the real aircraft (`apps/bridge/src/profiles.ts`).
- Remote commands answer `unsupported` until Stage 5; no button fakes a result.
