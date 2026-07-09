import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.ts"],
    exclude: ["tests/setup-env.ts", "tests/contract-failure-server.ts"],
    setupFiles: ["./tests/setup-env.ts"]
  }
});
