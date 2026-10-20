import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { DEMO } from "./lib/api";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import "./index.css";

// The static demo uses hash routes so deep links and refreshes work on a host with no SPA fallback.
const Router = DEMO
  ? HashRouter
  : ({ children }: { children: React.ReactNode }) => <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>{children}</BrowserRouter>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Router>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </Router>
    </MotionConfig>
  </StrictMode>,
);
