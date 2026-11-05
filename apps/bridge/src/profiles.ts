/**
 * Aircraft integration profiles.
 *
 * Study-level add-ons (PMDG, Fenix, FBW, iniBuilds, FSLabs) run their own
 * systems and often do NOT drive the simulator's standard autopilot, light
 * or radio variables. Showing those standard values for them would show
 * wrong data. So until an aircraft's profile has been verified in the real
 * aircraft (Stage 5), only the groups marked `true` are trusted; the rest
 * are sent as null and the app shows "not available for this aircraft".
 */
import type { TelemetryFrame } from "@glidepath/protocol";

export interface AircraftProfile {
  id: string;
  label: string;
  match: RegExp;
  /** Has this profile been checked against the real aircraft? */
  verified: boolean;
  trust: {
    autopilot: boolean;
    lights: boolean;
    radios: boolean;
    electrical: boolean;
  };
  notes: string;
}

const STUDY_LEVEL_UNVERIFIED = { autopilot: false, lights: false, radios: false, electrical: false };

export const PROFILES: AircraftProfile[] = [
  { id: "pmdg-737", label: "PMDG 737", match: /PMDG.*737|737.*PMDG/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "Full data needs the PMDG SDK broadcast (EnableDataBroadcast=1). Planned for Stage 5." },
  { id: "pmdg-777", label: "PMDG 777", match: /PMDG.*777|777.*PMDG/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "Full data needs the PMDG SDK broadcast (EnableDataBroadcast=1). Planned for Stage 5." },
  { id: "fenix-a320", label: "Fenix A320 family", match: /FENIX/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "Systems use L-vars. MSFS 2024 can read them directly; MSFS 2020 needs a WASM helper. Stage 5." },
  { id: "fbw-a32nx", label: "FlyByWire A32NX", match: /A32NX|FLYBYWIRE|FBW/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "FCU and systems use L-vars and custom events. Stage 5." },
  { id: "fbw-a380x", label: "FlyByWire A380X", match: /A380X/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "FCU and systems use L-vars and custom events. Stage 5." },
  { id: "inibuilds-a350", label: "iniBuilds A350", match: /INIBUILDS.*A350|A350.*INIBUILDS/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "FCU values are custom. Stage 5." },
  { id: "inibuilds-a320", label: "iniBuilds A320 family", match: /INIBUILDS.*A3(19|20|21)|A3(19|20|21).*INIBUILDS|A320NEO V2/i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "Systems are custom. Stage 5." },
  { id: "fslabs", label: "FSLabs", match: /FSLABS|FSL /i, verified: false, trust: STUDY_LEVEL_UNVERIFIED,
    notes: "FSLabs exposes its own SDK. Stage 5." },
];

export const GENERIC_PROFILE: AircraftProfile = {
  id: "generic",
  label: "Default / other aircraft",
  match: /.*/,
  verified: false,
  trust: { autopilot: true, lights: true, radios: true, electrical: true },
  notes: "Standard simulator variables. Works for default aircraft and most add-ons that use the built-in systems.",
};

export function profileForTitle(title: string): AircraftProfile {
  return PROFILES.find((p) => p.match.test(title)) ?? GENERIC_PROFILE;
}

/** Null out groups the profile does not trust, so the app never shows wrong values. */
export function applyProfile(frame: TelemetryFrame, profile: AircraftProfile): TelemetryFrame {
  if (!profile.trust.autopilot) {
    for (const k of Object.keys(frame.autopilot) as Array<keyof TelemetryFrame["autopilot"]>) (frame.autopilot as Record<string, unknown>)[k] = null;
  }
  if (!profile.trust.lights) {
    for (const k of Object.keys(frame.lights) as Array<keyof TelemetryFrame["lights"]>) (frame.lights as Record<string, unknown>)[k] = null;
  }
  if (!profile.trust.radios) {
    for (const k of Object.keys(frame.radios) as Array<keyof TelemetryFrame["radios"]>) (frame.radios as Record<string, unknown>)[k] = null;
  }
  if (!profile.trust.electrical) {
    frame.electrical = { battery: null, externalPower: null, apuRpmPct: null };
  }
  return frame;
}
