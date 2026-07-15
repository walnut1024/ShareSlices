import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function previewNoStore(): Plugin {
  return {
    name: "shareslices-preview-no-store",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (/^\/artifacts\/[^/]+\/preview(?:\?|$)/.test(request.url ?? "")) {
          const setHeader = response.setHeader.bind(response);
          response.setHeader = ((name, value) =>
            setHeader(name, name.toLowerCase() === "cache-control" ? "no-store" : value)) as typeof response.setHeader;
          response.setHeader("Cache-Control", "no-store");
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), previewNoStore()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  },
  server: {
    proxy: {
      "^/a(?:/|$)": "http://127.0.0.1:7456",
      "/api": "http://127.0.0.1:7456",
      "/health": "http://127.0.0.1:7456",
      "/ready": "http://127.0.0.1:7456"
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    setupFiles: ["./src/test/setup.ts"]
  }
});
