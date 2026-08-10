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
  },
});
