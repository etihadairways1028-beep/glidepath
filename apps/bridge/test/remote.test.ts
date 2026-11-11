import { describe, expect, it } from "vitest";
import { emptyFrame, type TelemetryFrame } from "@glidepath/protocol";
import { ALL_EVENTS, CAPABILITIES, commandDone, planCommand } from "../src/remote.js";

const frame = (over: (f: TelemetryFrame) => void = () => undefined): TelemetryFrame => {
  const f = emptyFrame(1, Date.now(), 51.47, -0.45);
  f.position.onGround = true;
  f.speed.gsKt = 0;
  over(f);
  return f;
};

describe("remote control", () => {
  it("toggles only when the state must change", () => {
    const f = frame((x) => { x.lights.landing = true; });
    const same = planCommand("lights.landing", true, false, f);
    expect(same.ok && same.already).toBe(true);
    const flip = planCommand("lights.landing", false, false, f);
    expect(flip.ok && flip.steps).toEqual([{ kind: "event", event: "LANDING_LIGHTS_TOGGLE" }]);
  });
  it("sets autopilot targets, negative vertical speed as unsigned 32-bit", () => {
    const vs = planCommand("ap.vs", -1500, false, frame());
    expect(vs.ok && vs.steps[0]).toEqual({ kind: "event", event: "AP_VS_VAR_SET_ENGLISH", data: 4294965796 });
    const alt = planCommand("ap.altitude", 12345, false, frame());
    expect(alt.ok && alt.steps[0]).toEqual({ kind: "event", event: "AP_ALT_VAR_SET_ENGLISH", data: 12300 });
  });
  it("refuses out-of-range and wrongly typed values", () => {
    expect(planCommand("ap.altitude", 99999, false, frame()).ok).toBe(false);
    expect(planCommand("ap.master", 1, false, frame()).ok).toBe(false);
    const u = planCommand("nope", true, false, frame());
    expect(!u.ok && u.state).toBe("unsupported");
  });
  it("needs a confirmation for engines and gear, and refuses unsafe ones", () => {
    const noConfirm = planCommand("engines.shutdown", null, false, frame());
    expect(!noConfirm.ok && noConfirm.state).toBe("disarmed");
    const air = planCommand("engines.shutdown", null, true, frame((x) => { x.position.onGround = false; }));
    expect(!air.ok && air.state).toBe("rejected");
    const gearGround = planCommand("gear", false, true, frame((x) => { x.controls.gearDown = true; }));
    expect(!gearGround.ok && gearGround.state).toBe("rejected");
  });
  it("confirms from the sim's own data, with heading wrap-around", () => {
    const cap = CAPABILITIES["ap.heading"]!;
    expect(commandDone(cap, 0, frame((x) => { x.autopilot.selectedHeadingDeg = 359.4; }))).toBe(true);
    expect(commandDone(cap, 90, frame((x) => { x.autopilot.selectedHeadingDeg = 80; }))).toBe(false);
  });
  it("maps every event it might send", () => {
    expect(ALL_EVENTS).toContain("AP_MASTER");
    expect(ALL_EVENTS).toContain("ENGINE_AUTO_START");
    expect(new Set(ALL_EVENTS).size).toBe(ALL_EVENTS.length);
  });
});
