import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@thortiq/sync-core": path.resolve(__dirname, "../../packages/sync-core/src"),
      "@thortiq/client-core": path.resolve(__dirname, "../../packages/client-core/src"),
      "@thortiq/editor-prosemirror": path.resolve(__dirname, "../../packages/editor-prosemirror/src"),
      "@thortiq/outline-commands": path.resolve(__dirname, "../../packages/outline-commands/src")
    }
  },
  build: {
    target: "esnext"
  }
});
