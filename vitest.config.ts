import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@thortiq/sync-core": path.resolve(__dirname, "packages/sync-core/src"),
      "@thortiq/client-core": path.resolve(__dirname, "packages/client-core/src"),
      "@thortiq/client-react": path.resolve(__dirname, "packages/client-react/src/index.ts"),
      "@thortiq/editor-prosemirror": path.resolve(__dirname, "packages/editor-prosemirror/src"),
      "@thortiq/outline-commands": path.resolve(__dirname, "packages/outline-commands/src")
    }
  },
  test: {
    globals: true,
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage"
    }
  }
});
