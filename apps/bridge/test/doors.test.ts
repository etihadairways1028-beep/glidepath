import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { request } from "node:https";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAddonDoors } from "../src/secure.js";
import { addonStatus } from "../src/addons.js";

const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log; }, recent() { return []; } } as never;

describe("secure doors for add-on pages", () => {
  it("passes https straight through to the add-on's own port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gp-doors-"));
    mkdirSync(join(dir, "tls"));
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${join(dir, "tls/server.key")} -out ${join(dir, "tls/server.pem")} -days 1 -subj /CN=localhost 2>/dev/null`);
    const addon = createServer((req, res) => { res.end(`EFB says hi from ${req.url}`); });
    await new Promise<void>((r) => addon.listen(0, "127.0.0.1", r));
    const target = (addon.address() as { port: number }).port;
    // Real certificate download is skipped because the saved one is fresh.
    const open = await startAddonDoors({ dataDir: dir, host: "127.0.0.1", log, doors: [{ id: "fenix", listen: 0 + 48120 + Math.floor(Math.random() * 500), target }] });
    expect(Object.keys(open)).toEqual(["fenix"]);
    const body = await new Promise<string>((resolve, reject) => {
      const rq = request({ host: "127.0.0.1", port: open.fenix, path: "/efb/index.html", rejectUnauthorized: false }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b)); });
      rq.on("error", reject); rq.end();
    });
    expect(body).toBe("EFB says hi from /efb/index.html");
    addon.close();
  });

  it("lists the secure address next to each add-on", async () => {
    const list = await addonStatus(["192.168.1.20"], [], async () => true, { host: "192-168-1-20.local-ip.sh", doors: { fenix: 4812, gsx: 4814 } });
    expect(list.find((a) => a.id === "fenix")!.secureUrl).toBe("https://192-168-1-20.local-ip.sh:4812/");
    expect(list.find((a) => a.id === "fslabs")!.secureUrl).toBe(null);
    expect(list.find((a) => a.id === "gsx")!.lanUrls).toEqual(["http://192.168.1.20:8744/"]);
  });
});
