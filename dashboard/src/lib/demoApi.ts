// In-browser mock of the dashboard API, used only by `vite build --mode demo`.
// Everything is sample data held in memory; a reload resets it.
import type { ApiKey, CreatedKey, Defaults, KeyRow, KeyState, Overview, Point, PlanInfo, PlansResponse, RateWindow, Range, Totals } from "./types";

export class DemoError extends Error {
  constructor(public status: number, message: string, public payload?: unknown) { super(message); }
}

const NOW0 = Date.now();
const H = 3600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// Same catalog as src/keygate/plans.py
const PLANS: PlanInfo[] = [
  { id: "free", name: "Free", price: "$0", max_keys: 2, key_per_minute: 60, key_per_hour: 1_000, max_scopes: 3, wildcard_scope: false },
  { id: "pro", name: "Pro", price: "$12", max_keys: 10, key_per_minute: 600, key_per_hour: 20_000, max_scopes: 20, wildcard_scope: false },
  { id: "team", name: "Team", price: "$39", max_keys: 50, key_per_minute: 3_000, key_per_hour: 100_000, max_scopes: null, wildcard_scope: true },
];
const OWNER_PLAN: Record<string, string> = { acme: "pro", northwind: "team" };
const DEFAULT_PLAN = "free";
const planOf = (owner: string) => PLANS.find((p) => p.id === (OWNER_PLAN[owner] ?? DEFAULT_PLAN))!;

interface Profile { perHour: number; errRate: number; limRate: number; shape: "day" | "flat" | "burst" | "cron"; load: number }
interface Rec extends ApiKey { profile: Profile; secretTail: string }

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0").slice(0, 8);
let nextId = 1;
const seed = (r: Omit<Rec, "id" | "state" | "secretTail">): Rec => {
  const id = nextId++;
  return { ...r, id, state: "active", secretTail: "" };
};

const keys: Rec[] = [
  seed({ prefix: "a41f09c2", owner_id: "acme", name: "Production", per_minute: 600, per_hour: 20_000, created_at: iso(NOW0 - 58 * D), revoked_at: null, expires_at: null, scopes: ["read", "write"], profile: { perHour: 2400, errRate: 0.012, limRate: 0.001, shape: "day", load: 0.35 } }),
  seed({ prefix: "7be3d118", owner_id: "acme", name: "Staging", per_minute: 120, per_hour: 3_000, created_at: iso(NOW0 - 41 * D), revoked_at: null, expires_at: iso(NOW0 + 20 * D), scopes: ["read", "write"], profile: { perHour: 260, errRate: 0.05, limRate: 0.004, shape: "day", load: 0.2 } }),
  seed({ prefix: "c902a77e", owner_id: "acme", name: "Mobile app", per_minute: 300, per_hour: 10_000, created_at: iso(NOW0 - 33 * D), revoked_at: null, expires_at: null, scopes: ["read"], profile: { perHour: 1500, errRate: 0.02, limRate: 0.006, shape: "burst", load: 0.55 } }),
  seed({ prefix: "5d6e20ab", owner_id: "northwind", name: "Partner: Northwind", per_minute: 60, per_hour: 1_500, created_at: iso(NOW0 - 19 * D), revoked_at: null, expires_at: iso(NOW0 + 160 * D), scopes: ["read", "reports:read"], profile: { perHour: 700, errRate: 0.03, limRate: 0.05, shape: "flat", load: 1 } }),
  seed({ prefix: "19ac4f03", owner_id: "acme", name: "Internal cron", per_minute: null, per_hour: null, created_at: iso(NOW0 - 72 * D), revoked_at: null, expires_at: null, scopes: ["jobs:run"], profile: { perHour: 120, errRate: 0.008, limRate: 0, shape: "cron", load: 0.1 } }),
  seed({ prefix: "e08b5c61", owner_id: "acme", name: "Old CI runner", per_minute: 60, per_hour: 1_000, created_at: iso(NOW0 - 90 * D), revoked_at: iso(NOW0 - 12 * D), expires_at: null, scopes: ["read"], profile: { perHour: 90, errRate: 0.15, limRate: 0, shape: "flat", load: 0 } }),
];
for (const k of keys) k.state = stateOf(k);

let defaults: Defaults = { default_per_minute: 60, default_per_hour: 1_000 };

function stateOf(k: ApiKey): KeyState {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && Date.parse(k.expires_at) <= Date.now()) return "expired";
  return "active";
}
const pub = (k: Rec): ApiKey => ({ id: k.id, prefix: k.prefix, owner_id: k.owner_id, name: k.name, per_minute: k.per_minute, per_hour: k.per_hour, created_at: k.created_at, revoked_at: k.revoked_at, expires_at: k.expires_at, scopes: k.scopes, state: stateOf(k) });

// Deterministic noise in [0,1) so charts are stable between refreshes.
function noise(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (((x ^ (x >>> 16)) >>> 0) % 10_000) / 10_000;
}

function shapeAt(p: Profile, tMs: number): number {
  const d = new Date(tMs);
  const hr = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dow = d.getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.55 : 1;
  switch (p.shape) {
    case "day": return (0.35 + 0.65 * Math.max(0, Math.sin(((hr - 6) / 24) * 2 * Math.PI))) * weekend;
    case "flat": return 0.9 + 0.2 * Math.sin(tMs / (5 * H));
    case "burst": return (0.5 + 0.5 * Math.max(0, Math.sin(((hr - 14) / 24) * 2 * Math.PI))) * (noise(Math.floor(tMs / H), 7) > 0.85 ? 2.4 : 1);
    case "cron": return d.getUTCMinutes() < 10 ? 3.2 : 0.4;
  }
}

function bucket(k: Rec, start: number, step: number): { ok: number; errors: number; limited: number } {
  const end = start + step * 1000;
  const lo = Math.max(start, Date.parse(k.created_at));
  const hi = Math.min(end, k.revoked_at ? Date.parse(k.revoked_at) : Infinity, Date.now());
  if (hi <= lo) return { ok: 0, errors: 0, limited: 0 };
  const mid = (lo + hi) / 2;
  const p = k.profile;
  const exp = p.perHour * shapeAt(p, mid) * ((hi - lo) / H);
  const n = Math.round(exp * (0.8 + 0.4 * noise(k.id, Math.floor(start / 1000 / Math.max(step, 1)))));
  const limited = Math.round(n * p.limRate * (0.4 + 1.6 * noise(k.id + 50, Math.floor(start / 1000))));
  const errors = Math.round(n * p.errRate * (0.5 + noise(k.id + 90, Math.floor(start / 1000))));
  return { ok: Math.max(n - limited - errors, 0), errors, limited };
}

const RANGES: Record<Range, [number, number]> = { "1h": [3600, 60], "24h": [86400, 3600], "7d": [7 * 86400, 6 * 3600], "30d": [30 * 86400, 86400] };
function window_(range: string): { since: number; step: number; n: number } {
  const r = RANGES[range as Range];
  if (!r) throw new DemoError(422, "range must be one of 1h, 24h, 7d, 30d");
  const [span, step] = r;
  const n = span / step;
  const end = (Math.floor(Date.now() / 1000 / step) + 1) * step;
  return { since: (end - n * step) * 1000, step, n };
}
function series(ks: Rec[], range: string): Point[] {
  const { since, step, n } = window_(range);
  return Array.from({ length: n }, (_, i) => {
    const t = since + i * step * 1000;
    const acc = { ok: 0, errors: 0, limited: 0 };
    for (const k of ks) { const b = bucket(k, t, step); acc.ok += b.ok; acc.errors += b.errors; acc.limited += b.limited; }
    return { t: iso(t), ...acc };
  });
}
const totals = (pts: Point[]): Totals => {
  const t = pts.reduce((a, p) => ({ ok: a.ok + p.ok, errors: a.errors + p.errors, limited: a.limited + p.limited }), { ok: 0, errors: 0, limited: 0 });
  return { ...t, total: t.ok + t.errors + t.limited };
};

function rate(k: Rec): RateWindow[] {
  if (stateOf(k) !== "active") return [];
  const pm = k.per_minute ?? defaults.default_per_minute;
  const ph = k.per_hour ?? defaults.default_per_hour;
  const now = Math.floor(Date.now() / 1000);
  const out: RateWindow[] = [];
  const used = (limit: number, win: number) => {
    const frac = Math.min(1, k.profile.load * (0.7 + 0.5 * noise(k.id, Math.floor(now / win))));
    return Math.min(limit, Math.round(limit * frac));
  };
  if (pm) out.push({ window: "minute", limit: pm, remaining: limit0(pm, used(pm, 60)), reset_time: (Math.floor(now / 60) + 1) * 60 });
  if (ph) out.push({ window: "hour", limit: ph, remaining: limit0(ph, used(ph, 3600)), reset_time: (Math.floor(now / 3600) + 1) * 3600 });
  return out;
}
const limit0 = (limit: number, used: number) => Math.max(limit - used, 0);

const ENDPOINTS = [
  { m: "GET", p: "/v1/items", w: 34 }, { m: "GET", p: "/v1/items/{id}", w: 24 }, { m: "POST", p: "/v1/orders", w: 14 },
  { m: "GET", p: "/v1/reports/daily", w: 10 }, { m: "PATCH", p: "/v1/items/{id}", w: 8 }, { m: "POST", p: "/v1/webhooks/test", w: 4 },
];
const keyName = (k: ApiKey) => k.name || `kg_${k.prefix}`;

function overview(range: string): Overview {
  const { since, step, n } = window_(range);
  const pts = series(keys, range);
  const t = totals(pts);
  const prevPts = Array.from({ length: n }, (_, i) => {
    const s = since - (n - i) * step * 1000;
    return keys.reduce((a, k) => { const b = bucket(k, s, step); return a + b.ok + b.errors + b.limited; }, 0);
  });
  const per = keys.map((k) => ({ k, calls: totals(series([k], range)).total })).filter((x) => x.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 5);
  const wsum = ENDPOINTS.reduce((a, e) => a + e.w, 0);
  const active = keys.filter((k) => stateOf(k) === "active");
  return {
    range: range as Range, totals: t, previous_total: prevPts.reduce((a, b) => a + b, 0),
    error_rate: t.total ? (t.errors + t.limited) / t.total : 0,
    active_keys: active.length, total_keys: keys.length,
    keys_at_limit: active.reduce((a, k) => a + rate(k).filter((r) => r.remaining === 0).length, 0),
    series: pts,
    top_keys: per.map(({ k, calls }) => ({ id: k.id, name: keyName(k), prefix: k.prefix, calls })),
    top_endpoints: ENDPOINTS.map((e) => ({ method: e.m, path: e.p, calls: Math.round((t.total * e.w) / wsum) })),
  };
}

function keyRows(range: string): KeyRow[] {
  return keys.map((k) => {
    const pts = series([k], range);
    const last = [...pts].reverse().find((p) => p.ok + p.errors + p.limited > 0);
    return {
      ...pub(k), usage: totals(pts), spark: pts.map((p) => p.ok + p.errors + p.limited),
      last_used: stateOf(k) === "active" && last ? iso(Math.min(Date.now() - Math.floor(noise(k.id, 3) * 600_000), Date.parse(last.t) + 3_600_000)) : last ? last.t : null,
      rate: rate(k),
    };
  });
}

function keyUsage(id: number, range: string) {
  const k = keys.find((x) => x.id === id);
  if (!k) throw new DemoError(404, "Key not found");
  const pts = series([k], range);
  const t = totals(pts);
  const by_status: Record<string, number> = {};
  if (t.total) {
    const e404 = Math.round(t.errors * 0.6), e500 = Math.round(t.errors * 0.1);
    const e401 = t.errors - e404 - e500;
    const created = Math.round(t.ok * 0.12);
    Object.assign(by_status, { "200": t.ok - created, "201": created, "401": e401, "404": e404, "429": t.limited, "500": e500 });
    for (const c of Object.keys(by_status)) if (!by_status[c]) delete by_status[c];
  }
  const wsum = ENDPOINTS.reduce((a, e) => a + e.w, 0);
  const active = pts.filter((p) => p.ok + p.errors + p.limited > 0);
  return {
    key: pub(k), range, totals: t, series: pts, by_status,
    by_endpoint: t.total ? ENDPOINTS.map((e) => ({ endpoint: `${e.m} ${e.p}`, calls: Math.round((t.total * e.w) / wsum) })).slice(0, 8) : [],
    first_request: active.length ? active[0].t : null,
    last_request: active.length ? (stateOf(k) === "active" ? iso(Date.now() - 20_000) : active[active.length - 1].t) : null,
    rate: rate(k),
  };
}

// -- mutations -----------------------------------------------------------

const asUtc = (s: string) => iso(Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"));
const fakeSecret = (prefix: string) => `kg_demo_${prefix}${Array.from({ length: 24 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("")}`;

function planError(msg: string, limit: string, current: number | null, cap: number | null, owner: string) {
  const i = PLANS.findIndex((p) => p.id === planOf(owner).id);
  return new DemoError(402, msg, { detail: msg, code: "plan_limit", limit, current, cap, upgrade_to: PLANS[i + 1]?.id ?? null });
}
function checkScopes(owner: string, scopes: string[]) {
  const p = planOf(owner);
  if (p.max_scopes !== null && scopes.length > p.max_scopes) throw planError(`Your ${p.name} plan allows ${p.max_scopes} scopes per key.`, "max_scopes", scopes.length, p.max_scopes, owner);
  if (!p.wildcard_scope && scopes.includes("*")) throw planError(`The wildcard scope is not included in your ${p.name} plan.`, "wildcard_scope", null, null, owner);
}
const clamp = (req: number | null, cap: number | null) => (cap === null ? req : req === null ? cap : Math.min(req, cap));

function create(b: any): CreatedKey {
  const owner = String(b.owner_id || "").trim();
  if (!owner) throw new DemoError(422, "owner_id is required");
  const p = planOf(owner);
  const active = keys.filter((k) => k.owner_id === owner && stateOf(k) === "active").length;
  if (p.max_keys !== null && active >= p.max_keys) throw planError(`Your ${p.name} plan allows ${p.max_keys} active keys.`, "max_keys", active, p.max_keys, owner);
  const scopes: string[] = b.scopes ?? [];
  checkScopes(owner, scopes);
  const prefix = hex(Math.floor(Math.random() * 2 ** 32));
  const rec = seed({
    prefix, owner_id: owner, name: b.name ?? null,
    per_minute: clamp(b.per_minute ?? null, p.key_per_minute), per_hour: clamp(b.per_hour ?? null, p.key_per_hour),
    created_at: iso(Date.now()), revoked_at: null, expires_at: b.expires_at ? asUtc(b.expires_at) : null, scopes,
    profile: { perHour: 0, errRate: 0, limRate: 0, shape: "flat", load: 0.02 },
  });
  rec.secretTail = fakeSecret(prefix);
  keys.push(rec);
  return { ...pub(rec), key: rec.secretTail };
}

function patch(id: number, b: any): ApiKey {
  const k = keys.find((x) => x.id === id);
  if (!k || k.revoked_at) throw new DemoError(404, "Key not found or revoked");
  const p = planOf(k.owner_id);
  if (b.scopes) checkScopes(k.owner_id, b.scopes);
  if ("name" in b) k.name = b.name;
  if ("per_minute" in b) k.per_minute = clamp(b.per_minute, p.key_per_minute);
  if ("per_hour" in b) k.per_hour = clamp(b.per_hour, p.key_per_hour);
  if ("scopes" in b && b.scopes) k.scopes = b.scopes;
  if ("expires_at" in b) k.expires_at = b.expires_at ? asUtc(b.expires_at) : null;
  return pub(k);
}

function rotate(id: number): CreatedKey {
  const k = keys.find((x) => x.id === id);
  if (!k || k.revoked_at || stateOf(k) === "expired") throw new DemoError(404, "Key not found, revoked or expired");
  const prefix = hex(Math.floor(Math.random() * 2 ** 32));
  const rec = seed({ prefix, owner_id: k.owner_id, name: k.name, per_minute: k.per_minute, per_hour: k.per_hour, created_at: iso(Date.now()), revoked_at: null, expires_at: k.expires_at, scopes: [...k.scopes], profile: { ...k.profile } });
  rec.secretTail = fakeSecret(prefix);
  keys.push(rec);
  const grace = Date.now() + 24 * H;
  if (!k.expires_at || Date.parse(k.expires_at) > grace) k.expires_at = iso(grace);
  return { ...pub(rec), key: rec.secretTail };
}

function revoke(id: number) {
  const k = keys.find((x) => x.id === id);
  if (!k || k.revoked_at) throw new DemoError(404, "Key not found or already revoked");
  k.revoked_at = iso(Date.now());
}

// -- router --------------------------------------------------------------

export async function demoRequest<T>(path: string, method: string, body: any): Promise<T> {
  await new Promise((r) => setTimeout(r, 90 + Math.random() * 120));
  const u = new URL(path, "http://demo.local");
  const route = u.pathname;
  const range = u.searchParams.get("range") ?? "24h";
  let m: RegExpMatchArray | null;

  if (route === "/login" && method === "POST") {
    if (!String(body?.secret ?? "").trim()) throw new DemoError(401, "Enter any value to continue");
    return { token: "demo-token", expires_at: Math.floor(Date.now() / 1000) + 12 * 3600 } as T;
  }
  if (route === "/overview" && method === "GET") return overview(range) as T;
  if (route === "/keys" && method === "GET") return { range, keys: keyRows(range), defaults: { ...defaults } } as T;
  if (route === "/keys" && method === "POST") return create(body) as T;
  if ((m = route.match(/^\/keys\/(\d+)\/usage$/)) && method === "GET") return keyUsage(+m[1], range) as T;
  if ((m = route.match(/^\/keys\/(\d+)\/rotate$/)) && method === "POST") return rotate(+m[1]) as T;
  if ((m = route.match(/^\/keys\/(\d+)$/))) {
    if (method === "PATCH") return patch(+m[1], body ?? {}) as T;
    if (method === "DELETE") { revoke(+m[1]); return undefined as T; }
  }
  if (route === "/plans" && method === "GET") return { enabled: true, plans: PLANS, default: DEFAULT_PLAN } satisfies PlansResponse as T;
  if (route === "/settings" && method === "GET") return { ...defaults } as T;
  if (route === "/settings" && method === "PUT") {
    defaults = { default_per_minute: body?.default_per_minute ?? null, default_per_hour: body?.default_per_hour ?? null };
    return { ...defaults } as T;
  }
  throw new DemoError(404, "Not found");
}
