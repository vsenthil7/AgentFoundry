import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests-component/setup.ts"],
    include: ["tests-component/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/App.tsx", "src/auth/authClient.ts", "src/auth/AuthGate.tsx", "src/auth/AdminConsole.tsx"],
      reporter: ["text", "json-summary"],
    },
  },
});
