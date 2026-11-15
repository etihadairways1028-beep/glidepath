/**
 * Bridge updates. Checks for a newer 1.x on start and every 6 hours, and when
 * asked: downloads the installer, checks its SHA-256 against the published
 * one, and runs it. Windows asks once on the PC to allow it (the installer
 * needs admin to update Program Files and the firewall); the installer then
 * restarts the Bridge by itself.
 *
 * Nothing is installed without someone pressing Update, and nothing is run
 * unless its checksum matches the one published with the release.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Logger } from "./log.js";

const SITE = process.env.GLIDEPATH_UPDATE_MANIFEST ?? "https://glidepath-ad9.pages.dev/bridge.json";
const RAW = "https://raw.githubusercontent.com/etihadairways1028-beep/glidepath/bridge-downloads";
const DL = (v: string) => `https://github.com/etihadairways1028-beep/glidepath/releases/download/v${v}/GlidepathBridge-Setup.exe`;

export type UpdateState = "idle" | "checking" | "current" | "available" | "downloading" | "verifying" | "installing" | "error";
export interface UpdateStatus {
  current: string;
  latest: string | null;
  state: UpdateState;
  /** 0..1 while downloading. */
  progress: number;
  notes: string | null;
  message: string | null;
  /** False when this Bridge wasn't installed with the installer (zip copy, dev): updating means downloading it again. */
  canInstall: boolean;
  checkedAt: number | null;
}

interface Manifest { version: string; sha256: string; url?: string; notes?: string }

/** "1.0.10" > "1.0.9". Anything that isn't three numbers counts as 0.0.0. */
export function newer(a: string, b: string): boolean {
  const p = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim()); return m ? [+m[1]!, +m[2]!, +m[3]!] : [0, 0, 0]; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! > y[i]!;
  return false;
}

export class Updater {
  private st: UpdateStatus;
  private manifest: Manifest | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly dir: string;

  constructor(private readonly o: {
    version: string; dataDir: string; log: Logger;
    /** Where the running exe lives; updates install only for an installed Bridge. */
    execPath?: string;
    /** Test hooks. */
    fetchImpl?: typeof fetch; run?: (file: string, args: string[]) => void; platform?: NodeJS.Platform;
  }) {
    const exe = o.execPath ?? process.execPath;
    const installed = (o.platform ?? process.platform) === "win32" && /glidepathbridge\.exe$/i.test(exe) && existsSync(join(dirname(exe), "Uninstall.exe"));
    this.st = { current: o.version, latest: null, state: "idle", progress: 0, notes: null, message: null, canInstall: installed || !!o.run, checkedAt: null };
    this.dir = join(o.dataDir, "updates");
  }

  status(): UpdateStatus { return { ...this.st }; }

  start(): void {
    void this.check();
    this.timer = setInterval(() => { if (this.st.state === "idle" || this.st.state === "current" || this.st.state === "available" || this.st.state === "error") void this.check(); }, 6 * 3600_000);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  private get f(): typeof fetch { return this.o.fetchImpl ?? fetch; }

  private async manifestFrom(): Promise<Manifest> {
    try {
      const r = await this.f(`${SITE}?t=${Date.now()}`, { signal: AbortSignal.timeout(12_000) });
      if (r.ok) {
        const m = (await r.json()) as Manifest;
        if (m?.version && /^[a-f0-9]{64}$/.test(m.sha256)) return m;
      }
    } catch { /* try GitHub */ }
    const [v, sha] = await Promise.all([
      this.f(`${RAW}/VERSION?t=${Date.now()}`, { signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.text() : "")),
      this.f(`${RAW}/GlidepathBridge-Setup.exe.sha256?t=${Date.now()}`, { signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.text() : "")),
    ]);
    const version = v.trim(), sha256 = sha.trim().split(/\s+/)[0] ?? "";
    if (!version || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Couldn't read the latest version.");
    return { version, sha256 };
  }

  async check(): Promise<UpdateStatus> {
    if (["downloading", "verifying", "installing"].includes(this.st.state)) return this.status();
    this.st.state = "checking"; this.st.message = null;
    try {
      const m = await this.manifestFrom();
      this.manifest = m;
      this.st.latest = m.version;
      this.st.notes = m.notes ?? null;
      this.st.state = newer(m.version, this.o.version) ? "available" : "current";
      if (this.st.state === "available") this.o.log.info(`Bridge ${m.version} is available (this is ${this.o.version})`);
    } catch (e) {
      this.st.state = "error";
      this.st.message = `Couldn't check for updates: ${(e as Error).message}`;
    }
    this.st.checkedAt = Date.now();
    return this.status();
  }

  /** Download, verify and run the installer. Resolves once the installer has been started. */
  async install(): Promise<UpdateStatus> {
    if (["downloading", "verifying", "installing"].includes(this.st.state)) return this.status();
    if (!this.manifest || this.st.state !== "available") await this.check();
    const m = this.manifest;
    if (!m || !newer(m.version, this.o.version)) return this.status();
    if (!this.st.canInstall) {
      this.st.state = "error";
      this.st.message = "This copy of the Bridge wasn't installed with the installer. Download the new version from the Glidepath website.";
      return this.status();
    }
    void this.run(m);
    return this.status();
  }

  private async run(m: Manifest): Promise<void> {
    const file = join(this.dir, `GlidepathBridge-Setup-${m.version}.exe`);
    try {
      mkdirSync(this.dir, { recursive: true });
      this.st.state = "downloading"; this.st.progress = 0; this.st.message = null;
      const r = await this.f(m.url ?? DL(m.version), { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
      if (!r.ok || !r.body) throw new Error(`the download answered ${r.status}`);
      const total = Number(r.headers.get("content-length") ?? 0);
      const hash = createHash("sha256");
      const out = createWriteStream(file);
      let got = 0;
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk); got += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((res) => out.once("drain", () => res()));
        this.st.progress = total ? Math.min(0.99, got / total) : 0;
      }
      await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
      this.st.state = "verifying"; this.st.progress = 1;
      const sum = hash.digest("hex");
      if (sum !== m.sha256) throw new Error("the download didn't match the published checksum, so it wasn't installed");
      // Double-check what's on disk is what was hashed.
      if (createHash("sha256").update(readFileSync(file)).digest("hex") !== m.sha256) throw new Error("the saved file changed after download");
      this.st.state = "installing";
      this.st.message = "Windows will ask on the PC to allow the update. Click Yes. The Bridge restarts by itself.";
      this.o.log.info(`Installing Bridge ${m.version}`);
      // /S: no wizard. /UPDATE tells the installer to start the Bridge again when it's done.
      if (this.o.run) this.o.run(file, ["/S", "/UPDATE"]);
      else spawn(file, ["/S", "/UPDATE"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    } catch (e) {
      this.st.state = "error";
      this.st.message = `The update didn't work: ${(e as Error).message}. You can download it from the Glidepath website instead.`;
      this.o.log.warn(this.st.message);
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
    }
  }
}
