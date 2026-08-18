import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@chop/wave-engine": path.resolve(repoRoot, "packages/wave-engine/src/index.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
});
