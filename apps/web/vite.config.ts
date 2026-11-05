import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// base "./" so the same build works at github.io/glidepath/app/ and at the Bridge's /app/.
export default defineConfig({ base: "./", plugins: [react()], build: { outDir: "dist", assetsDir: "assets", chunkSizeWarningLimit: 1500, sourcemap: false } });
