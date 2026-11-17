import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Each build gets an id. The app compares it with version.json on the server to offer updates.
const BUILD = `${Date.now().toString(36)}`;
const versionFile = (): Plugin => ({
  name: "glidepath-version",
  generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD }) }); },
});

// base "./" so the same build works at github.io/glidepath/app/ and at the Bridge's /app/.
export default defineConfig({
  base: "./",
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  plugins: [react(), versionFile()],
  build: { sourcemap: true, outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 1500, sourcemap: false },
});
