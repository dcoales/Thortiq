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

  // Enable HTTPS for development when certificates are available
  if (command === "serve") {
    const certPath = path.resolve(__dirname, "../../certs/192.168.0.56.pem");
    const keyPath = path.resolve(__dirname, "../../certs/192.168.0.56-key.pem");
    
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      config.server = {
        https: {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath)
        }
      };
    }
  }

  return config;
});
