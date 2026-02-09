import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/__tests__/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
