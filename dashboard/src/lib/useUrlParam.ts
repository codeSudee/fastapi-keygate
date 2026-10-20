import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** A string query param constrained to `allowed`; default value is omitted from the URL. */
export function useUrlParam<T extends string>(key: string, def: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
  const set = useCallback((v: T) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === def) next.delete(key); else next.set(key, v);
      return next;
    }, { replace: true });
  }, [key, def, setParams]);
  return [value, set];
}
