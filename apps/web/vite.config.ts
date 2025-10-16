import path from "node:path";
import fs from "node:fs";

import { defineConfig } from "vite";
import type { UserConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const config: UserConfig = {
    plugins: [react()],
    resolve: {
      alias: {
        "@thortiq/sync-core": path.resolve(__dirname, "../../packages/sync-core/src"),
        "@thortiq/client-core": path.resolve(__dirname, "../../packages/client-core/src"),
        "@thortiq/client-react": path.resolve(__dirname, "../../packages/client-react/src/index.ts"),
        "@thortiq/editor-prosemirror": path.resolve(__dirname, "../../packages/editor-prosemirror/src"),
        "@thortiq/outline-commands": path.resolve(__dirname, "../../packages/outline-commands/src")
      }
    },
    build: {
      target: "esnext",
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          preview: path.resolve(__dirname, "preview.html")
        }
      }
    }
  };

  // Configure dev server with HTTPS and API proxying when running locally
  if (command === "serve") {
    const certPath = path.resolve(__dirname, "certs/dev.local.pem");
    const keyPath = path.resolve(__dirname, "certs/dev.local-key.pem");
    const certificateExists = fs.existsSync(certPath) && fs.existsSync(keyPath);

    config.server = {
      host: "0.0.0.0",
      https: certificateExists
        ? {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
          }
        : undefined,
      proxy: {
        "/auth": {
          target: "https://127.0.0.1:1234",
          changeOrigin: true,
          secure: false
        },
        "/api": {
          target: "https://127.0.0.1:1234",
          changeOrigin: true,
          secure: false
        },
        "/sync": {
          target: "https://127.0.0.1:1234",
          changeOrigin: true,
          secure: false,
          ws: true
        }
      }
    };
  }

  return config;
});
