import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { addonStatus, probePort } from "../src/addons.js";

describe("cockpit tools", () => {
  it("reports which add-on ports answer and builds Wi-Fi links", async () => {
    const st = await addonStatus(["192.168.1.20"], [9999, 8083, 0], async (p) => p === 8744);
    const gsx = st.find((a) => a.id === "gsx")!;
    expect(gsx.up).toBe(true);
    expect(gsx.lanUrls).toEqual(["http://192.168.1.20:8744/"]);
    expect(st.find((a) => a.id === "fenix")!.up).toBe(false);
    expect(st.filter((a) => a.port === 8083)).toHaveLength(1);
    expect(st.find((a) => a.id === "custom-9999")).toBeTruthy();
    expect(st.find((a) => a.id === "simbridge")!.localUrl).toBe("http://localhost:8380/interfaces/mcdu/");
  });
  it("probes a real socket", async () => {
    const srv = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const port = (srv.address() as { port: number }).port;
    expect(await probePort(port)).toBe(true);
    srv.close();
    await new Promise((r) => srv.once("close", r));
    expect(await probePort(port)).toBe(false);
  });
});
