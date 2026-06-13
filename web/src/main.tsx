import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AuthGate } from "./auth/AuthGate.js";
import "./ui/tokens.css";
import "./ui/components.css";
import "./ui/AppShell.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{() => <App />}</AuthGate>
  </React.StrictMode>,
);
