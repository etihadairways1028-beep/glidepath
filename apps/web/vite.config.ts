import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// Each build gets an id. The app compares it with version.json on the server to offer updates.
const BUILD = `${Date.now().toString(36)}`;
const versionFile = (): Plugin => ({
  name: "glidepath-version",
  generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD }) }); },
});

// files.json: every file of the build with its SHA-256, so the Bridge can keep its own copy
// of the app identical to the website's (it downloads and checks each file).
const fileList = (): Plugin => ({
  name: "glidepath-files",
  apply: "build",
  closeBundle() {
    const out = join(__dirname, "dist");
    const files: { p: string; h: string; n: number }[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const full = join(d, f); if (statSync(full).isDirectory()) walk(full); else { const rel = relative(out, full).split("\\").join("/"); if (rel === "files.json") continue; const b = readFileSync(full); files.push({ p: rel, h: createHash("sha256").update(b).digest("hex"), n: b.length }); } } };
    walk(out);
    writeFileSync(join(out, "files.json"), JSON.stringify({ build: BUILD, files }));
  },
});

// base "./" so the same build works at github.io/glidepath/app/ and at the Bridge's /app/.
export default defineConfig({
  base: "./",
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  plugins: [react(), versionFile(), fileList()],
  build: { sourcemap: true, outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 1500, sourcemap: false },
});
