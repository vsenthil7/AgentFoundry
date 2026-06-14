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
      include: ["src/App.tsx", "src/AuthedApp.tsx", "src/auth/authClient.ts", "src/auth/AuthGate.tsx", "src/auth/AdminConsole.tsx", "src/ui/components.tsx", "src/ui/AppShell.tsx", "src/profile/ProfileScreen.tsx", "src/admin/UsersScreen.tsx", "src/platform/PlatformScreen.tsx", "src/reviews/ReviewInbox.tsx", "src/dashboard/HealthDashboard.tsx", "src/secrets/SecretsScreen.tsx"],
      reporter: ["text", "json-summary"],
    },
  },
});
