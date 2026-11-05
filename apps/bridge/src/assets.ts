/**
 * Files of the Glidepath web app served at /app/.
 *  - Inside the packaged exe they are embedded as Node SEA assets ("app/<path>").
 *  - In development they are read from apps/web/dist.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { createRequire } from "node:module";

type Sea = { isSea(): boolean; getAsset(key: string): ArrayBuffer };
let sea: Sea | null = null;
try {
  const req = typeof require === "function" ? require : createRequire(process.cwd() + "/");
  const mod = req("node:sea") as Sea;
  sea = mod.isSea() ? mod : null;
} catch {
  sea = null;
}

const DEV_DIRS = [
  process.env.GLIDEPATH_APP_DIR,
  join(process.cwd(), "..", "web", "dist"),
  join(process.cwd(), "apps", "web", "dist"),
  join(dirname(process.execPath), "app"),
].filter((d): d is string => !!d);

export function appAsset(path: string): Buffer | null {
  if (sea) {
    try {
      return Buffer.from(sea.getAsset(`app/${path}`));
    } catch {
      return null;
    }
  }
  for (const dir of DEV_DIRS) {
    const file = normalize(join(dir, path));
    if (file.startsWith(normalize(dir)) && existsSync(file)) {
      try {
        return readFileSync(file);
      } catch {
        return null;
      }
    }
  }
  return null;
}
