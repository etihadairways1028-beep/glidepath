import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Updater } from "../src/updater";

const exe = new Uint8Array([1, 2, 3, 4, 5]);
const sha = createHash("sha256").update(exe).digest("hex");
const fakeFetch = (async (url: string) => String(url).includes("bridge.json")
  ? new Response(JSON.stringify({ version: "9.9.9", sha256: sha, url: "https://example.test/GlidepathBridge-Setup.exe" }), { headers: { "content-type": "application/json" } })
  : new Response(exe, { headers: { "content-length": String(exe.length) } })) as unknown as typeof fetch;
const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, child: () => log } as never;

describe("Bridge updates install themselves", () => {
  it("installs a new version when there's no flight and the sim is closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const run = vi.fn();
    const u = new Updater({ version: "1.0.0", dataDir: mkdtempSync(join(tmpdir(), "gp-upd-")), log, fetchImpl: fakeFetch, run, autoInstall: () => true });
    await u.check();
    expect(u.status().state).toBe("available");
    await vi.advanceTimersByTimeAsync(5500);
    await vi.waitFor(() => expect(run).toHaveBeenCalled(), { timeout: 3000 });
    expect(run.mock.calls[0]![1]).toEqual(["/S", "/UPDATE"]);
    vi.useRealTimers();
  });
  it("waits while you're flying", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const run = vi.fn();
    const u = new Updater({ version: "1.0.0", dataDir: mkdtempSync(join(tmpdir(), "gp-upd-")), log, fetchImpl: fakeFetch, run, autoInstall: () => false });
    await u.check();
    await vi.advanceTimersByTimeAsync(6000);
    expect(run).not.toHaveBeenCalled();
    expect(u.status().state).toBe("available");
    vi.useRealTimers();
  });
});
