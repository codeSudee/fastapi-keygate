import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** GET with stale-while-revalidate: previous data stays on screen while the next request is in flight. */
export function useApi<T>(path: string, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e as ApiError);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!opts.refreshMs) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, opts.refreshMs);
    return () => clearInterval(t);
  }, [load, opts.refreshMs]);

  return { data, error, loading, reload: load };
}
