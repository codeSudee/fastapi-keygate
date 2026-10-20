const BASE = "/keygate/dashboard/api";
const TOKEN_KEY = "kg-token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const session = {
  get(): { token: string; exp: number } | null {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s.exp * 1000 > Date.now() ? s : null;
    } catch {
      return null;
    }
  },
  set(token: string, exp: number) {
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp })); } catch { /* storage blocked */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const s = session.get();
  if (s) headers.set("Authorization", `Bearer ${s.token}`);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the Keygate server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") onUnauthorized();
    const detail = body?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : res.statusText;
    throw new ApiError(res.status, msg || "Something went wrong");
  }
  return body as T;
}
