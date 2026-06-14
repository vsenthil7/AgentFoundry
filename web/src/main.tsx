import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AuthGate } from "./auth/AuthGate.js";
import "./ui/tokens.css";
import "./ui/components.css";
import "./ui/AppShell.css";
import "./ui/responsive.css";
import "./auth/auth.css";
import "./auth/cockpit.css";
import "./profile/profile.css";
import "./admin/users.css";
import "./platform/platform.css";
import "./reviews/reviews.css";
import "./dashboard/dashboard.css";
import "./secrets/secrets.css";
import "./billing/billing.css";
import "./sla/sla.css";
import "./compliance/compliance.css";
import "./status/status.css";
import "./governance/governance.css";
import "./console.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{() => <App />}</AuthGate>
  </React.StrictMode>,
);
