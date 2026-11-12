import { describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityFor, Decoder, DiscordPresence, encode } from "../src/discord.js";
import { emptyFrame, type FlightSummary } from "@glidepath/protocol";

const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log; }, recent() { return []; } } as never;

describe("Discord status", () => {
  it("encodes and decodes IPC packets, including split chunks", () => {
    const pkt = Buffer.concat([encode(1, { a: 1 }), encode(2, { b: "x" })]);
    const d = new Decoder();
    expect(d.push(pkt.subarray(0, 5))).toEqual([]);
    expect(d.push(pkt.subarray(5))).toEqual([{ op: 1, data: { a: 1 } }, { op: 2, data: { b: "x" } }]);
  });

  it("describes a flight", () => {
    const f = emptyFrame(1, Date.now(), 51, 0);
    f.position.altMslFt = 36000; f.position.onGround = false; f.speed.gsKt = 462;
    const flight = { departureIcao: "EGLL", arrivalIcao: null, plan: null, aircraft: { icaoType: "A320" }, callsign: "BAW12", landings: [], offBlockAt: 1000, startedAt: 900 } as unknown as FlightSummary;
    const a = activityFor(flight, f, "CRUISE")!;
    expect(a.details).toBe("EGLL → ···· · A320");
    expect(a.state).toBe("BAW12 · Cruising at FL360, 462 kt");
    expect(a.timestamps?.start).toBe(1000);
  });

  it("connects to the Discord app, handshakes and sets the activity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gp-discord-"));
    const path = (i: number) => join(dir, `discord-ipc-${i}`);
    const got: Array<{ op: number; data: Record<string, unknown> }> = [];
    let client: Socket | null = null;
    const srv = createServer((s) => {
      client = s;
      const d = new Decoder();
      s.on("data", (c) => {
        for (const m of d.push(c)) {
          got.push(m);
          if (m.op === 0) s.write(encode(1, { cmd: "DISPATCH", evt: "READY", data: { user: { username: "pilot", global_name: "Anisha" } } }));
        }
      });
    });
    await new Promise<void>((r) => srv.listen(path(1), r)); // discord-ipc-0 missing: it should try the next one
    const p = new DiscordPresence(dir, log, path);
    p.setConfig({ enabled: true, clientId: "123456789012345678" });
    await new Promise((r) => setTimeout(r, 200));
    expect(p.status().state).toBe("on");
    expect(p.status().user).toBe("Anisha");
    p.update({ details: "EGLL → EGCC", state: "Cruising" });
    await new Promise((r) => setTimeout(r, 100));
    expect(got[0]).toMatchObject({ op: 0, data: { v: 1, client_id: "123456789012345678" } });
    const set = got.find((m) => m.data.cmd === "SET_ACTIVITY");
    expect(set?.data.args).toMatchObject({ activity: { details: "EGLL → EGCC", state: "Cruising" } });
    expect(() => p.setConfig({ clientId: "abc" })).toThrow(/long number/);
    p.stop(); (client as Socket | null)?.destroy(); srv.close();
  });

  it("says when Discord isn't running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gp-discord-"));
    const p = new DiscordPresence(dir, log, (i) => join(dir, `none-${i}`));
    p.setConfig({ enabled: true, clientId: "123456789012345678" });
    await new Promise((r) => setTimeout(r, 200));
    expect(p.status().state).toBe("no-discord");
    p.stop();
  });
});
