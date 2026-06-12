import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The 100% gate applies to the library/engine modules. Entry-point and
      // presentation files (barrel, types, CLI wrapper, demo script) are
      // smoke-tested by tests/demo.test.ts but excluded from the strict gate,
      // since their defensive/early-return branches mirror states already at
      // 100% branch coverage in the engine unit tests.
      exclude: ["src/index.ts", "src/types.ts", "src/bin-demo.ts", "src/demo.ts", "src/gen-governance-report.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
      reporter: ["text", "json-summary"],
    },
  },
});
