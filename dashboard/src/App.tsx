import { lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { startSmoothScroll, lenis } from "@/lib/scroll";
import { Shell } from "@/components/Shell";
import Login from "@/pages/Login";
const Overview = lazy(() => import("@/pages/Overview"));
const Keys = lazy(() => import("@/pages/Keys"));
const KeyDetail = lazy(() => import("@/pages/KeyDetail"));
const PlansPage = lazy(() => import("@/pages/Plans"));
const SettingsPage = lazy(() => import("@/pages/Settings"));

export default function App() {
  const { authed } = useAuth();
  const location = useLocation();

  useEffect(() => startSmoothScroll(), []);
  useEffect(() => { lenis?.scrollTo(0, { immediate: true }); window.scrollTo(0, 0); }, [location.pathname]);

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Overview />} />
        <Route path="/keys" element={<Keys />} />
        <Route path="/keys/:id" element={<KeyDetail />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

