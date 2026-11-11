/**
 * Remote control: what the app may ask the simulator to do, and how we know
 * it worked.
 *
 * Every command is a standard MSFS key event (the same ones the sim's own
 * keyboard shortcuts use) or the CAMERA STATE simvar. After sending, the
 * Bridge watches the next frames: if the sim's own data shows the change, the
 * command is "confirmed"; if not within a few seconds, it is reported as
 * "timeout" (sent, but the aircraft didn't react; many study-level add-ons
 * such as PMDG and Fenix run their own systems and ignore standard events).
 *
 * Safety rules are checked against the latest frame before anything is sent.
 */
import type { TelemetryFrame } from "@glidepath/protocol";

export type Step =
  | { kind: "event"; event: string; data?: number }
  | { kind: "camera"; state: number };

export interface Capability {
  /** Label for logs and errors. */
  label: string;
  /** "toggle": value is the wanted on/off state; "set": a number; "action": no value. */
  type: "toggle" | "set" | "action";
  min?: number;
  max?: number;
  /** Needs `confirmed: true` from the app (it asks the user first). */
  confirm?: boolean;
  /** Current state from a frame, for toggles and confirmation. */
  read?: (f: TelemetryFrame) => boolean | number | null;
  /** Refuse when unsafe; returns a reason. */
  guard?: (f: TelemetryFrame | null, value: number | boolean | null) => string | null;
  /** What to send. For toggles this is only called when the state must change. */
  steps: (value: number | boolean | null) => Step[];
  /** Did the frame reach the wanted value? Defaults to read() === value. */
  done?: (f: TelemetryFrame, value: number | boolean | null) => boolean;
}

const toggle = (label: string, event: string, read: (f: TelemetryFrame) => boolean | null): Capability => ({
  label, type: "toggle", read, steps: () => [{ kind: "event", event }],
});
const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(a - b) <= tol;
const airborne = (f: TelemetryFrame | null) => !!f && f.position.onGround === false;

export const CAPABILITIES: Record<string, Capability> = {
  // Autopilot modes
  "ap.master": toggle("Autopilot", "AP_MASTER", (f) => f.autopilot.master),
  "ap.fd": toggle("Flight director", "TOGGLE_FLIGHT_DIRECTOR", (f) => f.autopilot.flightDirector),
  "ap.athr": toggle("Autothrottle", "AUTO_THROTTLE_ARM", (f) => f.autopilot.autothrottle),
  "ap.hdgHold": toggle("Heading hold", "AP_HDG_HOLD", (f) => f.autopilot.headingHold),
  "ap.navHold": toggle("NAV", "AP_NAV1_HOLD", (f) => f.autopilot.navHold),
  "ap.aprHold": toggle("Approach", "AP_APR_HOLD", (f) => f.autopilot.approachHold),
  // Autopilot targets
  "ap.heading": { label: "Heading", type: "set", min: 0, max: 360, read: (f) => f.autopilot.selectedHeadingDeg,
    steps: (v) => [{ kind: "event", event: "HEADING_BUG_SET", data: Math.round(Number(v)) % 360 }],
    done: (f, v) => { const h = f.autopilot.selectedHeadingDeg; if (h === null) return false; const d = Math.abs(((h - Number(v)) % 360 + 540) % 360 - 180); return d <= 1.5; } },
  "ap.altitude": { label: "Altitude", type: "set", min: 0, max: 50000, read: (f) => f.autopilot.selectedAltitudeFt,
    steps: (v) => [{ kind: "event", event: "AP_ALT_VAR_SET_ENGLISH", data: Math.round(Number(v) / 100) * 100 }],
    done: (f, v) => near(f.autopilot.selectedAltitudeFt, Math.round(Number(v) / 100) * 100, 60) },
  "ap.speed": { label: "Speed", type: "set", min: 60, max: 400, read: (f) => f.autopilot.selectedSpeedKt,
    steps: (v) => [{ kind: "event", event: "AP_SPD_VAR_SET", data: Math.round(Number(v)) }],
    done: (f, v) => near(f.autopilot.selectedSpeedKt, Math.round(Number(v)), 1.5) },
  "ap.vs": { label: "Vertical speed", type: "set", min: -6000, max: 6000, read: (f) => f.autopilot.selectedVsFpm,
    // Key event data is an unsigned 32-bit value: negative numbers go as two's complement.
    steps: (v) => [{ kind: "event", event: "AP_VS_VAR_SET_ENGLISH", data: (Math.round(Number(v) / 100) * 100) >>> 0 }],
    done: (f, v) => near(f.autopilot.selectedVsFpm, Math.round(Number(v) / 100) * 100, 60) },

  // Lights
  "lights.landing": toggle("Landing lights", "LANDING_LIGHTS_TOGGLE", (f) => f.lights.landing),
  "lights.taxi": toggle("Taxi light", "TOGGLE_TAXI_LIGHTS", (f) => f.lights.taxi),
  "lights.beacon": toggle("Beacon", "TOGGLE_BEACON_LIGHTS", (f) => f.lights.beacon),
  "lights.strobe": toggle("Strobes", "STROBES_TOGGLE", (f) => f.lights.strobe),
  "lights.nav": toggle("Nav lights", "TOGGLE_NAV_LIGHTS", (f) => f.lights.nav),
  "lights.logo": toggle("Logo lights", "TOGGLE_LOGO_LIGHTS", (f) => f.lights.logo),
  "lights.wing": toggle("Wing lights", "TOGGLE_WING_LIGHTS", (f) => f.lights.wing),

  // Aircraft
  "brake.parking": toggle("Parking brake", "PARKING_BRAKES", (f) => f.controls.parkingBrake),
  "gear": { ...toggle("Gear", "GEAR_TOGGLE", (f) => f.controls.gearDown), confirm: true,
    guard: (f, v) => (v === false && !airborne(f) ? "The gear can't go up on the ground." : null) },
  "flaps.up": { label: "Flaps up one step", type: "action", steps: () => [{ kind: "event", event: "FLAPS_DECR" }],
    read: (f) => f.controls.flapsIndex, done: () => true },
  "flaps.down": { label: "Flaps down one step", type: "action", steps: () => [{ kind: "event", event: "FLAPS_INCR" }],
    read: (f) => f.controls.flapsIndex, done: () => true },

  // Engines (default aircraft auto-start / auto-shutdown, the sim's Ctrl+E and Ctrl+Shift+F1)
  "engines.start": { label: "Engine auto-start", type: "action", confirm: true,
    guard: (f) => (f && f.engines.length && f.engines.every((e) => e.running === true) ? "The engines are already running." : null),
    steps: () => [{ kind: "event", event: "ENGINE_AUTO_START" }], read: (f) => f.engines.some((e) => e.running === true),
    done: (f) => f.engines.length > 0 && f.engines.every((e) => e.running === true) },
  "engines.shutdown": { label: "Engine shutdown", type: "action", confirm: true,
    guard: (f) => (airborne(f) ? "Engines can't be shut down from the app in flight." : f && (f.speed.gsKt ?? 0) > 5 ? "Stop the aircraft first." : null),
    steps: () => [{ kind: "event", event: "ENGINE_AUTO_SHUTDOWN" }], read: (f) => f.engines.some((e) => e.running === true),
    done: (f) => f.engines.length > 0 && f.engines.every((e) => e.running === false) },

  // Simulator
  // The Bridge stops streaming while paused, so a pause cannot be confirmed from frames.
  "sim.pause": { label: "Pause", type: "toggle", read: (f) => f.sim.paused, steps: (v) => [{ kind: "event", event: "PAUSE_SET", data: v ? 1 : 0 }], done: () => true },
  "camera": { label: "Camera", type: "set", min: 2, max: 4, steps: (v) => [{ kind: "camera", state: Math.round(Number(v)) }], done: () => true },
};

/** Every key event the adapter must map once at connect. */
export const ALL_EVENTS: string[] = [...new Set(Object.values(CAPABILITIES).flatMap((c) => {
  const probe: Array<number | boolean | null> = c.type === "toggle" ? [true] : c.type === "set" ? [c.min ?? 0] : [null];
  return probe.flatMap((v) => c.steps(v)).filter((s): s is Extract<Step, { kind: "event" }> => s.kind === "event").map((s) => s.event);
}))];

export type Plan = { ok: true; cap: Capability; steps: Step[]; already: boolean } | { ok: false; state: "rejected" | "unsupported" | "disarmed"; detail: string };

/** Check a command and work out what to send. Pure: no side effects. */
export function planCommand(capability: string, value: number | boolean | null, confirmed: boolean, frame: TelemetryFrame | null): Plan {
  const cap = CAPABILITIES[capability];
  if (!cap) return { ok: false, state: "unsupported", detail: `Unknown control "${capability}".` };
  if (cap.type === "toggle" && typeof value !== "boolean") return { ok: false, state: "rejected", detail: `${cap.label}: expected on or off.` };
  if (cap.type === "set") {
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, state: "rejected", detail: `${cap.label}: expected a number.` };
    if ((cap.min !== undefined && value < cap.min) || (cap.max !== undefined && value > cap.max)) return { ok: false, state: "rejected", detail: `${cap.label}: ${value} is out of range (${cap.min} to ${cap.max}).` };
  }
  if (cap.confirm && !confirmed) return { ok: false, state: "disarmed", detail: `${cap.label} needs a confirmation in the app.` };
  const why = cap.guard?.(frame, value) ?? null;
  if (why) return { ok: false, state: "rejected", detail: why };
  if (cap.type === "toggle" && frame && cap.read) {
    const now = cap.read(frame);
    if (now === value) return { ok: true, cap, steps: [], already: true };
  }
  return { ok: true, cap, steps: cap.steps(value), already: false };
}

/** Has the frame reached what was asked? */
export function commandDone(cap: Capability, value: number | boolean | null, f: TelemetryFrame): boolean {
  if (cap.done) return cap.done(f, value);
  return cap.read ? cap.read(f) === value : true;
}
