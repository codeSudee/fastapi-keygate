import { useCallback, useState } from "react";

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("kg-theme", next ? "dark" : "light"); } catch { /* storage blocked */ }
    setDark(next);
  }, []);
  return { dark, toggle };
}
