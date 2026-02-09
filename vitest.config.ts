import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
      reporter: ["text"],
      reportsDirectory: ".coverage",
      thresholds: {
        lines: 91,
      },
    },
  },
});
