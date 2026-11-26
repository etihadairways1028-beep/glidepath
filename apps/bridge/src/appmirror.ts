/**
 * Keeps the Bridge's copy of the app the same as the website's, so a device that
 * opens the app from this PC (http://<pc>:4810/app) never gets an old version.
 *
 * Every few hours it reads files.json from the website (each file with its SHA-256),
 * downloads only what changed, checks every hash, and switches over in one step.
 * If anything fails, the copy built into the Bridge keeps being served.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { Logger } from "./log.js";

const SITE = process.env.GLIDEPATH_APP_SITE ?? "https://glidepath-ad9.pages.dev/app/";
const EVERY_MS = 3 * 3600_000;

type FileList = { build: string; files: { p: string; h: string; n: number }[] };

const safePath = (p: string) => /^[A-Za-z0-9._\-/]+$/.test(p) && !p.includes("..") && !p.startsWith("/");

export class AppMirror {
  readonly dir: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(dataDir: string, private readonly log: Logger) { this.dir = join(dataDir, "app-latest"); }

  /** The newest app's build id here, or null while only the built-in copy is available. */
  build(): string | null {
    try { return (JSON.parse(readFileSync(join(this.dir, "files.json"), "utf8")) as FileList).build; } catch { return null; }
  }

  /** A file from the mirrored app, or null (then the built-in copy is used). */
  file(path: string): Buffer | null {
    if (!this.build() || !safePath(path)) return null;
    const f = normalize(join(this.dir, path));
    if (!f.startsWith(normalize(this.dir)) || !existsSync(f)) return null;
    try { return readFileSync(f); } catch { return null; }
  }

  start(): void {
    const run = () => void this.sync().catch((e) => this.log.warn(`App copy not updated: ${(e as Error).message}`));
    setTimeout(run, 20_000);
    this.timer = setInterval(run, EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async sync(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const r = await fetch(`${SITE}files.json?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`website answered ${r.status}`);
      const list = (await r.json()) as FileList;
      if (!list?.build || !Array.isArray(list.files) || list.files.length === 0 || list.files.length > 400) throw new Error("file list looks wrong");
      if (list.build === this.build()) return false;
      const stage = `${this.dir}.new`;
      rmSync(stage, { recursive: true, force: true });
      for (const f of list.files) {
        if (!safePath(f.p) || !/^[0-9a-f]{64}$/.test(f.h)) throw new Error(`bad entry ${f.p}`);
        // Reuse an identical file from the current copy; download the rest.
        let buf = this.file(f.p);
        if (!buf || createHash("sha256").update(buf).digest("hex") !== f.h) {
          const res = await fetch(SITE + f.p.split("/").map(encodeURIComponent).join("/"), { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`${f.p}: ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
          if (createHash("sha256").update(buf).digest("hex") !== f.h) throw new Error(`${f.p}: checksum didn't match`);
        }
        const out = join(stage, f.p);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, buf);
      }
      writeFileSync(join(stage, "files.json"), JSON.stringify(list));
      const old = `${this.dir}.old`;
      rmSync(old, { recursive: true, force: true });
      if (existsSync(this.dir)) renameSync(this.dir, old);
      renameSync(stage, this.dir);
      rmSync(old, { recursive: true, force: true });
      this.log.info(`App copy updated to the website's newest (build ${list.build}).`);
      return true;
    } finally { this.running = false; }
  }
}
