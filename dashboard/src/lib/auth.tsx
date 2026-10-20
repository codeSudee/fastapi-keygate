import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, session, setUnauthorizedHandler } from "./api";

interface Auth { authed: boolean; login(secret: string, beforeEnter?: () => Promise<void>): Promise<void>; logout(): void }
const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => session.get() !== null);

  const logout = useCallback(() => { session.clear(); setAuthed(false); }, []);
  const login = useCallback(async (secret: string, beforeEnter?: () => Promise<void>) => {
    const r = await api<{ token: string; expires_at: number }>("/login", { method: "POST", json: { secret } });
    session.set(r.token, r.expires_at);
    await beforeEnter?.(); // lets the sign-in page play its exit before the router swaps it out
    setAuthed(true);
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  const value = useMemo(() => ({ authed, login, logout }), [authed, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
