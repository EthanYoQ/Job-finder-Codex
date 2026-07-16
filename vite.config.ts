import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    maxWorkers: 4,
    setupFiles: ["./test.setup.ts"],
    testTimeout: 30_000,
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
